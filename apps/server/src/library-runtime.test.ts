import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("EXPECTED_STATE_NOT_REACHED");
}

describe("M1-F2-A local library runtime", () => {
  const runtimes: LibraryRuntime[] = [];
  const apps: Array<ReturnType<typeof createApp>> = [];
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(objectDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("persists uploads, parse states and account-scoped search across a restart", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-"));
    objectDirectories.push(objectDirectory);

    const runtime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
    });
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at)
      VALUES ('account-a', now()), ('account-b', now())
    `);
    const app = createApp({ readiness: () => runtime.ready(), library: runtime });
    apps.push(app);

    const txtBytes = Buffer.from("一阵雨过后，山色重新显出来。", "utf8");
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("同名书.txt"),
        "x-selfalone-account": "account-a",
      },
      payload: txtBytes,
    });
    expect(uploaded.statusCode).toBe(202);
    expect(uploaded.json()).toMatchObject({
      title: "同名书",
      author: null,
      format: "txt",
      parseStatus: "processing",
      sourceLabel: "本地",
    });

    const firstId = uploaded.json().id as string;
    const ready = await eventually(
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/books?query=%E5%90%8C%E5%90%8D",
          headers: { "x-selfalone-account": "account-a" },
        });
        expect(response.statusCode).toBe(200);
        return response.json<{ books: Array<Record<string, unknown>> }>();
      },
      (value) => value.books[0]?.parseStatus === "ready_text",
    );
    expect(ready.books).toHaveLength(1);

    const [stored] = await administration.unsafe<
      Array<{ objectKey: string; sha256: string; accountId: string }>
    >(`
      SELECT object_key AS "objectKey", sha256, account_id AS "accountId"
      FROM "${schema}".book_files WHERE book_id = '${firstId}'
    `);
    expect(stored?.accountId).toBe("account-a");
    expect(stored?.objectKey).toMatch(/^account-a\/.+\/original\/1\/original\.txt$/);
    expect(stored?.sha256).toBe(createHash("sha256").update(txtBytes).digest("hex"));
    expect(await readFile(join(objectDirectory, stored?.objectKey ?? ""))).toEqual(txtBytes);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("同名书.txt"),
        "x-selfalone-account": "account-a",
      },
      payload: Buffer.from("这是另一本同名书。"),
    });
    expect(repeated.statusCode).toBe(202);
    expect(repeated.json().id).not.toBe(firstId);

    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("损坏.pdf"),
        "x-selfalone-account": "account-a",
      },
      payload: Buffer.from("%PDF-not-complete"),
    });
    expect(failed.statusCode).toBe(202);
    await eventually(
      () => runtime.getBook("account-a", failed.json().id as string),
      (book) => book.parseStatus === "failed" && book.errorCode === "PDF_INVALID",
    );

    const otherAccount = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(otherAccount.json()).toEqual({ books: [] });

    await app.close();
    apps.length = 0;
    await runtime.close();
    runtimes.length = 0;
    const restoredRuntime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
    });
    runtimes.push(restoredRuntime);
    const restored = await restoredRuntime.listBooks("account-a", "同名");
    expect(restored).toHaveLength(2);
    expect(restored.map((book) => book.id)).toContain(firstId);
  });

  it("rejects unsupported files before creating a library record", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-"));
    objectDirectories.push(objectDirectory);
    const runtime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
    });
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);
    const app = createApp({ readiness: () => runtime.ready(), library: runtime });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "archive.zip",
        "x-selfalone-account": "account-a",
      },
      payload: Buffer.from("not a book"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "UNSUPPORTED_BOOK_FORMAT" });
    const [count] = await administration.unsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM "${schema}".books`,
    );
    expect(count?.count).toBe(0);
  });

  it("keeps a text book processing until its readable sections are published", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-"));
    objectDirectories.push(objectDirectory);
    let releasePublisher = () => {};
    const publisherGate = new Promise<void>((resolve) => {
      releasePublisher = resolve;
    });
    let markPublisherStarted = () => {};
    const publisherStarted = new Promise<void>((resolve) => {
      markPublisherStarted = resolve;
    });
    const runtime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: {
        prepareTextBook: async (accountId, bookId) => {
          markPublisherStarted();
          await publisherGate;
          return {
            accountId,
            bookId,
            extracted: {
              format: "txt" as const,
              fileVersion: 1,
              title: "等待发布",
              author: null,
              sections: [{
                sectionId: "txt:00000000",
                title: "等待发布",
                order: 0,
                text: "章节必须先发布。",
              }],
            },
          };
        },
        publishPreparedTextBook: async () => ({ fileVersion: 1, sectionCount: 1 }),
      },
    });
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);

    try {
      const imported = await runtime.importBook(
        "account-a",
        "等待发布.txt",
        Buffer.from("第一章\n章节必须先发布。"),
      );
      await publisherStarted;

      expect((await runtime.getBook("account-a", imported.id)).parseStatus).toBe("processing");

      releasePublisher();
      const ready = await eventually(
        () => runtime.getBook("account-a", imported.id),
        (book) => book.parseStatus === "ready_text",
      );
      expect(ready.parseStatus).toBe("ready_text");
    } finally {
      releasePublisher();
    }
  });

  it("rolls back text sections when the ready transition cannot commit", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-"));
    objectDirectories.push(objectDirectory);
    const textPublisher = {
      prepareTextBook: async (accountId: string, bookId: string) => ({
        accountId,
        bookId,
        extracted: {
          format: "txt" as const,
          fileVersion: 1,
          title: "原子发布",
          author: null,
          sections: [],
        },
      }),
      publishPreparedTextBook: async (
        prepared: { accountId: string; bookId: string },
        transaction: TransactionSql,
      ) => {
        await transaction`
          INSERT INTO book_sections (
            account_id, book_id, file_version, section_id, section_order, title, body
          ) VALUES (
            ${prepared.accountId}, ${prepared.bookId}, 1, 'txt:00000000', 0,
            '等待发布', '这段正文不得在失败后残留。'
          )
        `;
        throw new Error("TEXT_PUBLICATION_ABORTED");
      },
    };
    const runtime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
      textPublisher,
    });
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);

    const imported = await runtime.importBook(
      "account-a",
      "原子发布.txt",
      Buffer.from("第一章\n章节与可读状态必须共同提交。"),
    );
    const failed = await eventually(
      () => runtime.getBook("account-a", imported.id),
      (book) => book.parseStatus === "failed",
    );
    expect(failed.errorCode).toBe("TEXT_PUBLICATION_ABORTED");

    const [sections] = await administration.unsafe<Array<{ count: number }>>(`
      SELECT count(*)::int AS count
      FROM "${schema}".book_sections
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    expect(sections?.count).toBe(0);
  });
});
