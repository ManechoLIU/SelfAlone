import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateConversationSchema } from "./conversation-migration";
import { migrateConversationSelectionSchema, conversationSelectionMigrationName } from "./conversation-selection-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("conversation selection schema migration", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema, sql }) => {
        await sql.end();
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
  });

  it("creates an account-scoped question table and is idempotent", async () => {
    const schema = `selection_migration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });

    await migrateConversationSchema(sql);
    await migrateConversationSelectionSchema(sql);
    await migrateConversationSelectionSchema(sql);

    const [table] = await sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_selection_questions'
    `;
    expect(table?.tableName).toBe("conversation_selection_questions");
    const [confirmationColumn] = await sql<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_selection_questions'
        AND column_name = 'requires_confirmation'
    `;
    expect(confirmationColumn?.columnName).toBe("requires_confirmation");
    const [messageColumn] = await sql<{ columnName: string; isNullable: string }[]>`
      SELECT
        column_name AS "columnName",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_selection_questions'
        AND column_name = 'assistant_message_id'
    `;
    expect(messageColumn).toEqual({ columnName: "assistant_message_id", isNullable: "NO" });
    const [messageForeignKey] = await sql<{ constraintName: string }[]>`
      SELECT conname AS "constraintName"
      FROM pg_constraint
      WHERE conrelid = 'conversation_selection_questions'::regclass
        AND conname = 'conversation_selection_questions_assistant_message_fkey'
    `;
    expect(messageForeignKey?.constraintName).toBe("conversation_selection_questions_assistant_message_fkey");
    const [migration] = await sql<{ name: string }[]>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${conversationSelectionMigrationName}
    `;
    expect(migration?.name).toBe(conversationSelectionMigrationName);
  });

  it("fails closed without inventing an assistant message for legacy rows", async () => {
    const schema = `selection_migration_legacy_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });

    await migrateConversationSchema(sql);
    await sql`
      INSERT INTO conversations (id, account_id, revision, state, deleted)
      VALUES (
        'conversation-a',
        'account-a',
        0,
        ${sql.json({ id: "conversation-a", revision: 0, draft: null, context: [], activeRun: null, tasks: [], works: [], deleted: false })},
        false
      )
    `;
    await sql`
      CREATE TABLE conversation_selection_questions (
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
    await sql`
      INSERT INTO conversation_selection_questions (
        id, account_id, conversation_id, prompt, mode, options
      )
      VALUES (
        'question-legacy', 'account-a', 'conversation-a', '旧问题', 'single', ${sql.json([{ value: "summary", label: "摘要" }])}
      )
    `;
    await sql`
      INSERT INTO schema_migrations (name)
      VALUES (${conversationSelectionMigrationName})
    `;

    await expect(migrateConversationSelectionSchema(sql)).rejects.toMatchObject({
      code: "SELECTION_MESSAGE_ASSOCIATION_REQUIRED",
    });
    const [messageColumn] = await sql<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_selection_questions'
        AND column_name = 'assistant_message_id'
    `;
    expect(messageColumn).toBeUndefined();
    const [legacyRow] = await sql<{ status: string }[]>`
      SELECT status
      FROM conversation_selection_questions
      WHERE id = 'question-legacy'
    `;
    expect(legacyRow?.status).toBe("pending");
  });
});
