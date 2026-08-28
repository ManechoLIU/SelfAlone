import type { Sql, TransactionSql } from "postgres";

export const costLedgerMigrationName = "20260828_cost_ledger";
export const COST_LEDGER_HARD_LIMIT_MICROS = 5_000_000;

export class CostLedgerMigrationError extends Error {
  constructor(readonly code: "COST_LEDGER_SCHEMA_INCOMPATIBLE", message: string) {
    super(message);
    this.name = "CostLedgerMigrationError";
  }
}

type ColumnContract = {
  dataType: string;
  isNullable: "YES" | "NO";
  identityGeneration?: "ALWAYS" | "BY DEFAULT";
};

const ledgerColumnContracts: Record<string, Record<string, ColumnContract>> = {
  cost_ledger_accounts: {
    account_id: { dataType: "text", isNullable: "NO" },
    committed_micros: { dataType: "bigint", isNullable: "NO" },
    reserved_micros: { dataType: "bigint", isNullable: "NO" },
    hard_limit_micros: { dataType: "bigint", isNullable: "NO" },
    created_at: { dataType: "timestamp with time zone", isNullable: "NO" },
    updated_at: { dataType: "timestamp with time zone", isNullable: "NO" },
  },
  cost_ledger_reservations: {
    account_id: { dataType: "text", isNullable: "NO" },
    reservation_id: { dataType: "text", isNullable: "NO" },
    operation_id: { dataType: "text", isNullable: "NO" },
    reserved_micros: { dataType: "bigint", isNullable: "NO" },
    actual_micros: { dataType: "bigint", isNullable: "YES" },
    status: { dataType: "text", isNullable: "NO" },
    created_at: { dataType: "timestamp with time zone", isNullable: "NO" },
    updated_at: { dataType: "timestamp with time zone", isNullable: "NO" },
  },
  cost_ledger_audit: {
    id: { dataType: "bigint", isNullable: "NO", identityGeneration: "ALWAYS" },
    account_id: { dataType: "text", isNullable: "NO" },
    operation_id: { dataType: "text", isNullable: "NO" },
    reservation_id: { dataType: "text", isNullable: "NO" },
    event: { dataType: "text", isNullable: "NO" },
    amount_micros: { dataType: "bigint", isNullable: "NO" },
    created_at: { dataType: "timestamp with time zone", isNullable: "NO" },
  },
};

/** Creates the account-scoped, integer-micros cost ledger. */
export async function migrateCostLedgerSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${costLedgerMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${costLedgerMigrationName}
      FOR UPDATE
    `;
    if (applied) {
      await assertCostLedgerSchema(transaction);
      await ensureAuditImmutability(transaction);
      await ensureAuditConsistency(transaction);
      return;
    }

    // CREATE TABLE IF NOT EXISTS is intentionally not treated as a schema
    // compatibility check. Validate any pre-existing relation first so a
    // same-name partial table cannot let this migration reach its marker.
    await assertExistingLedgerTables(transaction);

    const hardLimitMicros = String(COST_LEDGER_HARD_LIMIT_MICROS);
    await transaction.unsafe(`
      CREATE TABLE IF NOT EXISTS cost_ledger_accounts (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        committed_micros bigint NOT NULL DEFAULT 0
          CONSTRAINT cost_ledger_accounts_committed_nonnegative CHECK (committed_micros >= 0),
        reserved_micros bigint NOT NULL DEFAULT 0
          CONSTRAINT cost_ledger_accounts_reserved_nonnegative CHECK (reserved_micros >= 0),
        hard_limit_micros bigint NOT NULL DEFAULT ${hardLimitMicros}
          CONSTRAINT cost_ledger_accounts_hard_limit CHECK (hard_limit_micros = ${hardLimitMicros}),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await transaction`
      CREATE TABLE IF NOT EXISTS cost_ledger_reservations (
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        reservation_id text NOT NULL,
        operation_id text NOT NULL,
        reserved_micros bigint NOT NULL
          CONSTRAINT cost_ledger_reservations_reserved_positive CHECK (reserved_micros > 0),
        actual_micros bigint
          CONSTRAINT cost_ledger_reservations_actual_nonnegative CHECK (actual_micros >= 0),
        status text NOT NULL DEFAULT 'reserved'
          CONSTRAINT cost_ledger_reservations_status CHECK (status IN ('reserved', 'settled', 'released')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, reservation_id),
        UNIQUE (account_id, operation_id)
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS cost_ledger_reservations_account_status_idx
      ON cost_ledger_reservations (account_id, status)
    `;
    await transaction`
      CREATE TABLE IF NOT EXISTS cost_ledger_audit (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        operation_id text NOT NULL,
        reservation_id text NOT NULL,
        event text NOT NULL
          CONSTRAINT cost_ledger_audit_event CHECK (event IN ('reserve', 'settle', 'release')),
        amount_micros bigint NOT NULL
          CONSTRAINT cost_ledger_audit_amount_nonnegative CHECK (amount_micros >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, reservation_id, event),
        FOREIGN KEY (account_id, reservation_id)
          REFERENCES cost_ledger_reservations (account_id, reservation_id)
          ON DELETE RESTRICT
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS cost_ledger_audit_account_created_idx
      ON cost_ledger_audit (account_id, created_at, id)
    `;
    await assertCostLedgerSchema(transaction);
    await ensureAuditImmutability(transaction);
    await ensureAuditConsistency(transaction);
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${costLedgerMigrationName})
    `;
  });
}

async function assertExistingLedgerTables(transaction: TransactionSql) {
  for (const tableName of Object.keys(ledgerColumnContracts)) {
    const [relation] = await transaction<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname = ${tableName}
      ) AS exists
    `;
    if (relation?.exists) await assertLedgerTableSchema(transaction, tableName);
  }
}

async function assertCostLedgerSchema(transaction: TransactionSql) {
  for (const tableName of Object.keys(ledgerColumnContracts)) {
    await assertLedgerTableSchema(transaction, tableName);
  }
}

async function assertLedgerTableSchema(transaction: TransactionSql, tableName: string) {
  const [relation] = await transaction<{ relkind: string }[]>`
    SELECT relation.relkind
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = ${tableName}
  `;
  if (!relation || !["r", "p"].includes(relation.relkind)) {
    throw incompatibleSchema(tableName, "relation is not a table");
  }

  const columns = await transaction<
    Array<{
      columnName: string;
      dataType: string;
      isNullable: "YES" | "NO";
      identityGeneration: "ALWAYS" | "BY DEFAULT" | null;
    }>
  >`
    SELECT column_name AS "columnName", data_type AS "dataType",
           is_nullable AS "isNullable", identity_generation AS "identityGeneration"
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${tableName}
  `;
  const byName = new Map(columns.map((column) => [column.columnName, column]));
  for (const [columnName, contract] of Object.entries(ledgerColumnContracts[tableName]!)) {
    const column = byName.get(columnName);
    if (
      !column
      || column.dataType !== contract.dataType
      || column.isNullable !== contract.isNullable
      || (contract.identityGeneration !== undefined
        && column.identityGeneration !== contract.identityGeneration)
    ) {
      throw incompatibleSchema(tableName, `column ${columnName} does not match the ledger contract`);
    }
  }

  const constraints = await transaction<Array<{ type: string; definition: string }>>`
    SELECT db_constraint.contype AS type, pg_get_constraintdef(db_constraint.oid) AS definition
    FROM pg_constraint AS db_constraint
    JOIN pg_class AS relation ON relation.oid = db_constraint.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema() AND relation.relname = ${tableName}
  `;
  const has = (type: string, ...parts: string[]) => constraints.some((constraint) => {
    if (constraint.type !== type) return false;
    const definition = normalizeConstraint(constraint.definition);
    return parts.every((part) => definition.includes(part));
  });

  const requiredConstraints: Array<[string, string[]]> =
    tableName === "cost_ledger_accounts"
      ? [
        ["p", ["primary key", "account_id"]],
        ["f", ["foreign key account_id references accounts id", "on delete cascade"]],
        ["c", ["committed_micros >= 0"]],
        ["c", ["reserved_micros >= 0"]],
        ["c", [`hard_limit_micros = ${COST_LEDGER_HARD_LIMIT_MICROS}`]],
      ]
      : tableName === "cost_ledger_reservations"
        ? [
          ["p", ["primary key", "account_id, reservation_id"]],
          ["u", ["unique", "account_id, operation_id"]],
          ["f", ["foreign key account_id references accounts id", "on delete cascade"]],
          ["c", ["reserved_micros > 0"]],
          ["c", ["actual_micros >= 0"]],
          ["c", ["status in reserved, settled, released"]],
        ]
        : [
          ["p", ["primary key", "id"]],
          ["u", ["unique", "account_id, reservation_id, event"]],
          ["f", ["foreign key account_id, reservation_id references cost_ledger_reservations account_id, reservation_id", "on delete restrict"]],
          ["c", ["event in reserve, settle, release"]],
          ["c", ["amount_micros >= 0"]],
        ];
  for (const [type, parts] of requiredConstraints) {
    if (!has(type, ...parts)) {
      throw incompatibleSchema(tableName, `missing constraint containing ${parts.join(" / ")}`);
    }
  }
}

function normalizeConstraint(definition: string) {
  return definition
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/=\s*any\s+array/g, " in")
    .replace(/\b(array|any)\b/g, "")
    .replace(/::[a-z_ ]+/g, "")
    .replace(/[\"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function incompatibleSchema(tableName: string, reason: string) {
  return new CostLedgerMigrationError(
    "COST_LEDGER_SCHEMA_INCOMPATIBLE",
    `incompatible ${tableName} schema: ${reason}`,
  );
}

async function ensureAuditImmutability(transaction: TransactionSql) {
  await transaction.unsafe(`
    CREATE OR REPLACE FUNCTION cost_ledger_audit_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION 'cost ledger audit is immutable' USING ERRCODE = 'P0001';
    END;
    $function$;

    DROP TRIGGER IF EXISTS cost_ledger_audit_no_update_delete
      ON cost_ledger_audit;
    CREATE TRIGGER cost_ledger_audit_no_update_delete
      BEFORE UPDATE OR DELETE ON cost_ledger_audit
      FOR EACH ROW EXECUTE FUNCTION cost_ledger_audit_immutable();

    DROP TRIGGER IF EXISTS cost_ledger_audit_no_truncate
      ON cost_ledger_audit;
    CREATE TRIGGER cost_ledger_audit_no_truncate
      BEFORE TRUNCATE ON cost_ledger_audit
      FOR EACH STATEMENT EXECUTE FUNCTION cost_ledger_audit_immutable();
  `);
}

async function ensureAuditConsistency(transaction: TransactionSql) {
  await transaction.unsafe(`
    CREATE OR REPLACE FUNCTION cost_ledger_audit_validate_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      reservation_record cost_ledger_reservations%ROWTYPE;
    BEGIN
      SELECT * INTO reservation_record
      FROM cost_ledger_reservations
      WHERE account_id = NEW.account_id
        AND reservation_id = NEW.reservation_id
      FOR KEY SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'cost ledger audit reservation is missing'
          USING ERRCODE = '23514';
      END IF;
      IF reservation_record.operation_id IS DISTINCT FROM NEW.operation_id THEN
        RAISE EXCEPTION 'cost ledger audit operation does not match reservation'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.event = 'reserve' THEN
        IF reservation_record.status <> 'reserved'
           OR NEW.amount_micros IS DISTINCT FROM reservation_record.reserved_micros THEN
          RAISE EXCEPTION 'cost ledger reserve audit does not match reservation'
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.event = 'settle' THEN
        IF reservation_record.status <> 'settled'
           OR reservation_record.actual_micros IS NULL
           OR NEW.amount_micros IS DISTINCT FROM reservation_record.actual_micros THEN
          RAISE EXCEPTION 'cost ledger settle audit does not match transition'
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.event = 'release' THEN
        IF reservation_record.status <> 'released'
           OR NEW.amount_micros IS DISTINCT FROM reservation_record.reserved_micros THEN
          RAISE EXCEPTION 'cost ledger release audit does not match transition'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'cost ledger audit event is unsupported'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $function$;

    DROP TRIGGER IF EXISTS cost_ledger_audit_validate_insert
      ON cost_ledger_audit;
    CREATE TRIGGER cost_ledger_audit_validate_insert
      BEFORE INSERT ON cost_ledger_audit
      FOR EACH ROW EXECUTE FUNCTION cost_ledger_audit_validate_insert();
  `);
}
