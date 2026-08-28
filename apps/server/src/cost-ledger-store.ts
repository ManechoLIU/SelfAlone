import type { Sql, TransactionSql } from "postgres";
import { COST_LEDGER_HARD_LIMIT_MICROS } from "./cost-ledger-migration";

export { COST_LEDGER_HARD_LIMIT_MICROS } from "./cost-ledger-migration";
export const CNY_MICROS_PER_YUAN = 1_000_000;

export type CostMicrosInput = number | bigint | string;
export type CostLedgerReservationStatus = "reserved" | "settled" | "released";

export type CostLedgerReserveInput = {
  accountId: string;
  operationId: string;
  reservationId: string;
  amountMicros: CostMicrosInput;
};

export type CostLedgerSettleInput = {
  accountId: string;
  operationId?: string;
  reservationId: string;
  actualMicros: CostMicrosInput;
};

export type CostLedgerReleaseInput = {
  accountId: string;
  operationId?: string;
  reservationId: string;
};

export type CostLedgerBalance = {
  accountId: string;
  committedMicros: number;
  reservedMicros: number;
  availableMicros: number;
  hardLimitMicros: number;
};

export type CostLedgerReservation = {
  accountId: string;
  operationId: string;
  reservationId: string;
  status: CostLedgerReservationStatus;
  amountMicros: number;
  reservedMicros: number;
  actualMicros: number | null;
  committedMicros: number;
  accountReservedMicros: number;
};

export type CostLedgerAuditEvent = {
  id: number;
  accountId: string;
  operationId: string;
  reservationId: string;
  event: "reserve" | "settle" | "release";
  amountMicros: number;
  createdAt: Date;
};

export class CostLedgerError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_REQUIRED"
      | "COST_AMOUNT_INVALID"
      | "COST_ID_REQUIRED"
      | "COST_IDEMPOTENCY_CONFLICT"
      | "COST_LIMIT_EXCEEDED"
      | "COST_RESERVATION_NOT_FOUND"
      | "COST_RESERVATION_TERMINAL",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CostLedgerError";
  }
}

type DbAccount = {
  accountId: string;
  committedMicros: number | string;
  reservedMicros: number | string;
  hardLimitMicros: number | string;
};

type DbReservation = {
  accountId: string;
  operationId: string;
  reservationId: string;
  status: CostLedgerReservationStatus;
  reservedMicros: number | string;
  actualMicros: number | string | null;
};

/** Account-scoped atomic reservation and settlement ledger. Every amount is CNY micros. */
export class CostLedgerStore {
  constructor(private readonly sql: Sql) {}

  async reserve(input: CostLedgerReserveInput): Promise<CostLedgerReservation> {
    const accountId = assertAccountId(input.accountId);
    const operationId = assertId(input.operationId, "operationId");
    const reservationId = assertId(input.reservationId, "reservationId");
    const amountMicros = assertPositiveMicros(input.amountMicros);

    return this.sql.begin(async (transaction) => {
      const account = await lockAccount(transaction, accountId);
      const [existing] = await transaction<DbReservation[]>`
        SELECT account_id AS "accountId", operation_id AS "operationId",
               reservation_id AS "reservationId", status,
               reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
        FROM cost_ledger_reservations
        WHERE account_id = ${accountId}
          AND (reservation_id = ${reservationId} OR operation_id = ${operationId})
        FOR UPDATE
      `;
      if (existing) {
        if (
          existing.operationId !== operationId ||
          existing.reservationId !== reservationId ||
          toMicros(existing.reservedMicros) !== amountMicros
        ) {
          throw new CostLedgerError("COST_IDEMPOTENCY_CONFLICT");
        }
        return toReservation(existing, account);
      }

      const committedMicros = toMicros(account.committedMicros);
      const reservedMicros = toMicros(account.reservedMicros);
      const hardLimitMicros = toMicros(account.hardLimitMicros);
      if (committedMicros + reservedMicros + amountMicros > hardLimitMicros) {
        throw new CostLedgerError("COST_LIMIT_EXCEEDED");
      }

      const [reservation] = await transaction<DbReservation[]>`
        INSERT INTO cost_ledger_reservations
          (account_id, operation_id, reservation_id, reserved_micros)
        VALUES (${accountId}, ${operationId}, ${reservationId}, ${amountMicros})
        RETURNING account_id AS "accountId", operation_id AS "operationId",
          reservation_id AS "reservationId", status,
          reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
      `;
      await transaction`
        UPDATE cost_ledger_accounts
        SET reserved_micros = reserved_micros + ${amountMicros}, updated_at = now()
        WHERE account_id = ${accountId}
      `;
      await appendAudit(transaction, {
        accountId,
        operationId,
        reservationId,
        event: "reserve",
        amountMicros,
      });
      return toReservation(reservation!, {
        ...account,
        reservedMicros: reservedMicros + amountMicros,
      });
    });
  }

  async settle(input: CostLedgerSettleInput): Promise<CostLedgerReservation> {
    const accountId = assertAccountId(input.accountId);
    const reservationId = assertId(input.reservationId, "reservationId");
    const operationId = input.operationId === undefined ? undefined : assertId(input.operationId, "operationId");
    const actualMicros = assertNonNegativeMicros(input.actualMicros);

    return this.sql.begin(async (transaction) => {
      const account = await lockAccount(transaction, accountId);
      const reservation = await findReservation(transaction, accountId, reservationId);
      assertOperation(reservation, operationId);
      if (reservation.status === "settled") {
        if (toMicros(reservation.actualMicros) !== actualMicros) {
          throw new CostLedgerError("COST_IDEMPOTENCY_CONFLICT");
        }
        return toReservation(reservation, account);
      }
      if (reservation.status === "released") {
        throw new CostLedgerError("COST_RESERVATION_TERMINAL");
      }

      const reservedMicros = toMicros(reservation.reservedMicros);
      const committedMicros = toMicros(account.committedMicros);
      const accountReservedMicros = toMicros(account.reservedMicros);
      const hardLimitMicros = toMicros(account.hardLimitMicros);
      if (committedMicros + accountReservedMicros - reservedMicros + actualMicros > hardLimitMicros) {
        throw new CostLedgerError("COST_LIMIT_EXCEEDED");
      }

      await transaction`
        UPDATE cost_ledger_accounts
        SET reserved_micros = reserved_micros - ${reservedMicros},
            committed_micros = committed_micros + ${actualMicros},
            updated_at = now()
        WHERE account_id = ${accountId}
      `;
      const [settled] = await transaction<DbReservation[]>`
        UPDATE cost_ledger_reservations
        SET status = 'settled', actual_micros = ${actualMicros}, updated_at = now()
        WHERE account_id = ${accountId} AND reservation_id = ${reservationId}
        RETURNING account_id AS "accountId", operation_id AS "operationId",
          reservation_id AS "reservationId", status,
          reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
      `;
      await appendAudit(transaction, {
        accountId,
        operationId: reservation.operationId,
        reservationId,
        event: "settle",
        amountMicros: actualMicros,
      });
      return toReservation(settled!, {
        ...account,
        committedMicros: committedMicros + actualMicros,
        reservedMicros: accountReservedMicros - reservedMicros,
      });
    });
  }

  async release(input: CostLedgerReleaseInput): Promise<CostLedgerReservation> {
    const accountId = assertAccountId(input.accountId);
    const reservationId = assertId(input.reservationId, "reservationId");
    const operationId = input.operationId === undefined ? undefined : assertId(input.operationId, "operationId");

    return this.sql.begin(async (transaction) => {
      const account = await lockAccount(transaction, accountId);
      const reservation = await findReservation(transaction, accountId, reservationId);
      assertOperation(reservation, operationId);
      if (reservation.status === "released") return toReservation(reservation, account);
      if (reservation.status === "settled") {
        throw new CostLedgerError("COST_RESERVATION_TERMINAL");
      }

      const reservedMicros = toMicros(reservation.reservedMicros);
      const accountReservedMicros = toMicros(account.reservedMicros);
      await transaction`
        UPDATE cost_ledger_accounts
        SET reserved_micros = reserved_micros - ${reservedMicros}, updated_at = now()
        WHERE account_id = ${accountId}
      `;
      const [released] = await transaction<DbReservation[]>`
        UPDATE cost_ledger_reservations
        SET status = 'released', updated_at = now()
        WHERE account_id = ${accountId} AND reservation_id = ${reservationId}
        RETURNING account_id AS "accountId", operation_id AS "operationId",
          reservation_id AS "reservationId", status,
          reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
      `;
      await appendAudit(transaction, {
        accountId,
        operationId: reservation.operationId,
        reservationId,
        event: "release",
        amountMicros: reservedMicros,
      });
      return toReservation(released!, {
        ...account,
        reservedMicros: accountReservedMicros - reservedMicros,
      });
    });
  }

  async getBalance(accountIdInput: string): Promise<CostLedgerBalance> {
    const accountId = assertAccountId(accountIdInput);
    await this.sql`
      INSERT INTO cost_ledger_accounts (account_id) VALUES (${accountId})
      ON CONFLICT (account_id) DO NOTHING
    `;
    const [account] = await this.sql<DbAccount[]>`
      SELECT account_id AS "accountId", committed_micros AS "committedMicros",
             reserved_micros AS "reservedMicros", hard_limit_micros AS "hardLimitMicros"
      FROM cost_ledger_accounts WHERE account_id = ${accountId}
    `;
    if (!account) throw new CostLedgerError("COST_RESERVATION_NOT_FOUND", "ACCOUNT_NOT_FOUND");
    return toBalance(account);
  }

  async getAccountTotals(accountId: string) {
    return this.getBalance(accountId);
  }

  async getReservation(input: { accountId: string; reservationId: string }): Promise<CostLedgerReservation> {
    const accountId = assertAccountId(input.accountId);
    const reservationId = assertId(input.reservationId, "reservationId");
    const [reservation] = await this.sql<DbReservation[]>`
      SELECT account_id AS "accountId", operation_id AS "operationId",
             reservation_id AS "reservationId", status,
             reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
      FROM cost_ledger_reservations
      WHERE account_id = ${accountId} AND reservation_id = ${reservationId}
    `;
    if (!reservation) throw new CostLedgerError("COST_RESERVATION_NOT_FOUND");
    const balance = await this.getBalance(accountId);
    return toReservation(reservation, balance);
  }

  async listAudit(accountIdInput: string): Promise<CostLedgerAuditEvent[]> {
    const accountId = assertAccountId(accountIdInput);
    const rows = await this.sql<Array<{
      id: number | string;
      accountId: string;
      operationId: string;
      reservationId: string;
      event: "reserve" | "settle" | "release";
      amountMicros: number | string;
      createdAt: Date;
    }>>`
      SELECT id, account_id AS "accountId", operation_id AS "operationId",
             reservation_id AS "reservationId", event,
             amount_micros AS "amountMicros", created_at AS "createdAt"
      FROM cost_ledger_audit
      WHERE account_id = ${accountId}
      ORDER BY id
    `;
    return rows.map((row) => ({ ...row, id: toMicros(row.id), amountMicros: toMicros(row.amountMicros) }));
  }
}

async function lockAccount(transaction: TransactionSql, accountId: string): Promise<DbAccount> {
  await transaction`
    INSERT INTO cost_ledger_accounts (account_id) VALUES (${accountId})
    ON CONFLICT (account_id) DO NOTHING
  `;
  const [account] = await transaction<DbAccount[]>`
    SELECT account_id AS "accountId", committed_micros AS "committedMicros",
           reserved_micros AS "reservedMicros", hard_limit_micros AS "hardLimitMicros"
    FROM cost_ledger_accounts
    WHERE account_id = ${accountId}
    FOR UPDATE
  `;
  if (!account) throw new CostLedgerError("COST_RESERVATION_NOT_FOUND", "ACCOUNT_NOT_FOUND");
  return account;
}

async function findReservation(transaction: TransactionSql, accountId: string, reservationId: string) {
  const [reservation] = await transaction<DbReservation[]>`
    SELECT account_id AS "accountId", operation_id AS "operationId",
           reservation_id AS "reservationId", status,
           reserved_micros AS "reservedMicros", actual_micros AS "actualMicros"
    FROM cost_ledger_reservations
    WHERE account_id = ${accountId} AND reservation_id = ${reservationId}
    FOR UPDATE
  `;
  if (!reservation) throw new CostLedgerError("COST_RESERVATION_NOT_FOUND");
  return reservation;
}

async function appendAudit(
  transaction: TransactionSql,
  input: Pick<CostLedgerAuditEvent, "accountId" | "operationId" | "reservationId" | "event" | "amountMicros">,
) {
  await transaction`
    INSERT INTO cost_ledger_audit
      (account_id, operation_id, reservation_id, event, amount_micros)
    VALUES (${input.accountId}, ${input.operationId}, ${input.reservationId}, ${input.event}, ${input.amountMicros})
  `;
}

function toBalance(account: DbAccount | CostLedgerBalance): CostLedgerBalance {
  const committedMicros = toMicros(account.committedMicros);
  const reservedMicros = toMicros(account.reservedMicros);
  const hardLimitMicros = toMicros(account.hardLimitMicros);
  return {
    accountId: account.accountId,
    committedMicros,
    reservedMicros,
    availableMicros: hardLimitMicros - committedMicros - reservedMicros,
    hardLimitMicros,
  };
}

function toReservation(reservation: DbReservation, account: DbAccount | CostLedgerBalance): CostLedgerReservation {
  const reservedMicros = toMicros(reservation.reservedMicros);
  return {
    accountId: reservation.accountId,
    operationId: reservation.operationId,
    reservationId: reservation.reservationId,
    status: reservation.status,
    amountMicros: reservedMicros,
    reservedMicros,
    actualMicros: reservation.actualMicros === null ? null : toMicros(reservation.actualMicros),
    committedMicros: toMicros(account.committedMicros),
    accountReservedMicros: toMicros(account.reservedMicros),
  };
}

function assertOperation(reservation: DbReservation, operationId: string | undefined) {
  if (operationId !== undefined && operationId !== reservation.operationId) {
    throw new CostLedgerError("COST_IDEMPOTENCY_CONFLICT");
  }
}

function assertAccountId(accountId: string) {
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new CostLedgerError("ACCOUNT_REQUIRED");
  }
  return accountId;
}

function assertId(id: string, name: string) {
  if (typeof id !== "string" || !id.trim()) {
    throw new CostLedgerError("COST_ID_REQUIRED", `${name} required`);
  }
  return id;
}

function assertPositiveMicros(value: CostMicrosInput) {
  const micros = parseMicros(value);
  if (micros <= 0) throw new CostLedgerError("COST_AMOUNT_INVALID");
  return micros;
}

function assertNonNegativeMicros(value: CostMicrosInput) {
  const micros = parseMicros(value);
  if (micros < 0) throw new CostLedgerError("COST_AMOUNT_INVALID");
  return micros;
}

function parseMicros(value: CostMicrosInput | null): number {
  if (value === null) throw new CostLedgerError("COST_AMOUNT_INVALID");
  let parsed: bigint;
  try {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new Error("not integer");
      parsed = BigInt(value);
    } else if (typeof value === "bigint") {
      parsed = value;
    } else if (!/^\d+$/.test(value)) {
      throw new Error("not integer");
    } else {
      parsed = BigInt(value);
    }
  } catch {
    throw new CostLedgerError("COST_AMOUNT_INVALID");
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CostLedgerError("COST_AMOUNT_INVALID");
  }
  return Number(parsed);
}

function toMicros(value: number | string | bigint | null): number {
  if (value === null) return 0;
  return parseMicros(value);
}
