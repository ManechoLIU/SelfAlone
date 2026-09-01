import { randomUUID } from "node:crypto";
import type {
  WeReadAnnotationsSyncResult,
  WeReadApiError,
  WeReadSyncPage,
} from "@selfalone/contracts";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateWeReadConnectionSchema } from "./weread-connection-migration";
import { WeReadConnectionStore } from "./weread-connection-store";
import { migrateWeReadSyncSchema } from "./weread-sync-migration";
import { WeReadSyncStore } from "./weread-sync-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("WeRead persisted sync store", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map(async ({ administration, schema, sql }) => {
      await sql.end();
      await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await administration.end();
    }));
  });

  it("replays one books request and preserves the last complete snapshot on failure or pause", async () => {
    const setup = await isolatedDatabase(databases, "weread_books_sync");
    await migrateWeReadSyncSchema(setup.sql);
    const clock = mutableClock("2026-09-01T12:00:00.000Z");
    let runSequence = 0;
    let bookSequence = 0;
    const store = new WeReadSyncStore(setup.sql, {
      now: clock.now,
      runIdFactory: () => `run-${++runSequence}`,
      bookIdFactory: () => `local-book-${++bookSequence}`,
    });

    const first = await store.enqueueBooks("account-a", {
      requestId: "request-books-1",
      cursor: null,
    });
    expect(first).toMatchObject({
      runId: "run-1",
      requestId: "request-books-1",
      operation: "books",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      status: "queued",
      snapshot: "none",
      cursor: null,
      nextCursor: null,
      retryCount: 0,
    });
    await expect(store.enqueueBooks("account-a", {
      requestId: "request-books-1",
      cursor: null,
    })).resolves.toEqual(first);
    expect(runSequence).toBe(1);
    await expect(store.enqueueBooks("account-a", {
      requestId: "request-books-1",
      cursor: "opaque/conflict",
    })).rejects.toThrow("CONFLICT");
    await expect(store.enqueueBooks("account-b", {
      requestId: "request-books-1",
      cursor: null,
    })).resolves.toMatchObject({ runId: "run-2", connectionId: "connection-b" });

    await expect(store.start("account-a", first.runId)).resolves.toMatchObject({
      status: "running",
    });
    const page: WeReadSyncPage = {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [
        {
          externalId: "external-book-a",
          title: "甲书",
          author: "甲作者",
          coverUrl: null,
          progressPercent: 25,
          lastReadAt: "2026-08-31T09:00:00.000Z",
        },
        {
          externalId: "external-book-b",
          title: "乙书",
          author: null,
          coverUrl: "https://example.invalid/book-b.png",
          progressPercent: null,
          lastReadAt: null,
        },
      ],
    };
    const completed = await store.completeBooks("account-a", first.runId, page);
    expect(completed).toMatchObject({ status: "completed", snapshot: "fresh" });
    await expect(store.completeBooks("account-a", first.runId, page)).resolves.toEqual(completed);
    await expect(store.completeBooks("account-a", first.runId, {
      ...page,
      books: [{ ...page.books[0]!, title: "冲突标题" }],
    })).rejects.toThrow("CONFLICT");
    await expect(store.getBooksSnapshot("account-a", { cursor: null })).resolves.toEqual({
      status: "success",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [
        { ...page.books[0], bookId: "local-book-1" },
        { ...page.books[1], bookId: "local-book-2" },
      ],
    });

    clock.set("2026-09-01T12:01:00.000Z");
    const failedRun = await store.enqueueBooks("account-a", {
      requestId: "request-books-2",
      cursor: null,
    });
    await store.start("account-a", failedRun.runId);
    const providerFailure: WeReadApiError = {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    };
    await store.fail("account-a", failedRun.runId, providerFailure);
    await expect(store.getBooksSnapshot("account-a", { cursor: null })).resolves.toMatchObject({
      status: "failed",
      snapshot: "last_success",
      books: [{ bookId: "local-book-1", title: "甲书" }, { bookId: "local-book-2" }],
      error: providerFailure,
    });

    clock.set("2026-09-01T12:02:00.000Z");
    const pausedRun = await store.enqueueBooks("account-a", {
      requestId: "request-books-3",
      cursor: null,
    });
    await store.start("account-a", pausedRun.runId);
    await store.completeBooks("account-a", pausedRun.runId, {
      status: "paused",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [],
      pause: { reason: "upgrade_required", errcode: 426, upgradeInfo: "upgrade skill" },
    });
    await expect(store.getBooksSnapshot("account-a", { cursor: null })).resolves.toMatchObject({
      status: "paused",
      snapshot: "last_success",
      books: [{ bookId: "local-book-1", title: "甲书" }, { bookId: "local-book-2" }],
      pause: { reason: "upgrade_required", errcode: 426, upgradeInfo: "upgrade skill" },
    });
    await expect(store.getRun("account-b", first.runId)).rejects.toThrow("WEREAD_RUN_NOT_FOUND");
  });

  it("persists annotation snapshots and recovers an interrupted run without cross-account access", async () => {
    const setup = await isolatedDatabase(databases, "weread_annotation_sync");
    const clock = mutableClock("2026-09-01T13:00:00.000Z");
    let runSequence = 0;
    const store = new WeReadSyncStore(setup.sql, {
      now: clock.now,
      runIdFactory: () => `annotation-run-${++runSequence}`,
      bookIdFactory: () => "local-book-a",
    });
    const booksRun = await store.enqueueBooks("account-a", {
      requestId: "request-seed-books",
      cursor: null,
    });
    await store.start("account-a", booksRun.runId);
    await store.completeBooks("account-a", booksRun.runId, {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [{
        externalId: "external-book-a",
        title: "甲书",
        author: null,
        coverUrl: null,
        progressPercent: null,
        lastReadAt: null,
      }],
    });

    const annotationsRun = await store.enqueueAnnotations("account-a", {
      requestId: "request-annotations-1",
      bookId: "local-book-a",
    });
    expect(annotationsRun).toMatchObject({
      operation: "annotations",
      status: "queued",
      bookId: "local-book-a",
      bookExternalId: "external-book-a",
    });
    await store.start("account-a", annotationsRun.runId);
    const annotations: WeReadAnnotationsSyncResult = {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      bookExternalId: "external-book-a",
      annotations: [{
        externalId: "annotation-a",
        bookExternalId: "external-book-a",
        quote: "重要的一句",
        thought: "我的想法",
        location: null,
        createdAt: "2026-08-31T10:00:00.000Z",
        updatedAt: "2026-08-31T10:01:00.000Z",
      }],
    };
    await store.completeAnnotations("account-a", annotationsRun.runId, annotations);
    await expect(store.getAnnotationsSnapshot("account-a", {
      bookId: "local-book-a",
    })).resolves.toEqual({
      status: "success",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      bookId: "local-book-a",
      bookExternalId: "external-book-a",
      annotations: annotations.annotations,
    });
    clock.set("2026-09-01T13:00:30.000Z");
    const failedAnnotations = await store.enqueueAnnotations("account-a", {
      requestId: "request-annotations-failed",
      bookId: "local-book-a",
    });
    await store.start("account-a", failedAnnotations.runId);
    await store.fail("account-a", failedAnnotations.runId, {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    });
    await expect(store.getAnnotationsSnapshot("account-a", {
      bookId: "local-book-a",
    })).resolves.toMatchObject({
      status: "failed",
      snapshot: "last_success",
      annotations: annotations.annotations,
      error: { code: "EXTERNAL_SERVICE_FAILED", retryable: true },
    });
    await expect(store.enqueueAnnotations("account-b", {
      requestId: "request-cross-account",
      bookId: "local-book-a",
    })).rejects.toThrow("WEREAD_BOOK_NOT_FOUND");

    clock.set("2026-09-01T13:01:00.000Z");
    const interrupted = await store.enqueueAnnotations("account-a", {
      requestId: "request-annotations-recovery",
      bookId: "local-book-a",
    });
    await store.start("account-a", interrupted.runId);
    clock.set("2026-09-01T13:03:00.000Z");
    await expect(store.recoverInterrupted(new Date("2026-09-01T13:02:00.000Z"))).resolves.toBe(1);
    await expect(store.getRun("account-a", interrupted.runId)).resolves.toMatchObject({
      status: "queued",
      retryCount: 1,
    });
    const claims = await Promise.all([store.claimNext(), store.claimNext()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({
      accountId: "account-a",
      run: { runId: interrupted.runId, status: "running", retryCount: 1 },
    });
  });

  it("rejects a late result after the account replaces its connection", async () => {
    const setup = await isolatedDatabase(databases, "weread_stale_connection");
    const store = new WeReadSyncStore(setup.sql, {
      now: () => new Date("2026-09-01T14:00:00.000Z"),
      runIdFactory: () => "stale-run",
      bookIdFactory: () => "stale-book",
    });
    const run = await store.enqueueBooks("account-a", {
      requestId: "request-before-replace",
      cursor: null,
    });
    await store.start("account-a", run.runId);
    const connections = new WeReadConnectionStore(setup.sql, {
      encryptionKey: Buffer.alloc(32, 11),
      now: () => new Date("2026-09-01T14:01:00.000Z"),
      connectionIdFactory: () => "connection-replaced",
    });
    await connections.replace("account-a", {
      apiKey: "wrk-account-a-replaced",
      requestId: "replace-account-a",
      expectedRevision: "1",
      accountExternalId: "weread-account-a-replaced",
    });

    await expect(store.completeBooks("account-a", run.runId, {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [],
    })).rejects.toThrow("STALE_VERSION");
    await expect(store.getBooksSnapshot("account-a", { cursor: null })).rejects.toThrow(
      "WEREAD_SNAPSHOT_NOT_FOUND",
    );
  });

  it("does not label a replaced connection snapshot with the previous connection's visible books", async () => {
    const setup = await isolatedDatabase(databases, "weread_cross_connection_snapshot");
    let runSequence = 0;
    let bookSequence = 0;
    const store = new WeReadSyncStore(setup.sql, {
      now: () => new Date("2026-09-01T16:00:00.000Z"),
      runIdFactory: () => `cross-run-${++runSequence}`,
      bookIdFactory: () => `cross-book-${++bookSequence}`,
    });
    const first = await store.enqueueBooks("account-a", {
      requestId: "request-books-connection-a",
      cursor: null,
    });
    await store.start("account-a", first.runId);
    await store.completeBooks("account-a", first.runId, {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: null,
      books: [{
        externalId: "external-book-a",
        title: "甲书",
        author: "甲作者",
        coverUrl: null,
        progressPercent: 25,
        lastReadAt: "2026-08-31T09:00:00.000Z",
      }],
    });

    const connections = new WeReadConnectionStore(setup.sql, {
      encryptionKey: Buffer.alloc(32, 11),
      now: () => new Date("2026-09-01T16:01:00.000Z"),
      connectionIdFactory: () => "connection-replaced",
    });
    await connections.replace("account-a", {
      apiKey: "wrk-account-a-replaced",
      requestId: "replace-account-a-cross",
      expectedRevision: "1",
      accountExternalId: "weread-account-a-replaced",
    });

    const failedRun = await store.enqueueBooks("account-a", {
      requestId: "request-books-connection-b",
      cursor: null,
    });
    await store.start("account-a", failedRun.runId);
    const providerFailure: WeReadApiError = {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    };
    await store.fail("account-a", failedRun.runId, providerFailure);

    await expect(store.getBooksSnapshot("account-a", { cursor: null })).resolves.toEqual({
      status: "failed",
      snapshot: "last_success",
      connectionId: "connection-replaced",
      accountExternalId: "weread-account-a-replaced",
      cursor: null,
      nextCursor: null,
      books: [],
      error: providerFailure,
    });
  });

  it("replays a terminal failure when semantic error fields match regardless of object key order", async () => {
    const setup = await isolatedDatabase(databases, "weread_fail_fingerprint");
    const store = new WeReadSyncStore(setup.sql, {
      now: () => new Date("2026-09-01T17:00:00.000Z"),
      runIdFactory: () => "fail-order-run",
      bookIdFactory: () => "unused-book",
    });
    const run = await store.enqueueBooks("account-a", {
      requestId: "request-fail-order",
      cursor: null,
    });
    await store.start("account-a", run.runId);
    const first = await store.fail("account-a", run.runId, {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    });
    await expect(store.fail("account-a", run.runId, {
      retryable: true,
      message: "微信读书暂时不可用",
      code: "EXTERNAL_SERVICE_FAILED",
    })).resolves.toEqual(first);
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
  await migrateWeReadConnectionSchema(sql);
  await migrateWeReadSyncSchema(sql);
  const connections = new WeReadConnectionStore(sql, {
    encryptionKey: Buffer.alloc(32, 11),
    now: () => new Date("2026-09-01T11:00:00.000Z"),
    connectionIdFactory: (() => {
      let sequence = 0;
      return () => `connection-${String.fromCharCode(97 + sequence++)}`;
    })(),
  });
  await connections.replace("account-a", {
    apiKey: "wrk-account-a-secret",
    requestId: "connect-account-a",
    expectedRevision: null,
    accountExternalId: "weread-account-a",
  });
  await connections.replace("account-b", {
    apiKey: "wrk-account-b-secret",
    requestId: "connect-account-b",
    expectedRevision: null,
    accountExternalId: "weread-account-b",
  });
  return { sql };
}

function mutableClock(initial: string) {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    set: (value: string) => {
      current = new Date(value);
    },
  };
}
