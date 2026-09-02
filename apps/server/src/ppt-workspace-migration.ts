import type { Sql } from "postgres";

export const pptWorkspaceMigrationName = "20260902_ppt_workspace";

export async function migratePptWorkspaceSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${pptWorkspaceMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS intent_request_id text`;
    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS purpose text`;
    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS audience text`;
    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS page_min integer`;
    await transaction`ALTER TABLE ppt_drafts ADD COLUMN IF NOT EXISTS page_max integer`;
    await transaction`
      ALTER TABLE ppt_drafts
      ADD COLUMN IF NOT EXISTS additional_requirements text NOT NULL DEFAULT ''
    `;
    await transaction`
      ALTER TABLE ppt_drafts
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
    `;
    await transaction`
      ALTER TABLE ppt_drafts
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
    `;

    await transaction.unsafe(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'ppt_drafts'::regclass
            AND conname = 'ppt_drafts_page_range_check'
        ) THEN
          ALTER TABLE ppt_drafts
          ADD CONSTRAINT ppt_drafts_page_range_check
          CHECK (
            (page_min IS NULL AND page_max IS NULL)
            OR (
              page_min IS NOT NULL
              AND page_max IS NOT NULL
              AND page_min > 0
              AND page_max > 0
              AND page_min <= page_max
            )
          );
        END IF;
      END
      $migration$;
    `);
    await transaction`
      CREATE UNIQUE INDEX IF NOT EXISTS ppt_drafts_account_conversation_intent_request_unique
      ON ppt_drafts (account_id, conversation_id, intent_request_id)
      WHERE intent_request_id IS NOT NULL
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS ppt_draft_sources (
        account_id text NOT NULL,
        draft_id text NOT NULL,
        book_id text NOT NULL,
        source_order integer NOT NULL CHECK (source_order >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, draft_id, book_id),
        UNIQUE (account_id, draft_id, source_order),
        FOREIGN KEY (account_id, draft_id)
          REFERENCES ppt_drafts(account_id, id) ON DELETE CASCADE,
        FOREIGN KEY (account_id, book_id)
          REFERENCES books(account_id, id) ON DELETE RESTRICT
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS ppt_draft_sources_account_book_idx
      ON ppt_draft_sources (account_id, book_id, created_at DESC, draft_id)
    `;

    await transaction`
      INSERT INTO schema_migrations (name)
      VALUES (${pptWorkspaceMigrationName})
      ON CONFLICT (name) DO NOTHING
    `;
  });
}
