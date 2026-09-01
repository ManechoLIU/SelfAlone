import { randomUUID } from "node:crypto";
import type { WeReadAdapter, WeReadAccount, WeReadBook, WeReadSyncPage } from "@selfalone/contracts";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { migrateWeReadConnectionSchema } from "./weread-connection-migration";
import { migrateWeReadSyncSchema } from "./weread-sync-migration";
import { WeReadSyncPausedError } from "./weread-adapter";
import { createWeReadRuntime, type WeReadRuntime } from "./weread-runtime";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
const resources: Array<{
  admin: Sql;
  databaseUrl: string;
  runtime: WeReadRuntime;
  schema: string;
  sql: Sql;
}> = [];

const BOOK_A: WeReadBook = {
  externalId: "book-a",
  title: "甲书",
  author: "甲作者",
  coverUrl: null,
  progressPercent: 25,
  lastReadAt: "2026-09-01T08:00:00.000Z",
};

describe("WeRead route runtime", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(resources.splice(0).map(async ({ admin, runtime, schema, sql }) => {
      await runtime.close();
      await sql.end();
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }));
  });

  it("combines the HTTP connection and books APIs with persisted, account-isolated snapshots", async () => {
    const adapter = runtimeAdapter();
    const harness = await setup(adapter);
    const app = createApp({ readiness: () => harness.runtime.ready(), weread: harness.runtime });
    apps.push(app);

    const first = await connect(app, "account-a", "wrk-account-a-secret", "connect-a");
    const second = await connect(app, "account-b", "wrk-account-b-secret", "connect-b");
    adapter.bind(first.json<{ connection: { connectionId: string } }>().connection.connectionId, "weread-account-a");
    adapter.bind(second.json<{ connection: { connectionId: string } }>().connection.connectionId, "weread-account-b");
    expect(first.statusCode).toBe(200);
    expect(first.body).not.toContain("wrk-account-a-secret");
    expect(first.json().connection).toMatchObject({ accountExternalId: "weread-account-a" });
    expect(first.json().sync.run).toMatchObject({ status: "queued", operation: "books" });
    expect(second.body).not.toContain("wrk-account-b-secret");

    const replayedConnection = await connect(app, "account-a", "wrk-account-a-secret", "connect-a");
    const explicitBooks = await app.inject({
      method: "POST",
      url: "/api/v1/weread/sync/books",
      headers: { "x-selfalone-account": "account-a" },
      payload: { requestId: "connect-a" },
    });
    expect(replayedConnection.json()).toEqual(first.json());
    expect(explicitBooks.statusCode).toBe(202);
    const [sameRequestRuns] = await harness.sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM weread_sync_runs WHERE account_id = 'account-a'
    `;
    expect(sameRequestRuns).toEqual({ count: 2 });

    await harness.runtime.drainOnce();
    await harness.runtime.drainOnce();
    await harness.runtime.drainOnce();
    const run = await app.inject({
      method: "GET",
      url: `/api/v1/weread/sync/${first.json<{ sync: { run: { runId: string } } }>().sync.run.runId}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/v1/weread/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    const otherSnapshot = await app.inject({
      method: "GET",
      url: "/api/v1/weread/books",
      headers: { "x-selfalone-account": "account-b" },
    });
    const crossAccountRun = await app.inject({
      method: "GET",
      url: `/api/v1/weread/sync/${first.json<{ sync: { run: { runId: string } } }>().sync.run.runId}`,
      headers: { "x-selfalone-account": "account-b" },
    });

    expect(run.json()).toMatchObject({ run: { status: "completed", snapshot: "fresh" } });
    expect(snapshot.json()).toMatchObject({
      status: "success",
      books: [expect.objectContaining({ externalId: "book-a", title: "甲书" })],
    });
    expect(otherSnapshot.json()).toMatchObject({
      status: "success",
      books: [expect.objectContaining({ externalId: "book-b", title: "乙书" })],
    });
    expect(crossAccountRun.statusCode).toBe(422);
    expect(JSON.stringify({ run: run.json(), snapshot: snapshot.json() })).not.toContain("wrk-");
  });

  it("recovers one stale running run after restart without duplicate terminal replay", async () => {
    const adapter = runtimeAdapter();
    const harness = await setup(adapter);
    const app = createApp({ readiness: () => harness.runtime.ready(), weread: harness.runtime });
    apps.push(app);
    const connected = await connect(app, "account-a", "wrk-account-a-secret", "restart-connect");
    adapter.bind(connected.json<{ connection: { connectionId: string } }>().connection.connectionId, "weread-account-a");
    const runId = connected.json<{ sync: { run: { runId: string } } }>().sync.run.runId;

    await harness.sql`
      UPDATE weread_sync_runs
      SET status = 'running', updated_at = ${new Date("2026-09-01T00:00:00.000Z")}
      WHERE run_id = ${runId}
    `;
    await harness.runtime.close();
    const recovered = await createWeReadRuntime({
      databaseUrl: harness.databaseUrl,
      encryptionKey: Buffer.alloc(32, 9),
      adapter,
      autoStart: false,
      staleThresholdMs: 1,
    });
    resources[0]!.runtime = recovered;
    await recovered.start();
    const completed = await recovered.getSyncStatus("account-a", runId);
    await recovered.start();
    expect(completed).toMatchObject({ run: { status: "completed", retryCount: 1 } });
    const [row] = await harness.sql<Array<{ status: string; count: number }>>`
      SELECT status, count(*)::int AS count FROM weread_sync_runs WHERE run_id = ${runId} GROUP BY status
    `;
    expect(row).toEqual({ status: "completed", count: 1 });
  });

  it("maps provider errors and pauses to safe persisted results without credential reflection", async () => {
    const adapter: WeReadAdapter = {
      async validate(apiKey) {
        if (apiKey === "wrk-provider-secret") return { externalId: "weread-safe", displayName: null };
        throw new Error("unexpected credential");
      },
      async syncBooks() {
        throw new Error("provider said wrk-provider-secret is invalid");
      },
      async syncAnnotations() { return []; },
    };
    const harness = await setup(adapter);
    const app = createApp({ readiness: () => harness.runtime.ready(), weread: harness.runtime });
    apps.push(app);
    const connected = await connect(app, "account-a", "wrk-provider-secret", "safe-connect");
    await harness.runtime.drainOnce();
    const runId = connected.json<{ sync: { run: { runId: string } } }>().sync.run.runId;
    const status = await app.inject({
      method: "GET",
      url: `/api/v1/weread/sync/${runId}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/v1/weread/books",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(status.json()).toMatchObject({ run: { status: "failed", error: {
      code: "EXTERNAL_SERVICE_FAILED", message: "微信读书暂时不可用", retryable: true,
    } } });
    expect(snapshot.json()).toMatchObject({ status: "failed", error: { code: "EXTERNAL_SERVICE_FAILED" } });
    expect(`${status.body}${snapshot.body}`).not.toContain("wrk-provider-secret");
  });

  it("persists an annotations upgrade pause without exposing the connection credential", async () => {
    const adapter: WeReadAdapter = {
      async validate() { return { externalId: "weread-pause", displayName: null }; },
      async syncBooks(connectionId) {
        return {
          status: "success", snapshot: "fresh", connectionId, accountExternalId: "weread-pause",
          cursor: null, nextCursor: null, books: [BOOK_A],
        };
      },
      async syncAnnotations() {
        throw new WeReadSyncPausedError({
          kind: "annotations",
          pause: { reason: "upgrade_required", errcode: 426, upgradeInfo: "upgrade-required" },
          snapshot: [],
        });
      },
    };
    const harness = await setup(adapter);
    const app = createApp({ readiness: () => harness.runtime.ready(), weread: harness.runtime });
    apps.push(app);
    await connect(app, "account-a", "wrk-pause-secret", "pause-connect");
    await harness.runtime.drainOnce();
    const books = await app.inject({
      method: "GET", url: "/api/v1/weread/books", headers: { "x-selfalone-account": "account-a" },
    });
    const bookId = books.json<{ books: Array<{ bookId: string }> }>().books[0]!.bookId;
    const queued = await app.inject({
      method: "POST",
      url: "/api/v1/weread/sync/annotations",
      headers: { "x-selfalone-account": "account-a" },
      payload: { requestId: "pause-annotations", bookId },
    });
    await harness.runtime.drainOnce();
    const paused = await app.inject({
      method: "GET",
      url: `/api/v1/weread/sync/${queued.json<{ run: { runId: string } }>().run.runId}`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(paused.json()).toMatchObject({ run: {
      status: "paused", snapshot: "last_success", pause: { reason: "upgrade_required", errcode: 426 },
    } });
    expect(paused.body).not.toContain("wrk-pause-secret");
  });

  it("wakes a queued run enqueued after the worker observes an empty queue but before release", async () => {
    const idle = deferred<void>();
    const releaseIdle = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const adapter: WeReadAdapter = {
      async validate() { return { externalId: "weread-concurrent", displayName: null }; },
      async syncBooks(connectionId) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return {
            status: "success", snapshot: "fresh", connectionId, accountExternalId: "weread-concurrent",
            cursor: null, nextCursor: null, books: [],
          };
        } finally {
          active -= 1;
        }
      },
      async syncAnnotations() { return []; },
    };
    const harness = await setup(adapter, false, async () => {
      idle.resolve();
      await releaseIdle.promise;
    });
    const app = createApp({ readiness: () => harness.runtime.ready(), weread: harness.runtime });
    apps.push(app);
    const start = harness.runtime.start();
    await idle.promise;
    const queued = await connect(app, "account-b", "wrk-second-secret", "concurrent-b");
    releaseIdle.resolve();
    await start;
    const queuedRun = await app.inject({
      method: "GET",
      url: `/api/v1/weread/sync/${queued.json<{ sync: { run: { runId: string } } }>().sync.run.runId}`,
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(queuedRun.json()).toMatchObject({ run: { status: "completed" } });
    expect(maximumActive).toBe(1);
  }, 2_000);
});

async function setup(
  adapter: WeReadAdapter,
  autoStart = false,
  onIdleBeforeDrainRelease?: () => void | Promise<void>,
) {
  const schema = `weread_runtime_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(baseDatabaseUrl, { max: 1 });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 2 });
  await sql`CREATE TABLE accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await migrateWeReadConnectionSchema(sql);
  await migrateWeReadSyncSchema(sql);
  const runtime = await createWeReadRuntime({
    databaseUrl: databaseUrl.toString(),
    encryptionKey: Buffer.alloc(32, 9),
    adapter,
    autoStart,
    staleThresholdMs: 60_000,
    onIdleBeforeDrainRelease,
  });
  const resource = { admin, databaseUrl: databaseUrl.toString(), runtime, schema, sql };
  resources.push(resource);
  return resource;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function connect(
  app: ReturnType<typeof createApp>,
  accountId: string,
  apiKey: string,
  requestId: string,
) {
  return app.inject({
    method: "PUT",
    url: "/api/v1/weread/connection",
    headers: { "x-selfalone-account": accountId },
    payload: { apiKey, requestId, expectedRevision: null },
  });
}

function runtimeAdapter(): WeReadAdapter & { bind(connectionId: string, accountExternalId: string): void } {
  const accountsByConnection = new Map<string, string>();
  return {
    bind(connectionId, accountExternalId) {
      accountsByConnection.set(connectionId, accountExternalId);
    },
    async validate(apiKey): Promise<WeReadAccount> {
      if (apiKey === "wrk-account-a-secret") return { externalId: "weread-account-a", displayName: "甲" };
      if (apiKey === "wrk-account-b-secret") return { externalId: "weread-account-b", displayName: "乙" };
      throw new Error("invalid fixture");
    },
    async syncBooks(connectionId): Promise<WeReadSyncPage> {
      const accountExternalId = accountsByConnection.get(connectionId);
      if (!accountExternalId) throw new Error("unbound test connection");
      const book = accountExternalId === "weread-account-b"
        ? { ...BOOK_A, externalId: "book-b", title: "乙书" }
        : BOOK_A;
      return {
        status: "success",
        snapshot: "fresh",
        connectionId,
        accountExternalId,
        cursor: null,
        nextCursor: null,
        books: [book],
      };
    },
    async syncAnnotations() { return []; },
  };
}
