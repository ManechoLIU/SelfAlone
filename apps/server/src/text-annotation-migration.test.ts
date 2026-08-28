import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";
import { createTextAnnotationRuntime, type TextAnnotationRuntime } from "./text-annotation-runtime";
import { migrateTextAnnotationSchema } from "./text-annotation-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("production text annotation migration", () => {
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const auxiliaryDatabases: Sql[] = [];
  const libraries: LibraryRuntime[] = [];
  const annotations: TextAnnotationRuntime[] = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(annotations.splice(0).map((runtime) => runtime.close()));
    await Promise.all(libraries.splice(0).map((runtime) => runtime.close()));
    await Promise.all(auxiliaryDatabases.splice(0).map((database) => database.end()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(objectDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("creates the production tables before annotation runtime readiness and records one migration", async () => {
    const schema = `text_annotation_migration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-annotation-migration-"));
    objectDirectories.push(objectDirectory);
    const library = await createLibraryRuntime({ databaseUrl, objectDirectory, parseDelayMs: 0 });
    libraries.push(library);
    await expect(createTextAnnotationRuntime({ databaseUrl })).rejects.toThrow("TEXT_ANNOTATION_SCHEMA_MISSING");

    const migrationDatabase = postgres(databaseUrl, { max: 1 });
    auxiliaryDatabases.push(migrationDatabase);
    await migrateTextAnnotationSchema(migrationDatabase);
    await migrateTextAnnotationSchema(migrationDatabase);

    const annotation = await createTextAnnotationRuntime({ databaseUrl });
    annotations.push(annotation);
    await expect(annotation.ready()).resolves.toBe(true);
    const migrationRows = await migrationDatabase<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name IN ('20260825_text_annotations', '20260828_conversation_note_idempotency')
      ORDER BY name
    `;
    expect(migrationRows).toEqual([
      { name: "20260825_text_annotations" },
      { name: "20260828_conversation_note_idempotency" },
    ]);
    const tables = await migrationDatabase<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('highlights', 'notes', 'note_update_idempotency')
      ORDER BY table_name
    `;
    expect(tables.map((row) => row.tableName)).toEqual(["highlights", "note_update_idempotency", "notes"]);
  });

  it("fails closed on a pre-existing incompatible table without recording the receipt", async () => {
    const schema = `text_annotation_migration_conflict_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-annotation-migration-"));
    objectDirectories.push(objectDirectory);
    const library = await createLibraryRuntime({ databaseUrl, objectDirectory, parseDelayMs: 0 });
    libraries.push(library);
    const migrationDatabase = postgres(databaseUrl, { max: 1 });
    auxiliaryDatabases.push(migrationDatabase);
    await migrationDatabase`CREATE TABLE highlights (id text PRIMARY KEY)`;

    await expect(migrateTextAnnotationSchema(migrationDatabase)).rejects.toBeTruthy();
    await expect(migrationDatabase`
      SELECT name FROM schema_migrations WHERE name = '20260825_text_annotations'
    `).rejects.toBeTruthy();
  });

  it("serializes concurrent migrators and records one valid receipt", async () => {
    const schema = `text_annotation_migration_concurrent_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-annotation-migration-"));
    objectDirectories.push(objectDirectory);
    const library = await createLibraryRuntime({ databaseUrl, objectDirectory, parseDelayMs: 0 });
    libraries.push(library);
    const first = postgres(databaseUrl, { max: 1 });
    const second = postgres(databaseUrl, { max: 1 });
    auxiliaryDatabases.push(first, second);

    await expect(Promise.all([
      migrateTextAnnotationSchema(first),
      migrateTextAnnotationSchema(second),
    ])).resolves.toHaveLength(2);
    const receipts = await first<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name IN ('20260825_text_annotations', '20260828_conversation_note_idempotency')
      ORDER BY name
    `;
    expect(receipts).toEqual([
      { name: "20260825_text_annotations" },
      { name: "20260828_conversation_note_idempotency" },
    ]);
    const [constraints] = await first<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'note_update_idempotency'
    `;
    expect(constraints?.tableName).toBe("note_update_idempotency");
  });
});
