import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import {
  COST_LEDGER_HARD_LIMIT_MICROS,
  CostLedgerMigrationError,
  costLedgerMigrationName,
  migrateCostLedgerSchema,
} from "./cost-ledger-migration";

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
    await expect(setup.sql`TRUNCATE cost_ledger_audit`).rejects.toMatchObject({ code: "P0001" });
    await expect(setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'wrong-operation', 'migration-res', 'reserve', 999)
    `).rejects.toMatchObject({ code: "23514" });

    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5)
    `;
    await setup.sql`
      UPDATE cost_ledger_reservations
      SET status = 'settled', actual_micros = 3
      WHERE account_id = 'account-a' AND reservation_id = 'settle-res'
    `;
    await expect(setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 'settle', 4)
    `).rejects.toMatchObject({ code: "23514" });

    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros)
      VALUES ('account-a', 'release-op', 'release-res', 7)
    `;
    await setup.sql`
      UPDATE cost_ledger_reservations
      SET status = 'released', actual_micros = NULL
      WHERE account_id = 'account-a' AND reservation_id = 'release-res'
    `;
    await expect(setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'release-op', 'release-res', 'release', 6)
    `).rejects.toMatchObject({ code: "23514" });

    await expect(setup.sql`UPDATE cost_ledger_audit SET amount_micros = 1`).rejects.toMatchObject({
      code: "P0001",
    });
    await expect(setup.sql`DELETE FROM cost_ledger_audit`).rejects.toMatchObject({ code: "P0001" });
  });

  it("rejects a same-name partial ledger table before recording the migration marker", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_partial", false);
    await createSchemaMigrations(setup.sql);
    await setup.sql`CREATE TABLE cost_ledger_accounts (account_id text PRIMARY KEY)`;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toBeInstanceOf(CostLedgerMigrationError);
    await expectMigrationMarker(setup.sql);
  });

  it("rejects a same-name table whose required check is weakened by an opposite OR clause", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_weak_check", false);
    await createSchemaMigrations(setup.sql);
    await setup.sql.unsafe(`
      CREATE TABLE cost_ledger_accounts (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        committed_micros bigint NOT NULL DEFAULT 0
          CHECK (committed_micros >= 0 OR committed_micros = -1),
        reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
        hard_limit_micros bigint NOT NULL DEFAULT ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint
          CHECK (hard_limit_micros = ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects a same-name table with a NOT VALID required check", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_not_valid", false);
    await createSchemaMigrations(setup.sql);
    await setup.sql.unsafe(`
      CREATE TABLE cost_ledger_accounts (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        committed_micros bigint NOT NULL DEFAULT 0,
        reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
        hard_limit_micros bigint NOT NULL DEFAULT ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint
          CHECK (hard_limit_micros = ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await setup.sql`
      ALTER TABLE cost_ledger_accounts
      ADD CONSTRAINT cost_ledger_accounts_committed_nonnegative
      CHECK (committed_micros >= 0) NOT VALID
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects pre-existing audit operation and amount mismatches before recording the marker", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_bad_audit");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status, actual_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled', 3)
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'wrong-op', 'settle-res', 'settle', 4)
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects a pre-existing audit event whose status does not match the reservation", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_bad_event");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status)
      VALUES ('account-a', 'release-op', 'release-res', 7, 'released')
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'release-op', 'release-res', 'settle', 7)
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects a pre-existing reservation with terminal status but no actual amount", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_bad_reservation");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled')
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects a settled reservation whose history is missing the settle audit", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_missing_settle");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status, actual_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled', 3)
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 'reserve', 5)
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("rejects direct INSERT of settled reservation after migration (proves reserve lifecycle cannot be bypassed)", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_settled_direct");
    await migrateCostLedgerSchema(setup.sql);

    await expect(setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status, actual_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled', 3)
    `).rejects.toMatchObject({ code: "P0001" });
  });

  it("rejects legacy settled reservation with terminal settle audit before reserve audit (proves chronological audit order)", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_legacy_audit_order");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;

    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status, actual_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled', 3)
    `;

    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros, created_at)
      VALUES ('account-a', 'settle-op', 'settle-res', 'reserve', 5, '2026-01-01T00:00:01Z')
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros, created_at)
      VALUES ('account-a', 'settle-op', 'settle-res', 'settle', 3, '2026-01-01T00:00:00Z')
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).rejects.toMatchObject({
      code: "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    });
    await expectMigrationMarker(setup.sql);
  });

  it("migrates a settled reservation with a complete reserve and settle audit history", async () => {
    const setup = await compatibleUnmigratedDatabase(databases, "cost_ledger_complete_settle");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros, status, actual_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5, 'settled', 3)
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 'reserve', 5)
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 'settle', 3)
    `;

    await expect(migrateCostLedgerSchema(setup.sql)).resolves.toBeUndefined();
    await expectMigrationAppliedMarker(setup.sql);
  });

  it("serializes audit validation before a concurrent reserved-to-settled update", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_audit_lock");
    await setup.sql`INSERT INTO cost_ledger_accounts (account_id) VALUES ('account-a')`;
    await setup.sql`
      INSERT INTO cost_ledger_reservations
        (account_id, operation_id, reservation_id, reserved_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 5)
    `;

    let releaseAuditTransaction!: () => void;
    let rejectAuditReady!: (error: unknown) => void;
    let resolveAuditReady!: () => void;
    const auditReady = new Promise<void>((resolve, reject) => {
      resolveAuditReady = resolve;
      rejectAuditReady = reject;
    });
    const auditTransaction = setup.sql.begin(async (transaction) => {
      try {
        await transaction`
          INSERT INTO cost_ledger_audit
            (account_id, operation_id, reservation_id, event, amount_micros)
          VALUES ('account-a', 'settle-op', 'settle-res', 'reserve', 5)
        `;
        resolveAuditReady();
        await new Promise<void>((resolve) => {
          releaseAuditTransaction = resolve;
        });
      } catch (error) {
        rejectAuditReady(error);
        throw error;
      }
    });

    try {
      await auditReady;
      const updateAttempt = setup.sql.begin(async (transaction) => {
        await transaction`SET LOCAL lock_timeout = '100ms'`;
        await transaction`
          UPDATE cost_ledger_reservations
          SET status = 'settled', actual_micros = 3
          WHERE account_id = 'account-a' AND reservation_id = 'settle-res'
        `;
      });
      await expect(updateAttempt).rejects.toMatchObject({ code: "55P03" });
    } finally {
      releaseAuditTransaction();
      await auditTransaction;
    }

    await setup.sql`
      UPDATE cost_ledger_reservations
      SET status = 'settled', actual_micros = 3
      WHERE account_id = 'account-a' AND reservation_id = 'settle-res'
    `;
    await setup.sql`
      INSERT INTO cost_ledger_audit
        (account_id, operation_id, reservation_id, event, amount_micros)
      VALUES ('account-a', 'settle-op', 'settle-res', 'settle', 3)
    `;
    await expect(setup.sql`
      SELECT status, actual_micros AS "actualMicros",
             (SELECT count(*) FROM cost_ledger_audit
              WHERE account_id = 'account-a' AND reservation_id = 'settle-res') AS "auditCount"
      FROM cost_ledger_reservations
      WHERE account_id = 'account-a' AND reservation_id = 'settle-res'
    `).resolves.toEqual([{ status: "settled", actualMicros: "3", auditCount: "2" }]);
  });
});

async function createSchemaMigrations(sql: Sql) {
  await sql`CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
}

async function expectMigrationMarker(sql: Sql) {
  await expect(sql`
    SELECT 1 FROM schema_migrations WHERE name = ${costLedgerMigrationName}
  `).resolves.toEqual([]);
}

async function expectMigrationAppliedMarker(sql: Sql) {
  await expect(sql`
    SELECT name FROM schema_migrations WHERE name = ${costLedgerMigrationName}
  `).resolves.toEqual([{ name: costLedgerMigrationName }]);
}

async function compatibleUnmigratedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const setup = await isolatedDatabase(databases, prefix, false);
  await createSchemaMigrations(setup.sql);
  await setup.sql.unsafe(`
    CREATE TABLE cost_ledger_accounts (
      account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      committed_micros bigint NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
      reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
      hard_limit_micros bigint NOT NULL DEFAULT ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint
        CHECK (hard_limit_micros = ${COST_LEDGER_HARD_LIMIT_MICROS}::bigint),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await setup.sql`
    CREATE TABLE cost_ledger_reservations (
      account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reservation_id text NOT NULL,
      operation_id text NOT NULL,
      reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
      actual_micros bigint CHECK (actual_micros >= 0),
      status text NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'settled', 'released')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, reservation_id),
      UNIQUE (account_id, operation_id)
    )
  `;
  await setup.sql`
    CREATE TABLE cost_ledger_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      operation_id text NOT NULL,
      reservation_id text NOT NULL,
      event text NOT NULL CHECK (event IN ('reserve', 'settle', 'release')),
      amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, reservation_id, event),
      FOREIGN KEY (account_id, reservation_id)
        REFERENCES cost_ledger_reservations (account_id, reservation_id)
        ON DELETE RESTRICT
    )
  `;
  return setup;
}

async function isolatedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
  migrate = true,
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
  if (migrate) await migrateCostLedgerSchema(sql);
  return { sql };
}
