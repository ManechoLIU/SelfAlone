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
      await ensureReservationIntegrity(transaction);
      await assertExistingCostLedgerData(transaction);
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
    await ensureReservationIntegrity(transaction);
    await assertExistingCostLedgerData(transaction);
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

  const constraints = await transaction<Array<{ type: string; definition: string; validated: boolean }>>`
    SELECT db_constraint.contype AS type,
           pg_get_constraintdef(db_constraint.oid) AS definition,
           db_constraint.convalidated AS validated
    FROM pg_constraint AS db_constraint
    JOIN pg_class AS relation ON relation.oid = db_constraint.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema() AND relation.relname = ${tableName}
  `;
  const has = (type: string, expected: string) => constraints.some((constraint) => (
    constraint.type === type
    && constraint.validated
    && normalizeConstraint(constraint.definition) === expected
  ));

  const requiredConstraints: Array<[string, string]> =
    tableName === "cost_ledger_accounts"
      ? [
        ["p", "primary key account_id"],
        ["f", "foreign key account_id references accounts id on delete cascade"],
        ["c", "check committed_micros >= 0"],
        ["c", "check reserved_micros >= 0"],
        ["c", `check hard_limit_micros = ${COST_LEDGER_HARD_LIMIT_MICROS}`],
      ]
      : tableName === "cost_ledger_reservations"
        ? [
          ["p", "primary key account_id, reservation_id"],
          ["u", "unique account_id, operation_id"],
          ["f", "foreign key account_id references accounts id on delete cascade"],
          ["c", "check reserved_micros > 0"],
          ["c", "check actual_micros >= 0"],
          ["c", "check status in reserved, settled, released"],
        ]
        : [
          ["p", "primary key id"],
          ["u", "unique account_id, reservation_id, event"],
          ["f", "foreign key account_id, reservation_id references cost_ledger_reservations account_id, reservation_id on delete restrict"],
          ["c", "check event in reserve, settle, release"],
          ["c", "check amount_micros >= 0"],
        ];
  for (const [type, expected] of requiredConstraints) {
    if (!has(type, expected)) {
      throw incompatibleSchema(tableName, `missing validated constraint ${expected}`);
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

async function assertExistingCostLedgerData(transaction: TransactionSql) {
  const [invalidReservation] = await transaction<Array<{
    reservationId: string;
    status: string;
  }>>`
    SELECT reservation.reservation_id AS "reservationId", reservation.status
    FROM cost_ledger_reservations AS reservation
    LEFT JOIN cost_ledger_audit AS audit
      ON audit.account_id = reservation.account_id
     AND audit.reservation_id = reservation.reservation_id
    GROUP BY reservation.account_id, reservation.reservation_id,
             reservation.operation_id, reservation.reserved_micros,
             reservation.status, reservation.actual_micros
    HAVING COUNT(audit.id) FILTER (WHERE audit.event = 'reserve') <> 1
       OR COUNT(audit.id) FILTER (
            WHERE audit.event = 'reserve'
              AND audit.operation_id IS NOT DISTINCT FROM reservation.operation_id
              AND audit.amount_micros IS NOT DISTINCT FROM reservation.reserved_micros
          ) <> 1
       OR (
         reservation.status = 'reserved'
         AND (
           reservation.actual_micros IS NOT NULL
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'settle') <> 0
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'release') <> 0
         )
       )
       OR (
         reservation.status = 'settled'
         AND (
           reservation.actual_micros IS NULL
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'settle') <> 1
           OR COUNT(audit.id) FILTER (
                WHERE audit.event = 'settle'
                  AND audit.operation_id IS NOT DISTINCT FROM reservation.operation_id
                  AND audit.amount_micros IS NOT DISTINCT FROM reservation.actual_micros
              ) <> 1
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'release') <> 0
         )
       )
       OR (
         reservation.status = 'released'
         AND (
           reservation.actual_micros IS NOT NULL
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'release') <> 1
           OR COUNT(audit.id) FILTER (
                WHERE audit.event = 'release'
                  AND audit.operation_id IS NOT DISTINCT FROM reservation.operation_id
                  AND audit.amount_micros IS NOT DISTINCT FROM reservation.reserved_micros
              ) <> 1
           OR COUNT(audit.id) FILTER (WHERE audit.event = 'settle') <> 0
         )
       )
    LIMIT 1
  `;
  if (invalidReservation) {
    throw incompatibleSchema(
      "cost_ledger_reservations",
      `existing reservation ${invalidReservation.reservationId} has incomplete ${invalidReservation.status} lifecycle`,
    );
  }

  const [invalidAudit] = await transaction<Array<{
    reservationId: string;
    event: string;
  }>>`
    SELECT audit.reservation_id AS "reservationId", audit.event
    FROM cost_ledger_audit AS audit
    LEFT JOIN cost_ledger_reservations AS reservation
      ON reservation.account_id = audit.account_id
     AND reservation.reservation_id = audit.reservation_id
    WHERE reservation.reservation_id IS NULL
       OR audit.operation_id IS DISTINCT FROM reservation.operation_id
       OR (
         audit.event = 'reserve'
         AND audit.amount_micros IS DISTINCT FROM reservation.reserved_micros
       )
       OR (
         audit.event = 'settle'
         AND (
           reservation.status <> 'settled'
           OR reservation.actual_micros IS NULL
           OR audit.amount_micros IS DISTINCT FROM reservation.actual_micros
         )
       )
       OR (
         audit.event = 'release'
         AND (
           reservation.status <> 'released'
           OR audit.amount_micros IS DISTINCT FROM reservation.reserved_micros
         )
       )
    LIMIT 1
  `;
  if (invalidAudit) {
    throw incompatibleSchema(
      "cost_ledger_audit",
      `existing ${invalidAudit.event} audit does not match reservation ${invalidAudit.reservationId}`,
    );
  }

  // Reject complete histories where terminal settle/release audit is ordered before reserve audit
  // using deterministic ordering (created_at, id). This is the pre-marker validation path.
  const [chronologyViolation] = await transaction<Array<{ reservationId: string; event: string }>>`
    SELECT audit.reservation_id AS "reservationId", audit.event
    FROM cost_ledger_audit AS audit
    LEFT JOIN cost_ledger_reservations AS reservation
      ON reservation.account_id = audit.account_id
     AND reservation.reservation_id = audit.reservation_id
    WHERE reservation.reservation_id IS NOT NULL
      AND (audit.event = 'settle' OR audit.event = 'release')
      AND (
        -- terminal must be strictly after reserve under (created_at, id)
        EXISTS (
          SELECT 1
          FROM cost_ledger_audit AS prev
          WHERE prev.account_id = audit.account_id
            AND prev.reservation_id = audit.reservation_id
            AND prev.event = 'reserve'
            AND (prev.created_at, prev.id) > (audit.created_at, audit.id)
        )
      )
    GROUP BY audit.reservation_id, audit.event
    HAVING COUNT(*) > 0
  `;
  if (chronologyViolation) {
    throw incompatibleSchema(
      "cost_ledger_audit",
      `existing ${chronologyViolation.event} audit for reservation ${chronologyViolation.reservationId} has terminal audit before reserve audit`,
    );
  }
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
      FOR UPDATE;

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

async function ensureReservationIntegrity(transaction: TransactionSql) {
  await transaction.unsafe(`
    CREATE OR REPLACE FUNCTION cost_ledger_reservation_guard_update()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id
         OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
         OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
         OR NEW.reserved_micros IS DISTINCT FROM OLD.reserved_micros THEN
        RAISE EXCEPTION 'cost ledger reservation binding is immutable'
          USING ERRCODE = 'P0001';
      END IF;

      IF OLD.status = 'reserved' THEN
        IF NEW.status = 'reserved' AND NEW.actual_micros IS NOT NULL THEN
          RAISE EXCEPTION 'reserved cost ledger reservation cannot have an actual amount'
            USING ERRCODE = 'P0001';
        ELSIF NEW.status = 'settled' AND NEW.actual_micros IS NULL THEN
          RAISE EXCEPTION 'settled cost ledger reservation requires an actual amount'
            USING ERRCODE = 'P0001';
        ELSIF NEW.status = 'released' AND NEW.actual_micros IS NOT NULL THEN
          RAISE EXCEPTION 'released cost ledger reservation cannot have an actual amount'
            USING ERRCODE = 'P0001';
        END IF;
      ELSIF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.actual_micros IS DISTINCT FROM OLD.actual_micros THEN
        RAISE EXCEPTION 'terminal cost ledger reservation is immutable'
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END;
    $function$;

    DROP TRIGGER IF EXISTS cost_ledger_reservation_guard_update
      ON cost_ledger_reservations;
    CREATE TRIGGER cost_ledger_reservation_guard_update
      BEFORE UPDATE ON cost_ledger_reservations
      FOR EACH ROW EXECUTE FUNCTION cost_ledger_reservation_guard_update();
  `);

  await transaction.unsafe(`
    CREATE OR REPLACE FUNCTION cost_ledger_reservation_guard_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF NEW.status IS DISTINCT FROM 'reserved' THEN
        RAISE EXCEPTION 'terminal cost ledger reservation cannot be inserted directly'
          USING ERRCODE = 'P0001';
      END IF;
      IF NEW.actual_micros IS NOT NULL THEN
        RAISE EXCEPTION 'initial cost ledger reservation must have null actual amount'
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END;
    $function$;

    DROP TRIGGER IF EXISTS cost_ledger_reservation_guard_insert
      ON cost_ledger_reservations;
    CREATE TRIGGER cost_ledger_reservation_guard_insert
      BEFORE INSERT ON cost_ledger_reservations
      FOR EACH ROW EXECUTE FUNCTION cost_ledger_reservation_guard_insert();
  `);
}
