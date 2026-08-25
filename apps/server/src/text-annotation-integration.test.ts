import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { extractTextBook } from "@selfalone/domain";
import { createApp } from "./app";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";
import {
  bootstrapTextAnnotationSchemaForTest,
  createTextAnnotationRuntime,
  type TextAnnotationRuntime,
} from "./text-annotation-runtime";
import { createTextReaderRuntime, type TextReaderRuntime } from "./text-reader";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
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
      '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
    "OPS/content.opf": `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>山中书</dc:title><dc:creator>林野</dc:creator></metadata>
      <manifest>
        <item id="opening" href="opening.xhtml"/>
        <item id="ending" href="ending.xhtml"/>
      </manifest>
      <spine><itemref idref="opening"/><itemref idref="ending"/></spine></package>`,
    "OPS/opening.xhtml": "<html><body><h1>入山</h1><p>她在雨中抵达。</p></body></html>",
    "OPS/ending.xhtml": "<html><body><h1>后记</h1><p>后来，山门又开了。</p></body></html>",
  });
}

describe("M1-F2-D text annotations against real PostgreSQL", () => {
  const apps: FastifyInstance[] = [];
  const libraries: LibraryRuntime[] = [];
  const readers: TextReaderRuntime[] = [];
  const annotations: TextAnnotationRuntime[] = [];
  const auxiliaryDatabases: Sql[] = [];
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(annotations.splice(0).map((runtime) => runtime.close()));
    await Promise.all(auxiliaryDatabases.splice(0).map((database) => database.end()));
    await Promise.all(libraries.splice(0).map((runtime) => runtime.close()));
    await Promise.all(readers.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(objectDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("persists highlight/thought and titleless note CRUD, then keeps owners and file versions isolated", async () => {
    const schema = `text_annotation_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-annotation-"));
    objectDirectories.push(objectDirectory);

    const reader = await createTextReaderRuntime({ databaseUrl, objectDirectory, extractTextBook });
    readers.push(reader);
    const library = await createLibraryRuntime({
      databaseUrl,
      objectDirectory,
      parseDelayMs: 0,
      textPublisher: reader,
    });
    libraries.push(library);
    await expect(createTextAnnotationRuntime({ databaseUrl })).rejects.toThrow("TEXT_ANNOTATION_SCHEMA_MISSING");
    await bootstrapTextAnnotationSchemaForTest({ databaseUrl });
    const annotation = await createTextAnnotationRuntime({ databaseUrl });
    annotations.push(annotation);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at)
      VALUES ('account-a', now()), ('account-b', now())
    `);

    const imported = await library.importBook(
      "account-a",
      "夜航.txt",
      Buffer.from("序章\n灯塔亮了。\n\n第一章 风起\n风从海上来。", "utf8"),
    );
    const book = await eventually(
      () => library.getBook("account-a", imported.id),
      (value) => value.parseStatus === "ready_text",
    );
    expect(book.format).toBe("txt");

    const importedEpub = await library.importBook("account-a", "山中书.epub", realEpub());
    const epubBook = await eventually(
      () => library.getBook("account-a", importedEpub.id),
      (value) => value.parseStatus === "ready_text",
    );
    expect(epubBook.format).toBe("epub");

    const app = createApp({ readiness: () => annotation.ready(), textAnnotations: annotation });
    apps.push(app);

    const highlight = await app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "highlight-create-1",
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
        thought: "先把这句留下。",
      },
    });
    expect(highlight.statusCode).toBe(201);
    expect(highlight.json()).toMatchObject({
      status: "saved",
      highlight: {
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
        quote: "灯塔亮了",
        thought: "先把这句留下。",
        version: 1,
      },
    });
    const highlightId = highlight.json().highlight.id as string;

    const repeatedHighlight = await app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "highlight-create-1",
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
        thought: "先把这句留下。",
      },
    });
    expect(repeatedHighlight.statusCode).toBe(201);
    expect(repeatedHighlight.json()).toMatchObject({ status: "saved", highlight: { id: highlightId } });

    const reusedHighlightKey = await app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "highlight-create-1",
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
        thought: "同一个 key 不允许换 payload。",
      },
    });
    expect(reusedHighlightKey.statusCode).toBe(409);
    expect(reusedHighlightKey.json()).toEqual({ code: "IDEMPOTENCY_KEY_REUSED" });

    await expect(
      administration.unsafe(`DELETE FROM "${schema}".book_sections WHERE account_id = 'account-a' AND book_id = '${imported.id}' AND file_version = 1`),
    ).rejects.toMatchObject({ code: "23503" });

    const note = await app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/notes`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { idempotencyKey: "note-create-1", body: "潮水退去后，路才显出来。" },
    });
    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      status: "saved",
      note: { body: "潮水退去后，路才显出来。", source: null, version: 1 },
    });
    const noteId = note.json().note.id as string;

    const annotationTables = await administration<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_name IN ('highlights', 'notes', 'text_highlights', 'laoji_notes')
      ORDER BY table_name
    `;
    expect(annotationTables.map((row) => row.tableName)).toEqual(["highlights", "notes"]);

    const repeatedNote = await app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/notes`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { idempotencyKey: "note-create-1", body: "潮水退去后，路才显出来。" },
    });
    expect(repeatedNote.statusCode).toBe(201);
    expect(repeatedNote.json()).toMatchObject({ status: "saved", note: { id: noteId } });

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}/annotations`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().highlights).toHaveLength(1);
    expect(listed.json().notes).toHaveLength(1);
    expect(listed.json()).toMatchObject({
      fileVersion: 1,
      highlights: [{ id: highlightId, quote: "灯塔亮了" }],
      notes: [{ id: noteId, body: "潮水退去后，路才显出来。", source: null }],
    });

    const concurrentHighlights = await Promise.all([1, 2].map(() => app.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "highlight-create-concurrent",
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
        thought: "同一 key 的真实并发请求",
      },
    })));
    expect(concurrentHighlights.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(concurrentHighlights[0]?.json().highlight.id).toBe(concurrentHighlights[1]?.json().highlight.id);

    const epubHighlight = await app.inject({
      method: "POST",
      url: `/api/v1/books/${importedEpub.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "epub-highlight-1",
        locator: { kind: "text", fileVersion: 1, sectionId: "epub:opening", offset: 4 },
        endOffset: 10,
        thought: "真实 EPUB 的定位也必须可回原文。",
      },
    });
    expect(epubHighlight.statusCode).toBe(201);
    expect(epubHighlight.json()).toMatchObject({
      status: "saved",
      highlight: {
        locator: { kind: "text", fileVersion: 1, sectionId: "epub:opening", offset: 4 },
        quote: "她在雨中抵达",
      },
    });

    const editedHighlight = await app.inject({
      method: "PATCH",
      url: `/api/v1/books/${imported.id}/highlights/${highlightId}`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedVersion: 1, thought: "回头再读一次。" },
    });
    expect(editedHighlight.statusCode).toBe(200);
    expect(editedHighlight.json()).toMatchObject({ status: "saved", highlight: { version: 2, thought: "回头再读一次。" } });

    const editedNote = await app.inject({
      method: "PATCH",
      url: `/api/v1/books/${imported.id}/notes/${noteId}`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedVersion: 1, body: "改过的独立记录。" },
    });
    expect(editedNote.statusCode).toBe(200);
    expect(editedNote.json()).toMatchObject({ status: "saved", note: { version: 2, body: "改过的独立记录。" } });

    apps.pop();
    await app.close();
    annotations.pop();
    await annotation.close();
    const restoredAnnotation = await createTextAnnotationRuntime({ databaseUrl });
    annotations.push(restoredAnnotation);
    const restoredApp = createApp({
      readiness: () => restoredAnnotation.ready(),
      textAnnotations: restoredAnnotation,
    });
    apps.push(restoredApp);
    const afterRestart = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}/annotations`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json()).toMatchObject({ fileVersion: 1 });
    expect(afterRestart.json().highlights).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: highlightId, thought: "回头再读一次。" }),
    ]));
    expect(afterRestart.json().notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: noteId, body: "改过的独立记录。" }),
    ]));

    const foreign = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}/annotations`,
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(foreign.statusCode).toBe(404);

    const publisher = postgres(databaseUrl, { max: 1 });
    auxiliaryDatabases.push(publisher);
    let updateDuringPublish: Promise<unknown> | undefined;
    await publisher.begin(async (transaction) => {
      await transaction`
        SELECT book.id
        FROM books AS book
        JOIN book_files AS file ON file.account_id = book.account_id AND file.book_id = book.id
        WHERE book.account_id = 'account-a' AND book.id = ${imported.id}
        ORDER BY file.version DESC
        LIMIT 1
        FOR UPDATE OF book, file
      `;
      updateDuringPublish = restoredAnnotation.updateHighlight("account-a", imported.id, highlightId, {
        expectedVersion: 2,
        thought: "发布窗口中的旧请求",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await transaction`
        INSERT INTO book_files (
          id, account_id, book_id, object_key, original_filename, byte_size, sha256, version
        ) VALUES (
          ${randomUUID()}, 'account-a', ${imported.id}, ${`account-a/${imported.id}/original/2/original.txt`},
          '夜航.txt', 1, 'version-two', 2
        )
      `;
      await transaction`
        INSERT INTO book_sections (
          account_id, book_id, file_version, section_id, section_order, title, body
        ) VALUES ('account-a', ${imported.id}, 2, 'txt:v2', 0, '序章', '新版本正文')
      `;
      await transaction`
        UPDATE books
        SET parse_status = 'ready_text', section_count = 1
        WHERE account_id = 'account-a' AND id = ${imported.id}
      `;
    });
    await expect(updateDuringPublish).rejects.toThrow("STALE_VERSION");

    let deleteDuringPublish: Promise<unknown> | undefined;
    await publisher.begin(async (transaction) => {
      await transaction`
        SELECT book.id
        FROM books AS book
        JOIN book_files AS file ON file.account_id = book.account_id AND file.book_id = book.id
        WHERE book.account_id = 'account-a' AND book.id = ${imported.id}
        ORDER BY file.version DESC
        LIMIT 1
        FOR UPDATE OF book, file
      `;
      deleteDuringPublish = restoredAnnotation.deleteHighlight("account-a", imported.id, highlightId, 2);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await transaction`
        INSERT INTO book_files (
          id, account_id, book_id, object_key, original_filename, byte_size, sha256, version
        ) VALUES (
          ${randomUUID()}, 'account-a', ${imported.id}, ${`account-a/${imported.id}/original/3/original.txt`},
          '夜航.txt', 1, 'version-three', 3
        )
      `;
      await transaction`
        INSERT INTO book_sections (
          account_id, book_id, file_version, section_id, section_order, title, body
        ) VALUES ('account-a', ${imported.id}, 3, 'txt:v3', 0, '序章', '第三版本正文')
      `;
      await transaction`
        UPDATE books
        SET parse_status = 'ready_text', section_count = 1
        WHERE account_id = 'account-a' AND id = ${imported.id}
      `;
    });
    await expect(deleteDuringPublish).rejects.toThrow("STALE_VERSION");

    const afterVersion = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${imported.id}/annotations`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(afterVersion.statusCode).toBe(200);
    expect(afterVersion.json()).toMatchObject({ fileVersion: 3, highlights: [], notes: [{ id: noteId }] });

    const staleCreate = await restoredApp.inject({
      method: "POST",
      url: `/api/v1/books/${imported.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "stale-highlight-create",
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 3 },
        endOffset: 7,
      },
    });
    expect(staleCreate.statusCode).toBe(409);
    expect(staleCreate.json()).toEqual({ code: "STALE_VERSION" });

    const deletedHighlight = await restoredApp.inject({
      method: "DELETE",
      url: `/api/v1/books/${imported.id}/highlights/${highlightId}`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedVersion: 2 },
    });
    expect(deletedHighlight.statusCode).toBe(409);
    expect(deletedHighlight.json()).toEqual({ code: "STALE_VERSION" });

    const deletedNote = await restoredApp.inject({
      method: "DELETE",
      url: `/api/v1/books/${imported.id}/notes/${noteId}`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedVersion: 2 },
    });
    expect(deletedNote.statusCode).toBe(200);
    expect(deletedNote.json()).toEqual({ status: "deleted", id: noteId });
  });
});
