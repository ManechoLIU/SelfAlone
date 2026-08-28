import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const migrationName = "20260825_text_annotations";
const migrationFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/migrations/20260825_text_annotations.sql",
);
const idempotencyMigrationName = "20260828_conversation_note_idempotency";
const idempotencyMigrationFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/migrations/20260828_conversation_note_idempotency.sql",
);

const migrations = [
  { name: migrationName, file: migrationFile },
  { name: idempotencyMigrationName, file: idempotencyMigrationFile },
] as const;

/** Apply the production annotation migrations in order before runtimes report ready. */
export async function migrateTextAnnotationSchema(sql: Sql) {
  const definitions = await Promise.all(
    migrations.map(async (migration) => ({ ...migration, definition: await readFile(migration.file, "utf8") })),
  );
  await sql.begin(async (transaction) => {
    // Serialize first-time creation of the shared receipt table as well as the
    // per-migration work; CREATE TABLE IF NOT EXISTS is not race-safe in PG.
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${"text-annotation-schema-migrations"}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    for (const migration of definitions) {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${migration.name}))`;
      const [applied] = await transaction<Array<{ name: string }>>`
        SELECT name FROM schema_migrations WHERE name = ${migration.name} FOR UPDATE
      `;
      if (applied) continue;
      await transaction.unsafe(migration.definition);
      await transaction`
        INSERT INTO schema_migrations (name) VALUES (${migration.name})
      `;
    }
  });
}

export { idempotencyMigrationName, migrationName };
