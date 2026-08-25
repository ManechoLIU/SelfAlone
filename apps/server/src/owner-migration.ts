import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

export const ownerMigrationName = "20260825_owner_contract";
const ownerMigrationFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/migrations/20260825_owner_contract.sql",
);

/** Apply the account/file-version contract atomically before dependent runtimes are accepted. */
export async function migrateOwnerContractSchema(sql: Sql) {
  const definition = await readFile(ownerMigrationFile, "utf8");
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${ownerMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name FROM schema_migrations WHERE name = ${ownerMigrationName} FOR UPDATE
    `;
    if (applied) return;
    await transaction.unsafe(definition);
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${ownerMigrationName})
    `;
  });
}
