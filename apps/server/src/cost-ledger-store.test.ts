import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateCostLedgerSchema } from "./cost-ledger-migration";
import {
  COST_LEDGER_HARD_LIMIT_MICROS,
  CostLedgerStore,
  CostLedgerError,
} from "./cost-ledger-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("cost ledger store", () => {
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

  it("allows only one of two concurrent reservations that would cross the hard cap", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_concurrency");
    const store = new CostLedgerStore(setup.sql);

    const results = await Promise.allSettled([
      store.reserve({ accountId: "account-a", operationId: "op-a", reservationId: "res-a", amountMicros: 3_000_000 }),
      store.reserve({ accountId: "account-a", operationId: "op-b", reservationId: "res-b", amountMicros: 3_000_000 }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.objectContaining({ code: "COST_LIMIT_EXCEEDED" }) });

    await expect(store.getBalance("account-a")).resolves.toMatchObject({
      committedMicros: 0,
      reservedMicros: 3_000_000,
      availableMicros: 2_000_000,
    });
  });

  it("is idempotent for reserve, settle, and release while writing one audit event per transition", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_idempotency");
    const store = new CostLedgerStore(setup.sql);

    const reservationInput = {
      accountId: "account-a",
      operationId: "op-idempotent",
      reservationId: "res-idempotent",
      amountMicros: 1_000_000,
    } as const;
    await expect(store.reserve(reservationInput)).resolves.toMatchObject({ status: "reserved" });
    await expect(store.reserve(reservationInput)).resolves.toMatchObject({ status: "reserved" });
    await expect(store.settle({ ...reservationInput, actualMicros: 400_000 })).resolves.toMatchObject({ status: "settled" });
    await expect(store.settle({ ...reservationInput, actualMicros: 400_000 })).resolves.toMatchObject({ status: "settled" });
    await expect(store.getBalance("account-a")).resolves.toMatchObject({ committedMicros: 400_000, reservedMicros: 0 });

    const audit = await setup.sql<{ event: string; count: number }[]>`
      SELECT event, count(*)::int AS count
      FROM cost_ledger_audit
      WHERE account_id = 'account-a' AND reservation_id = 'res-idempotent'
      GROUP BY event ORDER BY event
    `;
    expect(audit).toEqual([
      { event: "reserve", count: 1 },
      { event: "settle", count: 1 },
    ]);

    const releasedInput = {
      accountId: "account-a",
      operationId: "op-release",
      reservationId: "res-release",
      amountMicros: 1_000_000,
    } as const;
    await store.reserve(releasedInput);
    await expect(store.release(releasedInput)).resolves.toMatchObject({ status: "released" });
    await expect(store.release(releasedInput)).resolves.toMatchObject({ status: "released" });
    await expect(store.getBalance("account-a")).resolves.toMatchObject({ committedMicros: 400_000, reservedMicros: 0 });
  });

  it("keeps account totals isolated and fails closed when actual cost needs cap-exceeding top-up", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_isolation");
    const store = new CostLedgerStore(setup.sql);
    await store.reserve({ accountId: "account-a", operationId: "op-a", reservationId: "res-a", amountMicros: 1_000_000 });
    await store.reserve({ accountId: "account-b", operationId: "op-b", reservationId: "res-b", amountMicros: COST_LEDGER_HARD_LIMIT_MICROS });

    await expect(store.settle({ accountId: "account-a", operationId: "op-a", reservationId: "res-a", actualMicros: COST_LEDGER_HARD_LIMIT_MICROS + 1 })).rejects.toMatchObject({
      code: "COST_LIMIT_EXCEEDED",
    });
    await expect(store.getReservation({ accountId: "account-a", reservationId: "res-a" })).resolves.toMatchObject({ status: "reserved" });
    await expect(store.getBalance("account-a")).resolves.toMatchObject({ committedMicros: 0, reservedMicros: 1_000_000 });
    await expect(store.getBalance("account-b")).resolves.toMatchObject({ committedMicros: 0, reservedMicros: COST_LEDGER_HARD_LIMIT_MICROS });
  });

  it("rejects invalid amounts and operation identity conflicts", async () => {
    const setup = await isolatedDatabase(databases, "cost_ledger_validation");
    const store = new CostLedgerStore(setup.sql);
    await expect(store.reserve({ accountId: "account-a", operationId: "op-a", reservationId: "res-a", amountMicros: 0 })).rejects.toMatchObject({ code: "COST_AMOUNT_INVALID" });
    await store.reserve({ accountId: "account-a", operationId: "op-a", reservationId: "res-a", amountMicros: 1 });
    await expect(store.reserve({ accountId: "account-a", operationId: "op-a", reservationId: "res-other", amountMicros: 1 })).rejects.toMatchObject({ code: "COST_IDEMPOTENCY_CONFLICT" });
    await expect(store.reserve({ accountId: "account-a", operationId: "op-other", reservationId: "res-a", amountMicros: 1 })).rejects.toMatchObject({ code: "COST_IDEMPOTENCY_CONFLICT" });
    await expect(store.reserve({ accountId: "missing", operationId: "op-missing", reservationId: "res-missing", amountMicros: 1 })).rejects.toMatchObject({ code: "23503" });
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
  const sql = postgres(databaseUrl.toString(), { max: 6 });
  databases.push({ administration, schema, sql });
  await sql`CREATE TABLE accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await migrateCostLedgerSchema(sql);
  return { sql };
}
