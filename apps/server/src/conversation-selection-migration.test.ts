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
    const [migration] = await sql<{ name: string }[]>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${conversationSelectionMigrationName}
    `;
    expect(migration?.name).toBe(conversationSelectionMigrationName);
  });
});
