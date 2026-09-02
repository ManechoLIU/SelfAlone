import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createM0Runtime, type M0Runtime } from "./m0-runtime";
import {
  migratePptWorkspaceSchema,
  pptWorkspaceMigrationName,
} from "./ppt-workspace-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("PPT workspace schema migration", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];
  const runtimes: M0Runtime[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema, sql }) => {
        await sql.end();
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
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
        intentSourceBookId: string | null;
        purpose: string | null;
        additionalRequirements: string;
      }>
    >`
      SELECT intent_request_id AS "intentRequestId",
             intent_source_book_id AS "intentSourceBookId",
             purpose,
             additional_requirements AS "additionalRequirements"
      FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = 'draft-legacy'
    `;
    expect(legacy).toEqual({
      intentRequestId: null,
      intentSourceBookId: null,
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

  it("resets M0 development data after the source table exists without clearing unrelated tables", async () => {
    const schema = `ppt_workspace_reset_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(databaseUrl.toString(), { max: 1 });
    databases.push({ administration, schema, sql });
    const artifactDirectory = await mkdtemp(join(tmpdir(), "ppt-workspace-reset-"));
    temporaryDirectories.push(artifactDirectory);

    const runtime = await createM0Runtime({
      databaseUrl: databaseUrl.toString(),
      artifactDirectory,
      progressDelayMs: 0,
      resetDevelopmentData: true,
    });
    runtimes.push(runtime);
    await migratePptWorkspaceSchema(sql);
    await sql`
      INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
      SELECT draft.account_id, draft.id, conversation.book_id, 0
      FROM ppt_drafts AS draft
      JOIN conversations AS conversation
        ON conversation.account_id = draft.account_id
       AND conversation.id = draft.conversation_id
    `;
    await sql`CREATE TABLE leftover_dev_rows (id text PRIMARY KEY)`;
    await sql`INSERT INTO leftover_dev_rows (id) VALUES ('keep-me')`;

    await runtime.initialize(true);
    await sql`
      INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
      SELECT draft.account_id, draft.id, conversation.book_id, 0
      FROM ppt_drafts AS draft
      JOIN conversations AS conversation
        ON conversation.account_id = draft.account_id
       AND conversation.id = draft.conversation_id
    `;
    await runtime.initialize(true);

    const leftover = await sql<Array<{ id: string }>>`SELECT id FROM leftover_dev_rows`;
    expect(leftover).toEqual([{ id: "keep-me" }]);
    const sources = await sql<Array<{ draftId: string }>>`
      SELECT draft_id AS "draftId" FROM ppt_draft_sources
    `;
    expect(sources).toEqual([]);
    const restored = await runtime.getWorkspace();
    expect(restored.draft.stage).toBe("requirements");
    expect(restored.draft.version).toBe(1);
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
