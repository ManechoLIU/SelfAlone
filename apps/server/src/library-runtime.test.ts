import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createLibraryRuntime, LibraryRuntime } from "./library-runtime";

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

function createTestTextPublisher() {
  return {
    prepareTextBook: async (accountId: string, bookId: string) => ({
      accountId,
      bookId,
      extracted: {
        format: "txt" as const,
        fileVersion: 1,
        title: "测试正文",
        author: null,
        sections: [{
          sectionId: "txt:00000000",
          title: "测试正文",
          order: 0,
          text: "测试正文。",
        }],
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
          '测试正文', '测试正文。'
        )
      `;
      return { fileVersion: 1, sectionCount: 1 };
    },
  };
}

function createProgressTextPublisher() {
  const sections = [
    {
      sectionId: "txt:00000000",
      title: "第一段",
      order: 0,
      text: "abcd",
    },
    {
      sectionId: "txt:00000004",
      title: "第二段",
      order: 1,
      text: "ef",
    },
  ];
  return {
    prepareTextBook: async (accountId: string, bookId: string) => ({
      accountId,
      bookId,
      extracted: {
        format: "txt" as const,
        fileVersion: 1,
        title: "进度书",
        author: null,
        sections,
      },
    }),
    publishPreparedTextBook: async (
      prepared: {
        accountId: string;
        bookId: string;
        extracted: { fileVersion: number; sections: typeof sections };
      },
      transaction: TransactionSql,
    ) => {
      for (const section of prepared.extracted.sections) {
        await transaction`
          INSERT INTO book_sections (
            account_id, book_id, file_version, section_id, section_order, title, body
          ) VALUES (
            ${prepared.accountId}, ${prepared.bookId}, ${prepared.extracted.fileVersion},
            ${section.sectionId}, ${section.order}, ${section.title}, ${section.text}
          )
        `;
      }
      return { fileVersion: prepared.extracted.fileVersion, sectionCount: sections.length };
    },
  };
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
      textPublisher: createTestTextPublisher(),
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
      textPublisher: createTestTextPublisher(),
    });
    runtimes.push(restoredRuntime);
    const restored = await restoredRuntime.listBooks("account-a", "同名");
    expect(restored).toHaveLength(2);
    expect(restored.map((book) => book.id)).toContain(firstId);
  });

  it("returns normalized account-scoped reading progress for list and detail", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-progress-"));
    objectDirectories.push(objectDirectory);

    const runtime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: createProgressTextPublisher(),
    });
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at)
      VALUES ('account-a', now()), ('account-b', now())
    `);
    const app = createApp({ readiness: () => runtime.ready(), library: runtime });
    apps.push(app);

    const imported = await runtime.importBook(
      "account-a",
      "进度书.txt",
      Buffer.from("正文 fixture"),
    );
    await eventually(
      () => runtime.getBook("account-a", imported.id),
      (book) => book.parseStatus === "ready_text",
    );

    const initialList = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(initialList.statusCode).toBe(200);
    expect(initialList.json().books).toContainEqual(expect.objectContaining({
      id: imported.id,
      parseStatus: "ready_text",
      progressPercent: 0,
    }));
    const initialDetail = await app.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(initialDetail.statusCode).toBe(200);
    expect(initialDetail.json()).toMatchObject({ progressPercent: 0 });

    await administration.unsafe(`
      INSERT INTO "${schema}".reading_positions (
        account_id, book_id, locator, background, version
      ) VALUES (
        'account-a', '${imported.id}',
        '{"kind":"text","fileVersion":1,"sectionId":"txt:00000004","offset":0}',
        'light', 1
      )
    `);
    const positionedList = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(positionedList.json().books).toContainEqual(expect.objectContaining({
      id: imported.id,
      // 4 characters before the locator / 6 total = 66.66%; nearest integer is 67.
      progressPercent: 67,
    }));
    const positionedDetail = await app.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(positionedDetail.json()).toMatchObject({ progressPercent: 67 });

    await app.close();
    apps.length = 0;
    await runtime.close();
    runtimes.length = 0;
    const restoredRuntime = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: createProgressTextPublisher(),
    });
    runtimes.push(restoredRuntime);
    const restoredApp = createApp({ readiness: () => restoredRuntime.ready(), library: restoredRuntime });
    apps.push(restoredApp);
    const restored = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(restored.json()).toMatchObject({ progressPercent: 67 });

    for (const parseStatus of ["processing", "ready_pages", "failed"] as const) {
      const bookId = `status-${parseStatus}`;
      await administration.unsafe(`
        INSERT INTO "${schema}".books (
          id, account_id, title, source_label, local_format, parse_status,
          parse_error_code, section_count, page_count
        ) VALUES (
          '${bookId}', 'account-a', '${parseStatus}', '本地', 'txt', '${parseStatus}',
          NULL, 0, NULL
        );
        INSERT INTO "${schema}".book_files (
          id, account_id, book_id, object_key, original_filename, byte_size, sha256, version
        ) VALUES (
          '${bookId}-file', 'account-a', '${bookId}',
          'account-a/${bookId}/original/1/original.txt', '${parseStatus}.txt', 1, 'fixture', 1
        )
      `);
    }
    const statusList = await restoredApp.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    for (const parseStatus of ["processing", "ready_pages", "failed"] as const) {
      expect(statusList.json().books).toContainEqual(expect.objectContaining({
        id: `status-${parseStatus}`,
        parseStatus,
        progressPercent: null,
      }));
      const statusDetail = await restoredApp.inject({
        method: "GET",
        url: `/api/v1/books/status-${parseStatus}`,
        headers: { "x-selfalone-account": "account-a" },
      });
      expect(statusDetail.json()).toMatchObject({ parseStatus, progressPercent: null });
    }

    const hiddenList = await restoredApp.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(hiddenList.json()).toEqual({ books: [] });
    const hiddenDetail = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}`,
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(hiddenDetail.statusCode).toBe(404);

    await administration.unsafe(`
      UPDATE "${schema}".reading_positions
      SET locator = '{"kind":"text","fileVersion":2,"sectionId":"txt:00000004","offset":0}'
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    const stale = await restoredRuntime.getBook("account-a", imported.id);
    expect(stale.progressPercent).toBe(0);

    await administration.unsafe(`
      UPDATE "${schema}".reading_positions
      SET locator = '{"kind":"text","fileVersion":1,"sectionId":"txt:missing","offset":0}'
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    const invalid = await restoredRuntime.getBook("account-a", imported.id);
    expect(invalid.progressPercent).toBe(0);

    await administration.unsafe(`
      UPDATE "${schema}".book_sections
      SET body = CASE section_id
        WHEN 'txt:00000000' THEN 'a😀b'
        ELSE ''
      END
      WHERE account_id = 'account-a' AND book_id = '${imported.id}' AND file_version = 1;
      UPDATE "${schema}".reading_positions
      SET locator = '{"kind":"text","fileVersion":1,"sectionId":"txt:00000000","offset":3}'
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    const emojiMiddle = await restoredRuntime.getBook("account-a", imported.id);
    expect(emojiMiddle.progressPercent).toBe(75);

    await administration.unsafe(`
      UPDATE "${schema}".reading_positions
      SET locator = '{"kind":"text","fileVersion":1,"sectionId":"txt:00000000","offset":4}'
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    const emojiEnd = await restoredRuntime.getBook("account-a", imported.id);
    expect(emojiEnd.progressPercent).toBe(100);

    await administration.unsafe(`
      UPDATE "${schema}".reading_positions
      SET locator = '{"kind":"text","fileVersion":1,"sectionId":"txt:00000000","offset":5}'
      WHERE account_id = 'account-a' AND book_id = '${imported.id}'
    `);
    const emojiOverflow = await restoredRuntime.getBook("account-a", imported.id);
    expect(emojiOverflow.progressPercent).toBe(0);
  });

  it("batches current files, sections and positions for a multi-book shelf", async () => {
    const schema = `library_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-library-progress-batch-"));
    objectDirectories.push(objectDirectory);
    const queries: string[] = [];
    const sql = postgres(isolatedUrl.toString(), {
      max: 4,
      debug: (_connection, query) => queries.push(query),
    });
    const runtime = new LibraryRuntime(
      sql,
      objectDirectory,
      0,
      createProgressTextPublisher(),
    );
    await runtime.initialize();
    runtimes.push(runtime);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);

    const imported = await Promise.all(
      Array.from({ length: 10 }, (_, index) => runtime.importBook(
        "account-a",
        `进度书-${index}.txt`,
        Buffer.from(`正文 fixture ${index}`),
      )),
    );
    await Promise.all(imported.map((book) => eventually(
      () => runtime.getBook("account-a", book.id),
      (book) => book.parseStatus === "ready_text",
    )));
    const positionedBook = imported[0];
    if (!positionedBook) throw new Error("EXPECTED_BOOK_FIXTURE");
    await administration.unsafe(`
      INSERT INTO "${schema}".reading_positions (
        account_id, book_id, locator, background, version
      ) VALUES (
        'account-a', '${positionedBook.id}',
        '{"kind":"text","fileVersion":1,"sectionId":"txt:00000004","offset":0}',
        'light', 1
      )
    `);
    queries.length = 0;

    const books = await runtime.listBooks("account-a");
    expect(books).toHaveLength(10);
    expect(books.find((book) => book.id === positionedBook.id)?.progressPercent).toBe(67);
    expect(books.filter((book) => book.id !== positionedBook.id).every((book) => book.progressPercent === 0)).toBe(true);
    expect(queries).toHaveLength(5);
    expect(queries.filter((query) => /SELECT book_id AS "bookId", max\(version\)/.test(query))).toHaveLength(1);
    const sectionQueries = queries.filter((query) => /section_id AS "sectionId"/.test(query));
    expect(sectionQueries).toHaveLength(1);
    expect(sectionQueries[0]).toContain("char_length(section.body)");
    expect(sectionQueries[0]).toContain("regexp_count(section.body");
    expect(sectionQueries[0]).not.toContain("section.body AS text");
    expect(queries.filter((query) => /SELECT book_id AS "bookId", locator/.test(query))).toHaveLength(1);
    expect(queries.filter((query) => /ANY/.test(query))).toHaveLength(3);
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

  it("fails text imports closed when no text publisher is configured", async () => {
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

    const imported = await runtime.importBook(
      "account-a",
      "缺少发布器.txt",
      Buffer.from("正文不得被标记为可读。"),
    );
    const failed = await eventually(
      () => runtime.getBook("account-a", imported.id),
      (book) => book.parseStatus === "failed",
    );
    expect(failed.errorCode).toBe("TEXT_PUBLISHER_UNAVAILABLE");
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
