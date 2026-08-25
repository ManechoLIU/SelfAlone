import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateAccountSettingsSchema } from "./account-settings-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("M1-F1-B account settings schema", () => {
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

  async function createIsolatedSql() {
    const schema = `settings_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(baseDatabaseUrl);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const sql = postgres(url.toString(), { max: 1 });
    databases.push({ administration, schema, sql });
    return sql;
  }

  async function createAuthSchema(sql: Sql) {
    await sql.unsafe(`
      CREATE TABLE accounts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE login_identities (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        provider text NOT NULL,
        provider_subject text NOT NULL,
        email text,
        password_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject)
      );
      CREATE TABLE sessions (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  it("creates one-time hashed email tokens with account and kind boundaries, and is repeatable", async () => {
    const sql = await createIsolatedSql();
    await createAuthSchema(sql);
    await migrateAccountSettingsSchema(sql);
    await migrateAccountSettingsSchema(sql);

    const columns = await sql<Array<{ name: string; nullable: string }>>`
      SELECT column_name AS name, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'email_tokens'
      ORDER BY ordinal_position
    `;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "account_id",
      "kind",
      "email",
      "token_digest",
      "expires_at",
      "used_at",
      "created_at",
    ]);
    expect(columns.find((column) => column.name === "token_digest")?.nullable).toBe("NO");

    const constraints = await sql<Array<{ name: string }>>`
      SELECT constraint_name AS name
      FROM information_schema.table_constraints
      WHERE table_schema = current_schema() AND table_name = 'email_tokens'
    `;
    expect(constraints.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "email_tokens_account_fkey",
        "email_tokens_kind_check",
      ]),
    );
  });

  it("rejects token rows that are not owned by an existing account", async () => {
    const sql = await createIsolatedSql();
    await createAuthSchema(sql);
    await migrateAccountSettingsSchema(sql);

    await expect(
      sql`
        INSERT INTO email_tokens (
          id, account_id, kind, email, token_digest, expires_at
        ) VALUES (
          'token-1', 'missing-account', 'password_reset', 'reader@example.com',
          'digest-1', now() + interval '15 minutes'
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });
});
