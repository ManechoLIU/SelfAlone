import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateCostLedgerSchema } from "./cost-ledger-migration";
import { CostLedgerStore } from "./cost-ledger-store";
import {
  createPlatformTextCapability,
  PLATFORM_EXHAUSTION,
  PLATFORM_UNAVAILABLE,
} from "./platform-text-capability";

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

  it("admits only one provider call while a concurrent reservation would cross the hard cap", async () => {
    const setup = await isolatedDatabase(databases, "platform_concurrent_hard_cap");
    const store = new CostLedgerStore(setup.sql);
    const providerEntered = deferred<void>();
    const releaseProvider = deferred<void>();
    const attemptIds = ["attempt-first", "attempt-second"];
    let providerCalls = 0;
    const capability = createPlatformTextCapability({
      configuredUserModel: { async chat() { return { text: "unused" }; } },
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" }; } },
      costLedger: store,
      platformModel: {
        async chat() {
          providerCalls += 1;
          if (providerCalls === 1) {
            providerEntered.resolve();
            await releaseProvider.promise;
            return { text: "首个请求完成", actualCostMicros: 1_000_000 };
          }
          return { text: "不应放行的第二次调用", actualCostMicros: 1_000_000 };
        },
      },
      reservationAmountMicros: 3_000_000,
      attemptIdFactory: () => attemptIds.shift() ?? "unexpected-attempt",
    });

    const first = capability.chat(platformInput("request-concurrent-first"), signal());
    await providerEntered.promise;
    const second = capability.chat(platformInput("request-concurrent-second"), signal());

    const secondOutcome = await second.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    releaseProvider.resolve();
    await expect(first).resolves.toEqual({ text: "首个请求完成" });
    expect(secondOutcome).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: PLATFORM_EXHAUSTION }),
    });
    expect(providerCalls).toBe(1);
    await expect(store.getBalance("account-a")).resolves.toMatchObject({
      committedMicros: 1_000_000,
      reservedMicros: 0,
      availableMicros: 4_000_000,
    });
    await expect(store.getReservation({
      accountId: "account-a",
      reservationId: "platform-text:request-concurrent-first:attempt-first",
    })).resolves.toMatchObject({ status: "settled", actualMicros: 1_000_000 });
    await expect(store.getReservation({
      accountId: "account-a",
      reservationId: "platform-text:request-concurrent-second:attempt-second",
    })).rejects.toMatchObject({ code: "COST_RESERVATION_NOT_FOUND" });
    const concurrencyAudit = (await store.listAudit("account-a")).map(
      ({ amountMicros, event, reservationId }) => ({ amountMicros, event, reservationId }),
    );
    expect(concurrencyAudit).toEqual([
      {
        event: "reserve",
        reservationId: "platform-text:request-concurrent-first:attempt-first",
        amountMicros: 3_000_000,
      },
      {
        event: "settle",
        reservationId: "platform-text:request-concurrent-first:attempt-first",
        amountMicros: 1_000_000,
      },
    ]);
  });

  it("releases a failed provider reservation before retrying the same request with a new attempt", async () => {
    const setup = await isolatedDatabase(databases, "platform_provider_retry");
    const store = new CostLedgerStore(setup.sql);
    const attemptIds = ["attempt-failed", "attempt-retry"];
    let providerCalls = 0;
    const capability = createPlatformTextCapability({
      configuredUserModel: { async chat() { return { text: "unused" }; } },
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" }; } },
      costLedger: store,
      platformModel: {
        async chat() {
          providerCalls += 1;
          if (providerCalls === 1) throw new Error("PROVIDER_FAILED");
          return { text: "重试成功", actualCostMicros: 400_000 };
        },
      },
      reservationAmountMicros: 500_000,
      attemptIdFactory: () => attemptIds.shift() ?? "unexpected-attempt",
    });
    const input = platformInput("request-provider-retry");

    await expect(capability.chat(input, signal())).rejects.toThrow(PLATFORM_UNAVAILABLE);
    await expect(capability.chat(input, signal())).resolves.toEqual({ text: "重试成功" });
    expect(providerCalls).toBe(2);
    await expect(store.getReservation({
      accountId: "account-a",
      reservationId: "platform-text:request-provider-retry:attempt-failed",
    })).resolves.toMatchObject({ status: "released", actualMicros: null });
    await expect(store.getReservation({
      accountId: "account-a",
      reservationId: "platform-text:request-provider-retry:attempt-retry",
    })).resolves.toMatchObject({ status: "settled", actualMicros: 400_000 });
    await expect(store.getBalance("account-a")).resolves.toMatchObject({
      committedMicros: 400_000,
      reservedMicros: 0,
      availableMicros: 4_600_000,
    });
    const retryAudit = (await store.listAudit("account-a")).map(
      ({ amountMicros, event, reservationId }) => ({ amountMicros, event, reservationId }),
    );
    expect(retryAudit).toEqual([
      {
        event: "reserve",
        reservationId: "platform-text:request-provider-retry:attempt-failed",
        amountMicros: 500_000,
      },
      {
        event: "release",
        reservationId: "platform-text:request-provider-retry:attempt-failed",
        amountMicros: 500_000,
      },
      {
        event: "reserve",
        reservationId: "platform-text:request-provider-retry:attempt-retry",
        amountMicros: 500_000,
      },
      {
        event: "settle",
        reservationId: "platform-text:request-provider-retry:attempt-retry",
        amountMicros: 400_000,
      },
    ]);
  });
});

function platformInput(requestId: string) {
  return {
    accountId: "account-a",
    text: "继续当前问题",
    context: [{
      id: `${requestId}:user`,
      role: "user" as const,
      text: "继续当前问题",
      requestId,
    }],
  };
}

function signal() {
  return new AbortController().signal;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
