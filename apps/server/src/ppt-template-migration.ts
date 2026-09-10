import type { Sql } from "postgres";

export const pptTemplateMigrationName = "20260911_ppt_template";

export async function migratePptTemplateSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${pptTemplateMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS template_id text`;
    await transaction`
      INSERT INTO schema_migrations (name)
      VALUES (${pptTemplateMigrationName})
      ON CONFLICT (name) DO NOTHING
    `;
  });
}
