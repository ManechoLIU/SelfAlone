import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const migrationName = "20260825_text_annotations";
const migrationFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/migrations/20260825_text_annotations.sql",
);

/** Apply the production annotation migration exactly once before runtimes report ready. */
export async function migrateTextAnnotationSchema(sql: Sql) {
  const definition = await readFile(migrationFile, "utf8");
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${migrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name FROM schema_migrations WHERE name = ${migrationName} FOR UPDATE
    `;
    if (applied) return;
    await transaction.unsafe(definition);
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${migrationName})
    `;
  });
}

export { migrationName };
