import type { Sql } from "postgres";

export const pptOutlineMigrationName = "20260906_ppt_outline";

export async function migratePptOutlineSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${pptOutlineMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS ppt_outline_nodes (
        account_id text NOT NULL,
        draft_id text NOT NULL,
        node_id text NOT NULL,
        node_order integer NOT NULL CHECK (node_order >= 0),
        level integer NOT NULL CHECK (level BETWEEN 1 AND 3),
        body text NOT NULL,
        PRIMARY KEY (account_id, draft_id, node_id),
        UNIQUE (account_id, draft_id, node_order)
      )
    `;
    await transaction`
      CREATE TABLE IF NOT EXISTS ppt_public_sources (
        account_id text NOT NULL,
        draft_id text NOT NULL,
        url text NOT NULL,
        title text NOT NULL,
        published_at timestamptz,
        fetched_at timestamptz NOT NULL,
        usage_scope text NOT NULL,
        PRIMARY KEY (account_id, draft_id, url)
      )
    `;

    await transaction.unsafe(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'ppt_outline_nodes'::regclass
            AND conname = 'ppt_outline_nodes_draft_fkey'
        ) THEN
          ALTER TABLE ppt_outline_nodes
          ADD CONSTRAINT ppt_outline_nodes_draft_fkey
          FOREIGN KEY (account_id, draft_id)
            REFERENCES ppt_drafts(account_id, id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'ppt_public_sources'::regclass
            AND conname = 'ppt_public_sources_draft_fkey'
        ) THEN
          ALTER TABLE ppt_public_sources
          ADD CONSTRAINT ppt_public_sources_draft_fkey
          FOREIGN KEY (account_id, draft_id)
            REFERENCES ppt_drafts(account_id, id)
            ON DELETE CASCADE;
        END IF;
      END
      $migration$;
    `);

    await transaction`
      INSERT INTO schema_migrations (name)
      VALUES (${pptOutlineMigrationName})
      ON CONFLICT (name) DO NOTHING
    `;
  });
}
