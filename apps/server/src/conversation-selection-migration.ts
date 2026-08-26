import type { Sql, TransactionSql } from "postgres";

export const conversationSelectionMigrationName = "20260826_conversation_selection_questions";

export class ConversationSelectionMigrationError extends Error {
  constructor(readonly code: "SELECTION_MESSAGE_ASSOCIATION_REQUIRED" | "SELECTION_MESSAGE_TABLE_REQUIRED" | "SELECTION_MESSAGE_ASSOCIATION_INVALID") {
    super(code);
    this.name = "ConversationSelectionMigrationError";
  }
}

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
      await ensureAssistantMessageAssociation(transaction);
      return;
    }

    await transaction`
      CREATE TABLE IF NOT EXISTS conversation_selection_questions (
        id text NOT NULL,
        account_id text NOT NULL,
        conversation_id text NOT NULL,
        assistant_message_id text NOT NULL,
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
          REFERENCES conversations (account_id, id),
        CONSTRAINT conversation_selection_questions_assistant_message_fkey
          FOREIGN KEY (account_id, conversation_id, assistant_message_id)
          REFERENCES messages (account_id, conversation_id, id)
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

async function ensureAssistantMessageAssociation(transaction: TransactionSql) {
  // Legacy rows are intentionally not guessed or reassigned. The transaction
  // aborts until an explicit, verified assistant-message backfill exists.
  const [messagesTable] = await transaction<{ exists: boolean }[]>`
    SELECT to_regclass('messages') IS NOT NULL AS exists
  `;
  if (!messagesTable?.exists) {
    throw new ConversationSelectionMigrationError("SELECTION_MESSAGE_TABLE_REQUIRED");
  }

  const [column] = await transaction<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_selection_questions'
        AND column_name = 'assistant_message_id'
    ) AS exists
  `;
  if (!column?.exists) {
    const [rows] = await transaction<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM conversation_selection_questions
    `;
    if ((rows?.count ?? 0) > 0) {
      throw new ConversationSelectionMigrationError("SELECTION_MESSAGE_ASSOCIATION_REQUIRED");
    }
    await transaction`
      ALTER TABLE conversation_selection_questions
      ADD COLUMN assistant_message_id text NOT NULL
    `;
  } else {
    const [rows] = await transaction<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM conversation_selection_questions
      WHERE assistant_message_id IS NULL OR btrim(assistant_message_id) = ''
    `;
    if ((rows?.count ?? 0) > 0) {
      throw new ConversationSelectionMigrationError("SELECTION_MESSAGE_ASSOCIATION_REQUIRED");
    }
    await transaction`
      ALTER TABLE conversation_selection_questions
      ALTER COLUMN assistant_message_id SET NOT NULL
    `;
  }

  const [invalidRows] = await transaction<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM conversation_selection_questions AS question
    LEFT JOIN messages AS message
      ON message.account_id = question.account_id
      AND message.conversation_id = question.conversation_id
      AND message.id = question.assistant_message_id
      AND message.role = 'assistant'
    WHERE message.id IS NULL
  `;
  if ((invalidRows?.count ?? 0) > 0) {
    throw new ConversationSelectionMigrationError("SELECTION_MESSAGE_ASSOCIATION_INVALID");
  }

  await transaction.unsafe(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'conversation_selection_questions'::regclass
          AND conname = 'conversation_selection_questions_assistant_message_fkey'
      ) THEN
        ALTER TABLE conversation_selection_questions
        ADD CONSTRAINT conversation_selection_questions_assistant_message_fkey
        FOREIGN KEY (account_id, conversation_id, assistant_message_id)
        REFERENCES messages (account_id, conversation_id, id);
      END IF;
    END
    $migration$;
  `);
}
