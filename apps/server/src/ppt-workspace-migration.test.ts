import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import {
  migratePptWorkspaceSchema,
  pptWorkspaceMigrationName,
} from "./ppt-workspace-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("PPT workspace schema migration", () => {
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

  it("adds an idempotent account-scoped source and requirements surface without inventing legacy intent", async () => {
    const schema = `ppt_workspace_migration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });

    await createLegacySchema(sql);
    await migratePptWorkspaceSchema(sql);
    await migratePptWorkspaceSchema(sql);

    const [legacy] = await sql<
      Array<{
        intentRequestId: string | null;
        purpose: string | null;
        additionalRequirements: string;
      }>
    >`
      SELECT intent_request_id AS "intentRequestId", purpose,
             additional_requirements AS "additionalRequirements"
      FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = 'draft-legacy'
    `;
    expect(legacy).toEqual({
      intentRequestId: null,
      purpose: null,
      additionalRequirements: "",
    });

    const [migration] = await sql<Array<{ name: string }>>`
      SELECT name FROM schema_migrations WHERE name = ${pptWorkspaceMigrationName}
    `;
    expect(migration?.name).toBe(pptWorkspaceMigrationName);

    const [sourcePrimaryKey] = await sql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'ppt_draft_sources'::regclass AND contype = 'p'
    `;
    expect(sourcePrimaryKey?.definition).toBe(
      "PRIMARY KEY (account_id, draft_id, book_id)",
    );

    await sql`
      INSERT INTO books (id, account_id, title, source_label)
      VALUES ('book-b', 'account-a', '第二本书', '本地')
    `;
    await sql`
      INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
      VALUES ('account-a', 'draft-legacy', 'book-a', 0)
    `;
    await expect(sql`
      INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
      VALUES ('account-a', 'draft-legacy', 'book-b', 0)
    `).rejects.toMatchObject({ code: "23505" });

    await expect(sql`
      UPDATE ppt_drafts SET page_min = 6, page_max = NULL
      WHERE account_id = 'account-a' AND id = 'draft-legacy'
    `).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      UPDATE ppt_drafts SET page_min = 10, page_max = 8
      WHERE account_id = 'account-a' AND id = 'draft-legacy'
    `).rejects.toMatchObject({ code: "23514" });

    await sql`
      UPDATE ppt_drafts SET intent_request_id = 'request-a'
      WHERE account_id = 'account-a' AND id = 'draft-legacy'
    `;
    await expect(sql`
      INSERT INTO ppt_drafts (
        id, account_id, conversation_id, stage, version, requirements,
        outline, intent_request_id
      ) VALUES (
        'draft-duplicate', 'account-a', 'conversation-a', 'requirements', 1, '',
        '[]'::jsonb, 'request-a'
      )
    `).rejects.toMatchObject({ code: "23505" });
  });
});

async function createLegacySchema(sql: Sql) {
  await sql`
    CREATE TABLE accounts (
      id text PRIMARY KEY
    )
  `;
  await sql`
    CREATE TABLE books (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      title text NOT NULL,
      source_label text NOT NULL,
      author text,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE conversations (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      book_id text,
      revision integer NOT NULL DEFAULT 0,
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      deleted boolean NOT NULL DEFAULT false,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE messages (
      id text NOT NULL,
      account_id text NOT NULL,
      conversation_id text NOT NULL,
      role text NOT NULL,
      text text NOT NULL,
      request_id text,
      PRIMARY KEY (account_id, conversation_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `;
  await sql`
    CREATE TABLE ppt_drafts (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      conversation_id text NOT NULL,
      stage text NOT NULL,
      version integer NOT NULL,
      requirements text NOT NULL DEFAULT '',
      outline jsonb NOT NULL DEFAULT '[]'::jsonb,
      template_id text,
      UNIQUE (account_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `;
  await sql`INSERT INTO accounts (id) VALUES ('account-a')`;
  await sql`
    INSERT INTO books (id, account_id, title, source_label)
    VALUES ('book-a', 'account-a', '第一本书', '本地')
  `;
  await sql`
    INSERT INTO conversations (id, account_id, book_id)
    VALUES ('conversation-a', 'account-a', 'book-a')
  `;
  await sql`
    INSERT INTO ppt_drafts (
      id, account_id, conversation_id, stage, version, requirements, outline
    ) VALUES (
      'draft-legacy', 'account-a', 'conversation-a', 'requirements', 1, '', '[]'::jsonb
    )
  `;
}
