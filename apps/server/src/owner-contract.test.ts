import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";
import { migrateOwnerContractSchema, ownerMigrationName } from "./owner-migration";
import { createApp, resolveAccountId } from "./app";
import { createTextAnnotationRuntime, type TextAnnotationRuntime } from "./text-annotation-runtime";
import { migrateTextAnnotationSchema } from "./text-annotation-migration";
import { createTextReaderRuntime, type TextReaderRuntime } from "./text-reader";
import { extractTextBook } from "@selfalone/domain";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("session-neutral account owner contract", () => {
  it("fails closed when no bound account is present", () => {
    expect(() => resolveAccountId({})).toThrow("ACCOUNT_REQUIRED");
    expect(() => resolveAccountId({ "x-selfalone-account": "   " })).toThrow("ACCOUNT_REQUIRED");
    expect(resolveAccountId({ "x-selfalone-account": " account-development-local " })).toBe(
      "account-development-local",
    );
  });
});

describe("owner schema migration contract", () => {
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const libraries: LibraryRuntime[] = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(libraries.splice(0).map((library) => library.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(objectDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("records the owner contract before dependent runtimes are accepted", async () => {
    const schema = `owner_contract_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-owner-contract-"));
    objectDirectories.push(objectDirectory);
    const library = await createLibraryRuntime({
      databaseUrl: isolatedUrl.toString(),
      objectDirectory,
      parseDelayMs: 0,
    });
    libraries.push(library);
    const migrationDatabase = postgres(isolatedUrl.toString(), { max: 1 });
    await migrateOwnerContractSchema(migrationDatabase);
    await migrateOwnerContractSchema(migrationDatabase);
    await migrationDatabase.end();

    const [migration] = await administration<Array<{ name: string | null }>>`
      SELECT to_regclass(${`${schema}.schema_migrations`})::text AS name
    `;
    expect(migration?.name).toBe(`${schema}.schema_migrations`);
    const receipts = await administration.unsafe<Array<{ name: string }>>(
      `SELECT name FROM "${schema}".schema_migrations WHERE name = '${ownerMigrationName}'`,
    );
    expect(receipts).toEqual([{ name: ownerMigrationName }]);
  });

  it("rolls back owner DDL and its receipt when an existing owner is unbound", async () => {
    const schema = `owner_contract_rollback_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(isolatedUrl.toString(), { max: 1 });
    await sql.unsafe(`
      CREATE TABLE accounts (id text PRIMARY KEY);
      INSERT INTO accounts (id) VALUES ('account-development-local');
      CREATE TABLE books (
        id text PRIMARY KEY,
        account_id text,
        title text NOT NULL,
        source_label text NOT NULL
      );
      CREATE TABLE book_files (
        id text PRIMARY KEY,
        account_id text,
        book_id text,
        object_key text NOT NULL,
        original_filename text NOT NULL,
        byte_size integer NOT NULL,
        sha256 text NOT NULL,
        version integer NOT NULL
      );
      CREATE TABLE book_sections (
        account_id text,
        book_id text,
        file_version integer,
        section_id text,
        section_order integer NOT NULL,
        title text NOT NULL,
        body text NOT NULL
      );
      CREATE TABLE reading_positions (
        account_id text,
        book_id text,
        locator jsonb,
        background text NOT NULL,
        version integer NOT NULL
      );
      INSERT INTO books (id, account_id, title, source_label)
      VALUES ('orphan-book', 'account-not-bound', '不可归属', '本地');
    `);

    const [before] = await administration.unsafe<Array<{ rows: number; owners: number }>>(
      `SELECT count(*)::int AS rows, count(DISTINCT account_id)::int AS owners
       FROM "${schema}".books`,
    );
    const beforeConstraints = await administration.unsafe<Array<{ name: string }>>(
      `SELECT conname AS name
       FROM pg_constraint
       WHERE conrelid = '"${schema}".books'::regclass`,
    );
    expect(before).toEqual({ rows: 1, owners: 1 });
    expect(beforeConstraints.map((constraint) => constraint.name)).not.toContain("books_account_id_fkey");

    await expect(migrateOwnerContractSchema(sql)).rejects.toThrow("OWNER_MIGRATION_UNBOUND_BOOK");
    const [receipt] = await administration.unsafe<Array<{ name: string | null }>>(
      `SELECT to_regclass('"${schema}".schema_migrations')::text AS name`,
    );
    expect(receipt?.name).toBeNull();
    const [nullable] = await administration.unsafe<Array<{ isNullable: string }>>(
      `SELECT is_nullable AS "isNullable" FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = 'books' AND column_name = 'account_id'`,
    );
    expect(nullable?.isNullable).toBe("YES");
    await sql.end();
  });
});

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("EXPECTED_STATE_NOT_REACHED");
}

describe("real PostgreSQL owner/version chain", () => {
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const libraries: LibraryRuntime[] = [];
  const readers: TextReaderRuntime[] = [];
  const annotations: TextAnnotationRuntime[] = [];
  const apps: Array<ReturnType<typeof createApp>> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(annotations.splice(0).map((annotation) => annotation.close()));
    await Promise.all(libraries.splice(0).map((library) => library.close()));
    await Promise.all(readers.splice(0).map((reader) => reader.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(objectDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps books, sections, positions, annotations and notes owner-scoped", async () => {
    const schema = `owner_chain_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-owner-chain-"));
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
    const migrationDatabase = postgres(databaseUrl, { max: 1 });
    await migrateOwnerContractSchema(migrationDatabase);
    await migrateTextAnnotationSchema(migrationDatabase);
    await migrationDatabase.end();
    const annotation = await createTextAnnotationRuntime({ databaseUrl });
    annotations.push(annotation);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id) VALUES ('account-a'), ('account-b')
    `);

    const importedA = await library.importBook("account-a", "甲书.txt", Buffer.from("第一章\n甲账户正文", "utf8"));
    const importedB = await library.importBook("account-b", "乙书.txt", Buffer.from("第一章\n乙账户正文", "utf8"));
    await eventually(
      () => library.getBook("account-a", importedA.id),
      (book) => book.parseStatus === "ready_text",
    );
    await eventually(
      () => library.getBook("account-b", importedB.id),
      (book) => book.parseStatus === "ready_text",
    );

    const app = createApp({
      readiness: () => annotation.ready(),
      library,
      textReader: reader,
      textAnnotations: annotation,
    });
    apps.push(app);

    const missingOwner = await app.inject({ method: "GET", url: "/api/v1/books" });
    expect(missingOwner.statusCode).toBe(401);
    expect(missingOwner.json()).toEqual({ code: "ACCOUNT_REQUIRED" });
    const unknownOwner = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-unbound" },
    });
    expect(unknownOwner.statusCode).toBe(403);
    expect(unknownOwner.json()).toEqual({ code: "ACCOUNT_FORBIDDEN" });
    const missingReadingOwner = await app.inject({
      method: "GET",
      url: `/api/v1/books/${importedA.id}/reading`,
    });
    expect(missingReadingOwner.statusCode).toBe(401);
    expect(missingReadingOwner.json()).toEqual({ code: "ACCOUNT_REQUIRED" });
    const missingAnnotationOwner = await app.inject({
      method: "GET",
      url: `/api/v1/books/${importedA.id}/annotations`,
    });
    expect(missingAnnotationOwner.statusCode).toBe(401);
    expect(missingAnnotationOwner.json()).toEqual({ code: "ACCOUNT_REQUIRED" });

    const accountABooks = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    const accountBBooks = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(accountABooks.json().books.map((book: { id: string }) => book.id)).toEqual([importedA.id]);
    expect(accountBBooks.json().books.map((book: { id: string }) => book.id)).toEqual([importedB.id]);

    const hiddenReading = await app.inject({
      method: "GET",
      url: `/api/v1/books/${importedA.id}/reading`,
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(hiddenReading.statusCode).toBe(404);
    const sections = await app.inject({
      method: "GET",
      url: `/api/v1/books/${importedA.id}/content/sections`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(sections.statusCode).toBe(200);
    const sectionId = sections.json().sections[0].sectionId as string;

    const initialPosition = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${importedA.id}/position`,
      headers: {
        "content-type": "application/json",
        "x-selfalone-account": "account-a",
      },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId, offset: 0 },
        background: "light",
      },
    });
    expect(initialPosition.statusCode).toBe(200);

    const concurrentPositions = await Promise.all([1, 2].map((offset) => app.inject({
      method: "PUT",
      url: `/api/v1/books/${importedA.id}/position`,
      headers: {
        "content-type": "application/json",
        "x-selfalone-account": "account-a",
      },
      payload: {
        expectedVersion: 1,
        locator: { kind: "text", fileVersion: 1, sectionId, offset },
        background: "dark",
      },
    })));
    expect(concurrentPositions.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = concurrentPositions.find((response) => response.statusCode === 200);
    expect(winner?.json().version).toBe(2);

    const accountBPosition = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${importedB.id}/position`,
      headers: {
        "content-type": "application/json",
        "x-selfalone-account": "account-b",
      },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000000", offset: 1 },
        background: "light",
      },
    });
    expect(accountBPosition.statusCode).toBe(200);

    const highlight = await app.inject({
      method: "POST",
      url: `/api/v1/books/${importedA.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "owner-chain-highlight",
        locator: { kind: "text", fileVersion: 1, sectionId, offset: 0 },
        endOffset: 2,
      },
    });
    expect(highlight.statusCode).toBe(201);
    const note = await app.inject({
      method: "POST",
      url: `/api/v1/books/${importedA.id}/notes`,
      headers: { "x-selfalone-account": "account-a" },
      payload: { idempotencyKey: "owner-chain-note", body: "只属于甲账户的笔记" },
    });
    expect(note.statusCode).toBe(201);
    const hiddenAnnotations = await app.inject({
      method: "GET",
      url: `/api/v1/books/${importedA.id}/annotations`,
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(hiddenAnnotations.statusCode).toBe(404);

    await administration.unsafe(`
      INSERT INTO "${schema}".book_files (
        id, account_id, book_id, object_key, original_filename, byte_size, sha256, version
      ) VALUES (
        'file-${importedA.id}-v2', 'account-a', '${importedA.id}',
        'account-a/${importedA.id}/original/2/original.txt', '甲书-v2.txt', 1, 'v2', 2
      );
      INSERT INTO "${schema}".book_sections (
        account_id, book_id, file_version, section_id, section_order, title, body
      ) VALUES ('account-a', '${importedA.id}', 2, 'txt:v2', 0, '第二版', '新版本正文');
      UPDATE "${schema}".books
      SET parse_status = 'ready_text', section_count = 1
      WHERE account_id = 'account-a' AND id = '${importedA.id}';
    `);

    const stalePosition = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${importedA.id}/position`,
      headers: {
        "content-type": "application/json",
        "x-selfalone-account": "account-a",
      },
      payload: {
        expectedVersion: 2,
        locator: { kind: "text", fileVersion: 1, sectionId, offset: 0 },
        background: "light",
      },
    });
    expect(stalePosition.statusCode).toBe(409);
    expect(stalePosition.json()).toEqual({ code: "STALE_VERSION" });
    const [storedPosition] = await administration.unsafe<Array<{ locator: unknown; version: number }>>(
      `SELECT locator, version FROM "${schema}".reading_positions
       WHERE account_id = 'account-a' AND book_id = '${importedA.id}'`,
    );
    expect(storedPosition?.version).toBe(2);

    const staleHighlight = await app.inject({
      method: "POST",
      url: `/api/v1/books/${importedA.id}/highlights`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        idempotencyKey: "owner-chain-stale-highlight",
        locator: { kind: "text", fileVersion: 1, sectionId, offset: 0 },
        endOffset: 2,
      },
    });
    expect(staleHighlight.statusCode).toBe(409);
    expect(staleHighlight.json()).toEqual({ code: "STALE_VERSION" });

    for (const table of ["books", "book_files", "book_sections", "reading_positions", "highlights", "notes"]) {
      const [ownership] = await administration.unsafe<Array<{ rows: number; owners: number }>>(
        `SELECT count(*)::int AS rows, count(DISTINCT account_id)::int AS owners
         FROM "${schema}"."${table}"`,
      );
      expect(ownership?.owners).toBeGreaterThan(0);
      expect(ownership?.rows).toBeGreaterThan(0);
    }
    const [badSectionOwner] = await administration.unsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
       FROM "${schema}".book_sections AS section
       LEFT JOIN "${schema}".books AS book
         ON book.account_id = section.account_id AND book.id = section.book_id
       WHERE book.id IS NULL`,
    );
    expect(badSectionOwner?.count).toBe(0);
    const ownerConstraints = await administration.unsafe<Array<{ name: string }>>(
      `SELECT conname AS name
       FROM pg_constraint
       WHERE conrelid IN (
         '"${schema}".book_files'::regclass,
         '"${schema}".book_sections'::regclass,
         '"${schema}".reading_positions'::regclass
       )`,
    );
    expect(ownerConstraints.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      "book_files_account_book_fkey",
      "book_sections_account_book_file_fkey",
      "reading_positions_account_book_fkey",
    ]));
  });
});
