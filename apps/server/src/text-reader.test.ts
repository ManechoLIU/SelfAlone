import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createTextReaderRuntime, registerTextReaderRoutes, type TextReaderRuntime } from "./text-reader";

const domainModulePath = "../../../packages/domain/src/text-reader";
const { extractTextBook } = await import(domainModulePath) as {
  extractTextBook(input: { filename: string; bytes: Buffer; fileVersion: number }): {
    format: "epub" | "txt";
    fileVersion: number;
    title: string;
    author: string | null;
    sections: Array<{ sectionId: string; title: string; order: number; text: string }>;
  };
};

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

function storedZip(entries: Record<string, string>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const body = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, filename);
    localOffset += local.length + filename.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function epubFixture() {
  return storedZip({
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
    "OPS/content.opf": `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>山中书</dc:title><dc:creator>林野</dc:creator></metadata>
      <manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest>
      <spine><itemref idref="two"/><itemref idref="one"/></spine></package>`,
    "OPS/one.xhtml": "<html><body><h1>后记</h1><p>后来，山门又开了。</p></body></html>",
    "OPS/two.xhtml": "<html><body><h1>入山</h1><p>她在雨中抵达。</p></body></html>",
  });
}

describe("M1-F2-B text reader runtime and routes", () => {
  const runtimes: TextReaderRuntime[] = [];
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

  it("publishes real EPUB/TXT sections, isolates owners and restores one position after restart", async () => {
    const schema = `text_reader_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-reader-"));
    objectDirectories.push(objectDirectory);
    await createSchema(administration, schema);

    const txt = Buffer.from("第一章 风起\n风从海上来。\n\n第二章 靠岸\n灯塔越来越近。", "utf8");
    const epub = epubFixture();
    await seedBook(administration, schema, objectDirectory, {
      accountId: "account-a",
      bookId: "txt-book",
      filename: "夜航.txt",
      format: "txt",
      bytes: txt,
    });
    await seedBook(administration, schema, objectDirectory, {
      accountId: "account-a",
      bookId: "epub-book",
      filename: "山中书.epub",
      format: "epub",
      bytes: epub,
    });
    await seedBook(administration, schema, objectDirectory, {
      accountId: "account-b",
      bookId: "private-book",
      filename: "私有.txt",
      format: "txt",
      bytes: Buffer.from("第一章\n只属于另一个账户。"),
    });

    const runtime = await createTextReaderRuntime({
      databaseUrl: databaseUrl.toString(),
      objectDirectory,
      extractTextBook,
    });
    runtimes.push(runtime);
    await runtime.publishTextBook("account-a", "txt-book");
    await runtime.publishTextBook("account-a", "epub-book");
    await runtime.publishTextBook("account-b", "private-book");

    const app = createApp({ readiness: () => runtime.ready() });
    registerTextReaderRoutes(app, runtime);
    apps.push(app);

    const epubSections = await app.inject({
      method: "GET",
      url: "/api/v1/books/epub-book/content/sections",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(epubSections.statusCode).toBe(200);
    expect(epubSections.json().sections.map((section: { title: string }) => section.title)).toEqual([
      "入山",
      "后记",
    ]);

    const hidden = await app.inject({
      method: "GET",
      url: "/api/v1/books/private-book/reading",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(hidden.statusCode).toBe(404);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/books/txt-book/position",
      headers: { "x-selfalone-account": "account-a", "content-type": "application/json" },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000015", offset: 4 },
        background: "dark",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      version: 1,
      locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000015", offset: 4 },
      background: "dark",
    });

    await app.close();
    apps.length = 0;
    await runtime.close();
    runtimes.length = 0;
    const restoredRuntime = await createTextReaderRuntime({
      databaseUrl: databaseUrl.toString(),
      objectDirectory,
      extractTextBook,
    });
    runtimes.push(restoredRuntime);
    const restoredApp = createApp({ readiness: () => restoredRuntime.ready() });
    registerTextReaderRoutes(restoredApp, restoredRuntime);
    apps.push(restoredApp);
    const restored = await restoredApp.inject({
      method: "GET",
      url: "/api/v1/books/txt-book/reading",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      contentMode: "text",
      fileVersion: 1,
      title: "夜航",
      position: {
        version: 1,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000015", offset: 4 },
        background: "dark",
      },
    });
  });

  it("rejects an old file version and preserves the latest saved position", async () => {
    const setup = await setupSingleBook(runtimes, databases, objectDirectories);
    const app = createApp({ readiness: () => setup.runtime.ready() });
    registerTextReaderRoutes(app, setup.runtime);
    apps.push(app);
    const first = await setup.runtime.savePosition("account-a", "txt-book", {
      expectedVersion: 0,
      locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 2 },
      background: "light",
    });
    expect(first.version).toBe(1);

    await setup.administration.unsafe(`
      INSERT INTO "${setup.schema}".book_files
        (id, account_id, book_id, object_key, original_filename, version)
      VALUES ('file-v2', 'account-a', 'txt-book', 'account-a/txt-book/original/2/book.txt', '新版本.txt', 2)
    `);
    const stale = await app.inject({
      method: "PUT",
      url: "/api/v1/books/txt-book/position",
      headers: { "x-selfalone-account": "account-a", "content-type": "application/json" },
      payload: {
        expectedVersion: 1,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 9 },
        background: "dark",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ code: "STALE_VERSION" });
    expect(await setup.runtime.getReading("account-a", "txt-book")).toMatchObject({
      fileVersion: 2,
      position: null,
    });
    const [stored] = await setup.administration.unsafe<Array<{ locator: unknown; version: number }>>(`
      SELECT locator, version FROM "${setup.schema}".reading_positions
      WHERE account_id = 'account-a' AND book_id = 'txt-book'
    `);
    expect(stored).toMatchObject({
      version: 1,
      locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 2 },
    });
  });
});

async function createSchema(administration: Sql, schema: string) {
  await administration.unsafe(`
    CREATE TABLE "${schema}".accounts (id text PRIMARY KEY);
    CREATE TABLE "${schema}".books (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES "${schema}".accounts(id),
      title text NOT NULL,
      author text,
      local_format text NOT NULL,
      parse_status text NOT NULL,
      section_count integer NOT NULL DEFAULT 0,
      UNIQUE (account_id, id)
    );
    CREATE TABLE "${schema}".book_files (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      book_id text NOT NULL,
      object_key text NOT NULL,
      original_filename text NOT NULL,
      version integer NOT NULL,
      UNIQUE (account_id, book_id, version),
      FOREIGN KEY (account_id, book_id) REFERENCES "${schema}".books(account_id, id)
    );
    CREATE TABLE "${schema}".book_sections (
      account_id text NOT NULL,
      book_id text NOT NULL,
      file_version integer NOT NULL,
      section_id text NOT NULL,
      section_order integer NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      PRIMARY KEY (account_id, book_id, file_version, section_id),
      UNIQUE (account_id, book_id, file_version, section_order),
      FOREIGN KEY (account_id, book_id) REFERENCES "${schema}".books(account_id, id),
      FOREIGN KEY (account_id, book_id, file_version)
        REFERENCES "${schema}".book_files(account_id, book_id, version)
    );
    CREATE TABLE "${schema}".reading_positions (
      account_id text NOT NULL,
      book_id text NOT NULL,
      locator jsonb NOT NULL,
      background text NOT NULL,
      version integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, book_id),
      FOREIGN KEY (account_id, book_id) REFERENCES "${schema}".books(account_id, id)
    );
    INSERT INTO "${schema}".accounts (id) VALUES ('account-a'), ('account-b');
  `);
}

async function seedBook(
  administration: Sql,
  schema: string,
  objectDirectory: string,
  input: { accountId: string; bookId: string; filename: string; format: "epub" | "txt"; bytes: Buffer },
) {
  const objectKey = `${input.accountId}/${input.bookId}/original/1/book.${input.format}`;
  const objectPath = join(objectDirectory, ...objectKey.split("/"));
  await mkdir(dirname(objectPath), { recursive: true });
  await writeFile(objectPath, input.bytes);
  await administration.unsafe(`
    INSERT INTO "${schema}".books
      (id, account_id, title, author, local_format, parse_status, section_count)
    VALUES ('${input.bookId}', '${input.accountId}', '${input.filename.replace(/\.[^.]+$/, "")}', NULL, '${input.format}', 'ready_text', 0);
    INSERT INTO "${schema}".book_files
      (id, account_id, book_id, object_key, original_filename, version)
    VALUES ('file-${input.bookId}', '${input.accountId}', '${input.bookId}', '${objectKey}', '${input.filename}', 1);
  `);
}

async function setupSingleBook(
  runtimes: TextReaderRuntime[],
  databases: Array<{ administration: Sql; schema: string }>,
  objectDirectories: string[],
) {
  const schema = `text_reader_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  databases.push({ administration, schema });
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-reader-"));
  objectDirectories.push(objectDirectory);
  await createSchema(administration, schema);
  await seedBook(administration, schema, objectDirectory, {
    accountId: "account-a",
    bookId: "txt-book",
    filename: "位置.txt",
    format: "txt",
    bytes: Buffer.from("第一章\n位置不会丢失。"),
  });
  const runtime = await createTextReaderRuntime({
    databaseUrl: databaseUrl.toString(),
    objectDirectory,
    extractTextBook,
  });
  runtimes.push(runtime);
  await runtime.publishTextBook("account-a", "txt-book");
  return { administration, schema, runtime };
}
