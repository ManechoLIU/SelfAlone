import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { extractTextBook } from "@selfalone/domain";
import { createApp } from "./app";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";
import { createTextReaderRuntime, type TextReaderRuntime } from "./text-reader";

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

function realEpub() {
  return storedZip({
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    "OEBPS/content.opf": `
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>雨后山亭</dc:title><dc:creator>林野</dc:creator></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" properties="nav"/>
          <item id="ending" href="chapters/ending.xhtml"/>
          <item id="opening" href="chapters/opening.xhtml"/>
        </manifest>
        <spine><itemref idref="opening"/><itemref idref="ending"/></spine>
      </package>`,
    "OEBPS/nav.xhtml": `
      <html><body><nav epub:type="toc"><ol>
        <li><a href="chapters/opening.xhtml">雨停以后</a></li>
        <li><a href="chapters/ending.xhtml#last">山路尽头</a></li>
      </ol></nav></body></html>`,
    "OEBPS/chapters/opening.xhtml":
      "<html><body><h1>第一章</h1><p>一阵雨过后，远山重新显出来。</p></body></html>",
    "OEBPS/chapters/ending.xhtml":
      "<html><body><h1 id='last'>第二章</h1><p>亭中只有风声，和一盏未冷的茶。</p></body></html>",
  });
}

describe("M1-F2-B main integration", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  const libraries: LibraryRuntime[] = [];
  const readers: TextReaderRuntime[] = [];
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(libraries.splice(0).map((runtime) => runtime.close()));
    await Promise.all(readers.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(
      objectDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("exports text extraction through the domain package boundary", async () => {
    const domain = await import("@selfalone/domain") as Record<string, unknown>;

    expect(typeof domain.extractTextBook).toBe("function");
  });

  it("publishes imported TXT and EPUB sections and restores their positions after restart", async () => {
    const schema = `text_reader_integration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-reader-integration-"));
    objectDirectories.push(objectDirectory);

    const reader = await createTextReaderRuntime({ databaseUrl, objectDirectory, extractTextBook });
    readers.push(reader);
    const libraryOptions = {
      databaseUrl,
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: reader,
    };
    const library = await createLibraryRuntime(libraryOptions);
    libraries.push(library);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);
    const dependencies = {
      readiness: async () => (await library.ready()) && (await reader.ready()),
      library,
      textReader: reader,
    };
    const app = createApp(dependencies);
    apps.push(app);

    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("夜航手记.txt"),
        "x-selfalone-account": "account-a",
      },
      payload: Buffer.from("序章\n灯塔亮了。\n\n第一章 风从海上来\n船离开了港口。"),
    });
    expect(imported.statusCode).toBe(202);
    const bookId = imported.json().id as string;

    const sections = await eventually(
      async () => app.inject({
        method: "GET",
        url: `/api/v1/books/${bookId}/content/sections`,
        headers: { "x-selfalone-account": "account-a" },
      }),
      (response) => response.statusCode === 200 && response.json().sections?.length === 2,
    );
    expect(sections.json()).toMatchObject({
      fileVersion: 1,
      sections: [
        { sectionId: "txt:00000000", order: 0 },
        { sectionId: "txt:00000010", order: 1 },
      ],
    });

    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${bookId}/position`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000010", offset: 4 },
        background: "dark",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: 1, background: "dark" });

    const importedEpub = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("雨后山亭.epub"),
        "x-selfalone-account": "account-a",
      },
      payload: realEpub(),
    });
    expect(importedEpub.statusCode).toBe(202);
    expect(importedEpub.json()).toMatchObject({
      title: "雨后山亭",
      format: "epub",
      parseStatus: "processing",
    });
    const epubBookId = importedEpub.json().id as string;
    const epubSections = await eventually(
      async () => app.inject({
        method: "GET",
        url: `/api/v1/books/${epubBookId}/content/sections`,
        headers: { "x-selfalone-account": "account-a" },
      }),
      (response) => response.statusCode === 200 && response.json().sections?.length === 2,
    );
    expect(epubSections.json()).toMatchObject({
      fileVersion: 1,
      sections: [
        { sectionId: "epub:opening", title: "雨停以后", order: 0 },
        { sectionId: "epub:ending", title: "山路尽头", order: 1 },
      ],
    });
    const savedEpub = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${epubBookId}/position`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId: "epub:ending", offset: 3 },
        background: "light",
      },
    });
    expect(savedEpub.statusCode).toBe(200);
    expect(savedEpub.json()).toMatchObject({ version: 1, background: "light" });

    await app.close();
    apps.length = 0;
    await library.close();
    libraries.length = 0;
    await reader.close();
    readers.length = 0;

    const restoredReader = await createTextReaderRuntime({
      databaseUrl,
      objectDirectory,
      extractTextBook,
    });
    readers.push(restoredReader);
    const restoredLibraryOptions = {
      databaseUrl,
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: restoredReader,
    };
    const restoredLibrary = await createLibraryRuntime(restoredLibraryOptions);
    libraries.push(restoredLibrary);
    const restoredDependencies = {
      readiness: async () => (await restoredLibrary.ready()) && (await restoredReader.ready()),
      library: restoredLibrary,
      textReader: restoredReader,
    };
    const restoredApp = createApp(restoredDependencies);
    apps.push(restoredApp);

    const reading = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${bookId}/reading`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(reading.statusCode).toBe(200);
    expect(reading.json()).toMatchObject({
      bookId,
      fileVersion: 1,
      position: {
        locator: { sectionId: "txt:00000010", offset: 4 },
        background: "dark",
        version: 1,
      },
    });

    const restoredEpub = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${epubBookId}/reading`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(restoredEpub.statusCode).toBe(200);
    expect(restoredEpub.json()).toMatchObject({
      bookId: epubBookId,
      title: "雨后山亭",
      author: "林野",
      fileVersion: 1,
      position: {
        locator: { sectionId: "epub:ending", offset: 3 },
        background: "light",
        version: 1,
      },
    });
  });
});
