import type { Sql, TransactionSql } from "postgres";

export const conversationMigrationName = "20260825_conversations";

/**
 * Creates only the private conversation persistence surface.
 *
 * The existing M0 schema may already own a `conversations` table, so this
 * migration adds the state columns instead of replacing that table. The
 * conversation runtime always scopes reads and writes by account id.
 */
export async function migrateConversationSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${conversationMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${conversationMigrationName}
      FOR UPDATE
    `;
    if (applied) {
      await backfillLegacyConversationState(transaction);
      return;
    }

    await transaction`
      CREATE TABLE IF NOT EXISTS conversations (
        id text PRIMARY KEY,
        account_id text,
        book_id text
      )
    `;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS account_id text`;
    // M0 seeded a required book_id, but conversations are not book-scoped.
    await transaction`ALTER TABLE conversations ALTER COLUMN book_id DROP NOT NULL`;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0`;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}'::jsonb`;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false`;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
    await transaction`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;
    await backfillLegacyConversationState(transaction);
    await transaction`
      CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_id_id_key
      ON conversations (account_id, id)
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS messages (
        id text PRIMARY KEY,
        account_id text NOT NULL,
        conversation_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        text text NOT NULL,
        request_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, conversation_id, id)
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS messages_account_conversation_idx
      ON messages (account_id, conversation_id, created_at, id)
    `;
    await transaction.unsafe(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'messages'::regclass
            AND conname = 'messages_account_conversation_fkey'
        ) THEN
          ALTER TABLE messages
          ADD CONSTRAINT messages_account_conversation_fkey
          FOREIGN KEY (account_id, conversation_id)
          REFERENCES conversations (account_id, id);
        END IF;
      END
      $migration$;
    `);
    await transaction`
      CREATE INDEX IF NOT EXISTS conversations_account_updated_idx
      ON conversations (account_id, updated_at DESC, id)
    `;

    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${conversationMigrationName})
    `;
  });
}

async function backfillLegacyConversationState(transaction: TransactionSql) {
  await transaction`
    UPDATE conversations
    SET state = CASE
      WHEN jsonb_typeof(state) = 'string' THEN (state #>> '{}')::jsonb
      ELSE jsonb_build_object(
        'id', id,
        'revision', revision,
        'draft', null,
        'context', '[]'::jsonb,
        'activeRun', null,
        'tasks', '[]'::jsonb,
        'works', '[]'::jsonb,
        'deleted', deleted
      )
    END
    WHERE state = '{}'::jsonb OR jsonb_typeof(state) = 'string' OR state->>'id' IS NULL
  `;
}
