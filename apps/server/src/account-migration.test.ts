import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { developmentAccountId, migrateM0AccountOwnership } from "./account-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("M0 account ownership migration", () => {
  const schemas: Array<{ administration: Sql; name: string }> = [];

  afterEach(async () => {
    await Promise.all(
      schemas.map(async ({ administration, name }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        await administration.end();
      }),
    );
    schemas.length = 0;
  });

  async function createIsolatedSql() {
    const schemaName = `selfalone_account_test_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schemaName}"`);
    schemas.push({ administration, name: schemaName });
    const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-csearch_path=${schemaName}`);
    return postgres(isolatedDatabaseUrl.toString(), { max: 1 });
  }

  async function createM0Schema(sql: Sql) {
    await sql.unsafe(`
      CREATE TABLE books (
        id text PRIMARY KEY,
        title text NOT NULL,
        source_label text NOT NULL
      );
      CREATE TABLE conversations (
        id text PRIMARY KEY,
        book_id text NOT NULL REFERENCES books(id)
      );
      CREATE TABLE ppt_drafts (
        id text PRIMARY KEY,
        conversation_id text NOT NULL REFERENCES conversations(id),
        stage text NOT NULL,
        version integer NOT NULL,
        requirements text NOT NULL DEFAULT '',
        outline jsonb NOT NULL DEFAULT '[]'::jsonb,
        template_id text
      );
      CREATE TABLE ppt_tasks (
        id text PRIMARY KEY,
        draft_id text NOT NULL REFERENCES ppt_drafts(id),
        idempotency_key text NOT NULL UNIQUE,
        status text NOT NULL,
        completed_pages integer NOT NULL,
        total_pages integer NOT NULL,
        version integer NOT NULL,
        artifact_id text,
        error text
      );
      CREATE TABLE ppt_pages (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES ppt_tasks(id),
        page_number integer NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        UNIQUE (task_id, page_number)
      );
      CREATE TABLE ppt_artifacts (
        id text PRIMARY KEY,
        task_id text NOT NULL UNIQUE REFERENCES ppt_tasks(id),
        file_path text NOT NULL,
        filename text NOT NULL
      );
    `);
  }

  async function seedM0Rows(sql: Sql) {
    await sql`INSERT INTO books (id, title, source_label) VALUES ('book-1', '书', '本地')`;
    await sql`INSERT INTO conversations (id, book_id) VALUES ('conversation-1', 'book-1')`;
    await sql`
      INSERT INTO ppt_drafts (id, conversation_id, stage, version)
      VALUES ('draft-1', 'conversation-1', 'requirements', 1)
    `;
    await sql`
      INSERT INTO ppt_tasks (
        id, draft_id, idempotency_key, status, completed_pages, total_pages, version
      ) VALUES ('task-1', 'draft-1', 'request-1', 'completed', 1, 1, 1)
    `;
    await sql`
      INSERT INTO ppt_pages (id, task_id, page_number, title, body)
      VALUES ('page-1', 'task-1', 1, '标题', '正文')
    `;
    await sql`
      INSERT INTO ppt_artifacts (id, task_id, file_path, filename)
      VALUES ('artifact-1', 'task-1', '/tmp/a.pptx', 'a.pptx')
    `;
  }

  it("backfills all six M0 tables without losing rows and is repeatable", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    await seedM0Rows(sql);

    await migrateM0AccountOwnership(sql);
    await migrateM0AccountOwnership(sql);

    const [account] = await sql<Array<{ id: string }>>`
      SELECT id FROM accounts WHERE id = ${developmentAccountId}
    `;
    expect(account).toEqual({ id: developmentAccountId });

    for (const table of [
      "books",
      "conversations",
      "ppt_drafts",
      "ppt_tasks",
      "ppt_pages",
      "ppt_artifacts",
    ]) {
      const [result] = await sql.unsafe<Array<{ count: number; owners: number }>>(
        `SELECT count(*)::int AS count, count(DISTINCT account_id)::int AS owners FROM ${table}`,
      );
      expect(result).toEqual({ count: 1, owners: 1 });
      const [row] = await sql.unsafe<Array<{ accountId: string }>>(
        `SELECT account_id AS "accountId" FROM ${table}`,
      );
      expect(row?.accountId).toBe(developmentAccountId);
    }

    const nullableColumns = await sql<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name = 'account_id'
        AND is_nullable <> 'NO'
    `;
    expect(nullableColumns).toEqual([]);

    await sql.end();
  });

  it("prevents a child row from claiming a different account than its parent", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    await seedM0Rows(sql);
    await migrateM0AccountOwnership(sql);
    await sql`INSERT INTO accounts (id) VALUES ('account-other')`;

    await expect(
      sql`
        INSERT INTO conversations (id, account_id, book_id)
        VALUES ('conversation-cross-account', 'account-other', 'book-1')
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await sql.end();
  });

  it("scopes task idempotency keys to an account", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    await seedM0Rows(sql);
    await migrateM0AccountOwnership(sql);
    await sql`INSERT INTO accounts (id) VALUES ('account-other')`;
    await sql`
      INSERT INTO books (id, account_id, title, source_label)
      VALUES ('book-other', 'account-other', '另一书', '本地')
    `;
    await sql`
      INSERT INTO conversations (id, account_id, book_id)
      VALUES ('conversation-other', 'account-other', 'book-other')
    `;
    await sql`
      INSERT INTO ppt_drafts (id, account_id, conversation_id, stage, version)
      VALUES ('draft-other', 'account-other', 'conversation-other', 'requirements', 1)
    `;

    await sql`
      INSERT INTO ppt_tasks (
        id, account_id, draft_id, idempotency_key,
        status, completed_pages, total_pages, version
      ) VALUES (
        'task-other', 'account-other', 'draft-other', 'request-1',
        'queued', 0, 1, 1
      )
    `;

    const [tasks] = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM ppt_tasks WHERE idempotency_key = 'request-1'
    `;
    expect(tasks?.count).toBe(2);

    await sql.end();
  });

  it("keeps each provider subject globally unique across accounts", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    await migrateM0AccountOwnership(sql);
    await sql`INSERT INTO accounts (id) VALUES ('account-other')`;
    await sql`
      INSERT INTO login_identities (id, account_id, provider, provider_subject)
      VALUES ('identity-1', ${developmentAccountId}, 'wechat_web', 'wechat-subject-1')
    `;

    await expect(
      sql`
        INSERT INTO login_identities (id, account_id, provider, provider_subject)
        VALUES ('identity-2', 'account-other', 'wechat_web', 'wechat-subject-1')
      `,
    ).rejects.toMatchObject({ code: "23505" });

    await sql.end();
  });

  it("preserves the known legacy development owner and creates its missing account row", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    for (const table of [
      "books",
      "conversations",
      "ppt_drafts",
      "ppt_tasks",
      "ppt_pages",
      "ppt_artifacts",
    ]) {
      await sql.unsafe(
        `ALTER TABLE ${table} ADD COLUMN account_id text NOT NULL DEFAULT 'account-development-local'`,
      );
    }
    await seedM0Rows(sql);

    await migrateM0AccountOwnership(sql);

    const owners = await sql<Array<{ id: string }>>`
      SELECT id FROM accounts ORDER BY id
    `;
    expect(owners).toEqual([{ id: "account-development-local" }]);
    const [book] = await sql<Array<{ accountId: string }>>`
      SELECT account_id AS "accountId" FROM books WHERE id = 'book-1'
    `;
    expect(book?.accountId).toBe("account-development-local");

    await sql.end();
  });

  it("rejects an unknown orphan owner instead of creating an account silently", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    for (const table of [
      "books",
      "conversations",
      "ppt_drafts",
      "ppt_tasks",
      "ppt_pages",
      "ppt_artifacts",
    ]) {
      await sql.unsafe(
        `ALTER TABLE ${table} ADD COLUMN account_id text NOT NULL DEFAULT 'account-unknown'`,
      );
    }
    await seedM0Rows(sql);

    await expect(migrateM0AccountOwnership(sql)).rejects.toThrow("UNKNOWN_ACCOUNT_OWNER");

    const [accountTable] = await sql<Array<{ name: string | null }>>`
      SELECT to_regclass('accounts')::text AS name
    `;
    expect(accountTable?.name).toBeNull();

    await sql.end();
  });

  it("rolls back every schema change when migration cannot complete", async () => {
    const sql = await createIsolatedSql();
    await createM0Schema(sql);
    await sql`ALTER TABLE books ADD COLUMN account_id text`;
    await sql`ALTER TABLE conversations ADD COLUMN account_id text`;
    await sql`
      CREATE TABLE accounts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      INSERT INTO accounts (id)
      VALUES ('account-book-owner'), ('account-conversation-owner')
    `;
    await seedM0Rows(sql);
    await sql`UPDATE books SET account_id = 'account-book-owner'`;
    await sql`UPDATE conversations SET account_id = 'account-conversation-owner'`;

    await expect(migrateM0AccountOwnership(sql)).rejects.toMatchObject({ code: "23503" });

    const accountColumns = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'account_id'
    `;
    expect(accountColumns[0]?.count).toBe(2);
    const [identityTable] = await sql<Array<{ name: string | null }>>`
      SELECT to_regclass('login_identities')::text AS name
    `;
    expect(identityTable?.name).toBeNull();

    await sql.end();
  });
});
