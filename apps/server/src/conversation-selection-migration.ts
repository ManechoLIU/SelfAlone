import type { Sql } from "postgres";

export const conversationSelectionMigrationName = "20260826_conversation_selection_questions";

export async function migrateConversationSelectionSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${conversationSelectionMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${conversationSelectionMigrationName}
      FOR UPDATE
    `;
    if (applied) {
      await transaction`
        ALTER TABLE conversation_selection_questions
        ADD COLUMN IF NOT EXISTS requires_confirmation boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS last_request_id text,
        ADD COLUMN IF NOT EXISTS last_request_payload jsonb
      `;
      return;
    }

    await transaction`
      CREATE TABLE IF NOT EXISTS conversation_selection_questions (
        id text NOT NULL,
        account_id text NOT NULL,
        conversation_id text NOT NULL,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        prompt text NOT NULL,
        mode text NOT NULL CHECK (mode IN ('single', 'multi', 'free')),
        requires_confirmation boolean NOT NULL DEFAULT false,
        options jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'stale')),
        selected_values jsonb NOT NULL DEFAULT '[]'::jsonb,
        free_text text,
        answer jsonb,
        answer_request_id text,
        last_request_id text,
        last_request_payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, conversation_id, id),
        FOREIGN KEY (account_id, conversation_id)
          REFERENCES conversations (account_id, id)
      )
    `;
    await transaction`
      ALTER TABLE conversation_selection_questions
      ADD COLUMN IF NOT EXISTS requires_confirmation boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS last_request_id text,
      ADD COLUMN IF NOT EXISTS last_request_payload jsonb
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS conversation_selection_account_conversation_idx
      ON conversation_selection_questions (account_id, conversation_id, created_at, id)
    `;
    await transaction`
      INSERT INTO schema_migrations (name)
      VALUES (${conversationSelectionMigrationName})
    `;
  });
}
