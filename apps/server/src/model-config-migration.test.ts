import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateModelConfigSchema } from "./model-config-migration";

describe("model credentials schema", () => {
  const resources: Array<{ admin: Sql; schema: string; db: Sql }> = [];

  afterEach(async () => {
    await Promise.all(resources.map(async ({ admin, schema, db }) => {
      await db.end();
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }));
    resources.length = 0;
  });

  it("stores only encrypted envelope columns and enforces account ownership", async () => {
    const base = process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
    const schema = `model_config_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(base, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(base);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const db = postgres(databaseUrl.toString(), { max: 1 });
    resources.push({ admin, schema, db });

    await db`CREATE TABLE accounts (id text PRIMARY KEY)`;
    await migrateModelConfigSchema(db);
    const columns = await db<Array<{ name: string }>>`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'model_credentials'
    `;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "account_id",
      "ciphertext",
      "nonce",
      "auth_tag",
      "key_version",
      "key_hint",
    ]));
    expect(columns.map((column) => column.name)).not.toContain("api_key");
    const foreignKeys = await db<Array<{ constraintName: string }>>`
      SELECT constraint_name AS "constraintName"
      FROM information_schema.table_constraints
      WHERE table_schema = current_schema()
        AND table_name = 'model_credentials'
        AND constraint_type = 'FOREIGN KEY'
    `;
    expect(foreignKeys.map((key) => key.constraintName)).toContain("model_credentials_account_id_fkey");
  });
});
