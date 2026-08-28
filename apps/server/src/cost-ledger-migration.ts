import type { Sql, TransactionSql } from "postgres";

export const costLedgerMigrationName = "20260828_cost_ledger";
export const COST_LEDGER_HARD_LIMIT_MICROS = 5_000_000;

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
      await ensureAuditImmutability(transaction);
      return;
    }

    const hardLimitMicros = String(COST_LEDGER_HARD_LIMIT_MICROS);
    await transaction.unsafe(`
      CREATE TABLE IF NOT EXISTS cost_ledger_accounts (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        committed_micros bigint NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
        reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
        hard_limit_micros bigint NOT NULL DEFAULT ${hardLimitMicros}
          CHECK (hard_limit_micros = ${hardLimitMicros}),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await transaction`
      CREATE TABLE IF NOT EXISTS cost_ledger_reservations (
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
        event text NOT NULL CHECK (event IN ('reserve', 'settle', 'release')),
        amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
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
    await ensureAuditImmutability(transaction);
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${costLedgerMigrationName})
    `;
  });
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
  `);
}
