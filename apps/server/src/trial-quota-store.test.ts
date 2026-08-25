import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateTrialQuotaSchema } from "./trial-quota-migration";
import { TrialQuotaStore } from "./trial-quota-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("trial quota store", () => {
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

  it("returns unclaimed for a new account, persists one claim, and isolates another account", async () => {
    const setup = await isolatedDatabase(databases, "trial_quota_store");
    const store = new TrialQuotaStore(setup.sql);

    await expect(store.getStatus("account-a")).resolves.toEqual({ status: "unclaimed" });
    await expect(Promise.all(
      Array.from({ length: 4 }, () => store.claim("account-a")),
    )).resolves.toEqual([
      { status: "claimed" },
      { status: "claimed" },
      { status: "claimed" },
      { status: "claimed" },
    ]);
    await expect(store.getStatus("account-a")).resolves.toEqual({ status: "claimed" });
    await expect(store.getStatus("account-b")).resolves.toEqual({ status: "unclaimed" });

    await expect(Promise.all(
      Array.from({ length: 4 }, () => store.claim("account-b")),
    )).resolves.toHaveLength(4);
    await expect(store.getStatus("account-b")).resolves.toEqual({ status: "claimed" });

    const rows = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trial_grants
    `;
    expect(rows[0]?.count).toBe(2);
  });

  it("rejects a claim for an account that does not exist", async () => {
    const setup = await isolatedDatabase(databases, "trial_quota_foreign_key");
    const store = new TrialQuotaStore(setup.sql);

    await expect(store.claim("missing-account")).rejects.toMatchObject({ code: "23503" });
  });
});

async function isolatedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 4 });
  databases.push({ administration, schema, sql });
  await sql`
    CREATE TABLE accounts (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await migrateTrialQuotaSchema(sql);
  return { schema, sql };
}
