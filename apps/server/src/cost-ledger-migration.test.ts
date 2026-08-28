import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { costLedgerMigrationName, migrateCostLedgerSchema } from "./cost-ledger-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("cost ledger schema migration", () => {
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

  it("creates integer-micros ledger, reservation, and immutable audit tables idempotently", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_migration");
    await migrateCostLedgerSchema(setup.sql);
    await migrateCostLedgerSchema(setup.sql);

    const tables = await setup.sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('cost_ledger_accounts', 'cost_ledger_reservations', 'cost_ledger_audit')
      ORDER BY table_name
    `;
    expect(tables.map((row) => row.tableName)).toEqual([
      "cost_ledger_accounts",
      "cost_ledger_audit",
      "cost_ledger_reservations",
    ]);

    const columns = await setup.sql<{ tableName: string; columnName: string; dataType: string }[]>`
      SELECT table_name AS "tableName", column_name AS "columnName", data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'cost_ledger_accounts' AND column_name IN ('committed_micros', 'reserved_micros', 'hard_limit_micros'))
          OR (table_name = 'cost_ledger_reservations' AND column_name IN ('reserved_micros', 'actual_micros'))
          OR (table_name = 'cost_ledger_audit' AND column_name = 'amount_micros'))
      ORDER BY table_name, column_name
    `;
    expect(columns).toEqual([
      { tableName: "cost_ledger_accounts", columnName: "committed_micros", dataType: "bigint" },
      { tableName: "cost_ledger_accounts", columnName: "hard_limit_micros", dataType: "bigint" },
      { tableName: "cost_ledger_accounts", columnName: "reserved_micros", dataType: "bigint" },
      { tableName: "cost_ledger_audit", columnName: "amount_micros", dataType: "bigint" },
      { tableName: "cost_ledger_reservations", columnName: "actual_micros", dataType: "bigint" },
      { tableName: "cost_ledger_reservations", columnName: "reserved_micros", dataType: "bigint" },
    ]);

    const migration = await setup.sql<{ name: string }[]>`
      SELECT name FROM schema_migrations WHERE name = ${costLedgerMigrationName}
    `;
    expect(migration).toEqual([{ name: costLedgerMigrationName }]);

    await setup.sql`
      INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')
    `;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros)
      VALUES ('account-a', 'migration-op', 'migration-res', 1)
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'migration-op', 'migration-res', 'reserve', 1)
    `;
    await expect(setup.sql`UPDATE cost_ledger_audit SET amount_micros = 1`).rejects.toMatchObject({
      code: "P0001",
    });
    await expect(setup.sql`DELETE FROM cost_ledger_audit`).rejects.toMatchObject({ code: "P0001" });
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
  await sql`CREATE TABLE accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  return { sql };
}
