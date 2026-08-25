import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { conversationMigrationName, migrateConversationSchema } from "./conversation-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("conversation schema migration", () => {
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

  it("creates account-scoped conversation state and message storage", async () => {
    const schema = `conversation_migration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });

    await migrateConversationSchema(sql);

    const tables = await sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('conversations', 'messages')
      ORDER BY table_name
    `;

    expect(tables.map(({ tableName }) => tableName)).toEqual([
      "conversations",
      "messages",
    ]);
  });

  it("upgrades the M0 conversation table so a conversation can start without a book", async () => {
    const schema = `conversation_migration_m0_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });
    await sql`
      CREATE TABLE conversations (
        id text PRIMARY KEY,
        book_id text NOT NULL
      )
    `;
    await sql`
      INSERT INTO conversations (id, book_id)
      VALUES ('conversation-legacy', 'book-legacy')
    `;

    await migrateConversationSchema(sql);

    const [column] = await sql<{ isNullable: string }[]>`
      SELECT is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversations'
        AND column_name = 'book_id'
    `;
    expect(column?.isNullable).toBe("YES");
    const [legacy] = await sql<{ state: Record<string, unknown> }[]>`
      SELECT state
      FROM conversations
      WHERE id = 'conversation-legacy'
    `;
    expect(legacy?.state).toMatchObject({
      id: "conversation-legacy",
      revision: 0,
      draft: null,
      context: [],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });
    await sql`
      UPDATE conversations
      SET state = '{}'::jsonb
      WHERE id = 'conversation-legacy'
    `;
    await migrateConversationSchema(sql);
    const [recovered] = await sql<{ state: Record<string, unknown> }[]>`
      SELECT state
      FROM conversations
      WHERE id = 'conversation-legacy'
    `;
    expect(recovered?.state).toMatchObject({ id: "conversation-legacy", context: [] });
    const serializedState = {
      id: "conversation-legacy",
      revision: 3,
      draft: null,
      context: [{ id: "legacy-user", role: "user", text: "旧消息" }],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    };
    await sql`
      UPDATE conversations
      SET state = to_jsonb(${JSON.stringify(serializedState)}::text)
      WHERE id = 'conversation-legacy'
    `;
    await migrateConversationSchema(sql);
    const [serialized] = await sql<{ state: Record<string, unknown> }[]>`
      SELECT state
      FROM conversations
      WHERE id = 'conversation-legacy'
    `;
    expect(serialized?.state).toEqual(serializedState);
    await sql`
      INSERT INTO conversations (id, account_id, revision, state)
      VALUES ('conversation-a', 'account-a', 0, '{}'::jsonb)
    `;
  });

  it("upgrades an already-recorded candidate schema to an owner-scoped message primary key", async () => {
    const schema = `conversation_migration_messages_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });

    await sql`
      CREATE TABLE schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE conversations (
        id text PRIMARY KEY,
        account_id text,
        book_id text,
        revision integer NOT NULL DEFAULT 0,
        state jsonb NOT NULL DEFAULT '{}'::jsonb,
        deleted boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE messages (
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
    await sql`
      INSERT INTO conversations (id, account_id, state)
      VALUES ('conversation-a', 'account-a', '{}'::jsonb)
    `;
    await sql`
      INSERT INTO messages (id, account_id, conversation_id, role, text)
      VALUES ('legacy-message', 'account-a', 'conversation-a', 'user', '旧消息')
    `;
    await sql`
      INSERT INTO schema_migrations (name) VALUES (${conversationMigrationName})
    `;

    await migrateConversationSchema(sql);
    await migrateConversationSchema(sql);

    const [primaryKey] = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'messages'::regclass AND contype = 'p'
    `;
    expect(primaryKey?.definition).toBe("PRIMARY KEY (account_id, conversation_id, id)");
  });
});
