import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateCostLedgerSchema } from "./cost-ledger-migration";
import { CostLedgerStore } from "./cost-ledger-store";
import { createPlatformTextCapability } from "./platform-text-capability";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("platform text capability settlement recovery", () => {
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

  it("returns the provider result when settlement committed but its acknowledgement was lost", async () => {
    const setup = await isolatedDatabase(databases, "platform_settlement_ack_lost");
    const store = new CostLedgerStore(setup.sql);
    let providerCalls = 0;
    const costLedger = {
      reserve: store.reserve.bind(store),
      async settle(input: Parameters<CostLedgerStore["settle"]>[0]) {
        await store.settle(input);
        throw new Error("SETTLEMENT_ACK_LOST");
      },
      release: store.release.bind(store),
      getReservation: store.getReservation.bind(store),
    };
    const capability = createPlatformTextCapability({
      configuredUserModel: { async chat() { return { text: "unused" }; } },
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" }; } },
      costLedger,
      platformModel: {
        async chat() {
          providerCalls += 1;
          return { text: "已完成的平台回答", actualCostMicros: 400_000 };
        },
      },
      reservationAmountMicros: 500_000,
      attemptIdFactory: () => "attempt-ack-lost",
    });

    await expect(capability.chat({
      accountId: "account-a",
      text: "继续当前问题",
      context: [{
        id: "request-ack-lost:user",
        role: "user",
        text: "继续当前问题",
        requestId: "request-ack-lost",
      }],
    }, new AbortController().signal)).resolves.toEqual({ text: "已完成的平台回答" });
    expect(providerCalls).toBe(1);
    await expect(store.getReservation({
      accountId: "account-a",
      reservationId: "platform-text:request-ack-lost:attempt-ack-lost",
    })).resolves.toMatchObject({ status: "settled", actualMicros: 400_000 });
    await expect(store.getBalance("account-a")).resolves.toMatchObject({
      committedMicros: 400_000,
      reservedMicros: 0,
    });
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
  await sql`INSERT INTO accounts (id) VALUES ('account-a')`;
  await migrateCostLedgerSchema(sql);
  return { sql };
}
