import type {
  WeReadAnnotation,
  WeReadAnnotationsSnapshotRequest,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncRequest,
  WeReadAnnotationsSyncResponse,
  WeReadApiError,
  WeReadBooksSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadBooksSyncRunProjection,
  WeReadBooksSyncRequest,
  WeReadBooksSyncResponse,
  WeReadConnectionDeleteRequest,
  WeReadConnectionDeleteResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionPutRequest,
  WeReadConnectionPutResponse,
  WeReadAnnotationsSyncRunProjection,
  WeReadSyncStatusResponse,
} from "@selfalone/contracts";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { parseModelEncryptionKey } from "./model-config-runtime";
import { WeReadAdapterError, WeReadSyncPausedError, type WeReadAdapter } from "./weread-adapter";
import { WeReadConnectionStore } from "./weread-connection-store";
import { createWeReadGatewayAdapter } from "./weread-gateway-adapter";
import { WeReadRouteError, type WeReadRouteRuntime } from "./weread-routes";
import { WeReadSyncStore } from "./weread-sync-store";

const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const DEFAULT_RECOVERY_DELAY_MS = 250;
const DEFAULT_MAX_RECOVERY_DELAY_MS = 5_000;

type RecoveryScheduler = (task: () => Promise<void>, delayMs: number) => unknown;

export type CreateWeReadRuntimeOptions = {
  databaseUrl: string;
  encryptionKey?: string | Buffer;
  adapter?: WeReadAdapter;
  autoStart?: boolean;
  staleThresholdMs?: number;
  now?: () => Date;
  /** Test-only deterministic barrier after an empty claim and before release. */
  onIdleBeforeDrainRelease?: () => void | Promise<void>;
  /** Test-only barrier after snapshot fencing acquired its connection lock. */
  onSnapshotFenceLocked?: () => void | Promise<void>;
  /** Test-only failure seams for persisted-worker recovery. */
  beforeInitialBooksEnqueue?: () => void | Promise<void>;
  beforeWorkerStoreWrite?: () => void | Promise<void>;
  afterWorkerStoreWrite?: () => void | Promise<void>;
  beforeWorkerFailureWrite?: () => void | Promise<void>;
  recoveryDelayMs?: number;
  maxRecoveryDelayMs?: number;
  scheduleRecovery?: RecoveryScheduler;
  clearRecovery?: (handle: unknown) => void;
  /** Test-only pool size override for bounded connection-regression coverage. */
  sqlMax?: number;
};

/**
 * The sole production composition point for persisted WeRead connections,
 * route methods, and the single-consumer sync worker.
 */
export class WeReadRuntime implements WeReadRouteRuntime {
  readonly #sql: Sql;
  readonly #connections: WeReadConnectionStore;
  readonly #sync: WeReadSyncStore;
  readonly #adapter: WeReadAdapter;
  readonly #now: () => Date;
  readonly #staleThresholdMs: number;
  readonly #encryptionKey: Buffer;
  readonly #onIdleBeforeDrainRelease?: () => void | Promise<void>;
  readonly #onSnapshotFenceLocked?: () => void | Promise<void>;
  readonly #beforeInitialBooksEnqueue?: () => void | Promise<void>;
  readonly #beforeWorkerStoreWrite?: () => void | Promise<void>;
  readonly #afterWorkerStoreWrite?: () => void | Promise<void>;
  readonly #beforeWorkerFailureWrite?: () => void | Promise<void>;
  readonly #recoveryDelayMs: number;
  readonly #maxRecoveryDelayMs: number;
  readonly #scheduleRecoveryTask: RecoveryScheduler;
  readonly #clearRecovery: (handle: unknown) => void;
  #autoDrain: boolean;
  #closed = false;
  #drain: Promise<void> | null = null;
  #wakeRequested = false;
  #recoverRequested = false;
  #recoveryTimer: unknown | null = null;
  #recoveryAttempt = 0;
  #workerUnhealthy = false;
  #unhealthyRun: { accountId: string; runId: string } | null = null;

  constructor(options: {
    sql: Sql;
    encryptionKey: Buffer;
    adapter: WeReadAdapter;
    staleThresholdMs: number;
    now?: () => Date;
    autoDrain: boolean;
    onIdleBeforeDrainRelease?: () => void | Promise<void>;
    onSnapshotFenceLocked?: () => void | Promise<void>;
    beforeInitialBooksEnqueue?: () => void | Promise<void>;
    beforeWorkerStoreWrite?: () => void | Promise<void>;
    afterWorkerStoreWrite?: () => void | Promise<void>;
    beforeWorkerFailureWrite?: () => void | Promise<void>;
    recoveryDelayMs: number;
    maxRecoveryDelayMs: number;
    scheduleRecovery: RecoveryScheduler;
    clearRecovery: (handle: unknown) => void;
  }) {
    this.#sql = options.sql;
    this.#connections = new WeReadConnectionStore(options.sql, { encryptionKey: options.encryptionKey });
    this.#sync = new WeReadSyncStore(options.sql, { now: options.now });
    this.#adapter = options.adapter;
    this.#now = options.now ?? (() => new Date());
    this.#staleThresholdMs = options.staleThresholdMs;
    this.#encryptionKey = Buffer.from(options.encryptionKey);
    this.#onIdleBeforeDrainRelease = options.onIdleBeforeDrainRelease;
    this.#onSnapshotFenceLocked = options.onSnapshotFenceLocked;
    this.#beforeInitialBooksEnqueue = options.beforeInitialBooksEnqueue;
    this.#beforeWorkerStoreWrite = options.beforeWorkerStoreWrite;
    this.#afterWorkerStoreWrite = options.afterWorkerStoreWrite;
    this.#beforeWorkerFailureWrite = options.beforeWorkerFailureWrite;
    this.#recoveryDelayMs = options.recoveryDelayMs;
    this.#maxRecoveryDelayMs = options.maxRecoveryDelayMs;
    this.#scheduleRecoveryTask = options.scheduleRecovery;
    this.#clearRecovery = options.clearRecovery;
    this.#autoDrain = options.autoDrain;
  }

  async ready() {
    if (this.#closed || this.#workerUnhealthy) return false;
    try {
      const [result] = await this.#sql<Array<{ ready: number }>>`SELECT 1 AS ready`;
      return result?.ready === 1;
    } catch {
      return false;
    }
  }

  async start() {
    this.#assertOpen();
    this.#autoDrain = true;
    this.#recoverRequested = true;
    await this.#launchDrain(true);
  }

  async drainOnce() {
    this.#assertOpen();
    if (this.#drain) {
      await this.#drain;
      return;
    }
    const drain = this.#drainOne().then(() => undefined);
    this.#drain = drain;
    try {
      await drain;
    } finally {
      if (this.#drain === drain) this.#drain = null;
    }
  }

  async getConnection(accountId: string): Promise<WeReadConnectionGetResponse> {
    return this.#route(() => this.#connections.getCurrent(accountId).then((connection) => ({ connection })));
  }

  async putConnection(
    accountId: string,
    input: WeReadConnectionPutRequest,
  ): Promise<WeReadConnectionPutResponse> {
    return this.#route(async () => {
      const account = await this.#adapter.validate(input.apiKey);
      const { connection, run } = await this.#sql.begin(async (transaction) => {
        return replaceConnectionAndEnqueue(transaction, {
          accountId,
          apiKey: input.apiKey,
          requestId: input.requestId,
          expectedRevision: input.expectedRevision,
          accountExternalId: account.externalId,
          encryptionKey: this.#encryptionKey,
          now: this.#now(),
          beforeInitialBooksEnqueue: this.#beforeInitialBooksEnqueue,
        });
      });
      this.#scheduleDrain();
      return { connection, sync: { run: run as WeReadBooksSyncRunProjection } };
    });
  }

  async deleteConnection(
    accountId: string,
    input: WeReadConnectionDeleteRequest,
  ): Promise<WeReadConnectionDeleteResponse> {
    return this.#route(() => this.#connections.disconnect(accountId, input));
  }

  async syncBooks(accountId: string, input: WeReadBooksSyncRequest): Promise<WeReadBooksSyncResponse> {
    return this.#route(async () => {
      const run = await this.#sync.enqueueBooks(accountId, input);
      this.#scheduleDrain();
      return { run: run as WeReadBooksSyncRunProjection };
    });
  }

  async getBooksSnapshot(
    accountId: string,
    input: WeReadBooksSnapshotRequest,
  ): Promise<WeReadBooksSnapshotResponse> {
    return this.#route(() => this.#withCurrentConnectionFence(
      accountId,
      (transaction) => this.#sync.getBooksSnapshot(accountId, input, transaction),
    ));
  }

  async getSyncStatus(accountId: string, runId: string): Promise<WeReadSyncStatusResponse> {
    return this.#route(() => this.#sync.getRun(accountId, runId).then((run) => ({ run })));
  }

  async syncAnnotations(
    accountId: string,
    input: WeReadAnnotationsSyncRequest,
  ): Promise<WeReadAnnotationsSyncResponse> {
    return this.#route(async () => {
      const run = await this.#sync.enqueueAnnotations(accountId, input);
      this.#scheduleDrain();
      return { run: run as WeReadAnnotationsSyncRunProjection };
    });
  }

  async getAnnotationsSnapshot(
    accountId: string,
    input: WeReadAnnotationsSnapshotRequest,
  ): Promise<WeReadAnnotationsSnapshotResponse> {
    return this.#route(() => this.#withCurrentConnectionFence(
      accountId,
      (transaction) => this.#sync.getAnnotationsSnapshot(accountId, input, transaction),
    ));
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#recoveryTimer !== null) this.#clearRecovery(this.#recoveryTimer);
    this.#recoveryTimer = null;
    this.#unhealthyRun = null;
    await this.#drain?.catch(() => undefined);
    await this.#sql.end({ timeout: 2 });
    this.#encryptionKey.fill(0);
  }

  async #drainUntilEmpty() {
    while (!this.#closed) {
      const claimed = await this.#drainOne();
      if (!claimed) return true;
    }
    return false;
  }

  async #drainOne(): Promise<boolean> {
    let claimed;
    try {
      claimed = await this.#sync.claimNext();
    } catch {
      this.#markWorkerUnhealthy();
      return false;
    }
    if (!claimed) return false;
    try {
      if (claimed.run.operation === "books") {
        const page = await this.#adapter.syncBooks(claimed.run.connectionId, claimed.run.cursor ?? undefined);
        await this.#beforeWorkerStoreWrite?.();
        await this.#sync.completeBooks(claimed.accountId, claimed.run.runId, page);
        await this.#afterWorkerStoreWrite?.();
      } else {
        try {
          const annotations = await this.#adapter.syncAnnotations(
            claimed.run.connectionId,
            claimed.run.bookExternalId,
          );
          await this.#sync.completeAnnotations(claimed.accountId, claimed.run.runId, {
            status: "success",
            snapshot: "fresh",
            connectionId: claimed.run.connectionId,
            accountExternalId: claimed.run.accountExternalId,
            bookExternalId: claimed.run.bookExternalId,
            annotations,
          });
          await this.#afterWorkerStoreWrite?.();
        } catch (error) {
          if (!(error instanceof WeReadSyncPausedError)) throw error;
          if (error.kind !== "annotations") throw error;
          await this.#beforeWorkerStoreWrite?.();
          await this.#sync.completeAnnotations(claimed.accountId, claimed.run.runId, {
            status: "paused",
            snapshot: "last_success",
            connectionId: claimed.run.connectionId,
            accountExternalId: claimed.run.accountExternalId,
            bookExternalId: claimed.run.bookExternalId,
            annotations: error.snapshot as readonly WeReadAnnotation[],
            pause: error.pause,
          });
          await this.#afterWorkerStoreWrite?.();
        }
      }
    } catch (error) {
      try {
        await this.#beforeWorkerFailureWrite?.();
        await this.#sync.fail(claimed.accountId, claimed.run.runId, toProviderApiError(error));
      } catch {
        // The worker owns no caller promise. A safe terminal failure is best-effort;
        // never let a provider or store exception become an unhandled rejection.
        this.#markWorkerUnhealthy({ accountId: claimed.accountId, runId: claimed.run.runId });
        return false;
      }
    }
    if (
      this.#unhealthyRun?.accountId === claimed.accountId
      && this.#unhealthyRun.runId === claimed.run.runId
    ) {
      this.#clearWorkerHealth();
    }
    return true;
  }

  async #withCurrentConnectionFence<T extends { connectionId: string }>(
    accountId: string,
    readSnapshot: (transaction: TransactionSql) => Promise<T>,
  ): Promise<T> {
    return await this.#sql.begin(async (transaction) => {
      const [account] = await transaction<Array<{ id: string }>>`
        SELECT id FROM accounts WHERE id = ${accountId} FOR SHARE
      `;
      if (!account) throw new Error("ACCOUNT_REQUIRED");
      const [connection] = await transaction<Array<{ connectionId: string }>>`
        SELECT connection_id AS "connectionId"
        FROM weread_connections
        WHERE account_id = ${accountId} AND status IN ('verified', 'paused')
      `;
      if (!connection) throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
      await this.#onSnapshotFenceLocked?.();
      const snapshot = await readSnapshot(transaction);
      if (snapshot.connectionId !== connection.connectionId) {
        throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
      }
      return snapshot;
    }) as T;
  }

  #markWorkerUnhealthy(run?: { accountId: string; runId: string }) {
    this.#workerUnhealthy = true;
    if (run) this.#unhealthyRun = run;
    this.#rearmRecovery();
  }

  #clearWorkerHealth() {
    if (this.#recoveryTimer !== null) this.#clearRecovery(this.#recoveryTimer);
    this.#recoveryTimer = null;
    this.#workerUnhealthy = false;
    this.#unhealthyRun = null;
    this.#recoveryAttempt = 0;
  }

  #rearmRecovery() {
    if (this.#closed || this.#recoveryTimer !== null) return;
    const delay = Math.min(
      this.#maxRecoveryDelayMs,
      this.#recoveryDelayMs * (2 ** Math.min(this.#recoveryAttempt, 16)),
    );
    this.#recoveryAttempt += 1;
    this.#recoveryTimer = this.#scheduleRecoveryTask(async () => {
      this.#recoveryTimer = null;
      this.#recoverRequested = true;
      try {
        await this.start();
      } catch {
        this.#rearmRecovery();
      }
    }, delay);
  }

  #scheduleDrain() {
    if (this.#closed || !this.#autoDrain) return;
    if (this.#drain) {
      this.#wakeRequested = true;
      return;
    }
    void this.#launchDrain(false).catch(() => undefined);
  }

  async #launchDrain(recover: boolean) {
    if (recover) this.#recoverRequested = true;
    if (this.#drain) {
      this.#wakeRequested = true;
      await this.#drain;
      return;
    }
    const drain = (async () => {
      do {
        if (this.#recoverRequested) {
          this.#recoverRequested = false;
          try {
            const staleBefore = new Date(this.#now().getTime() - this.#staleThresholdMs);
            await this.#sync.recoverInterrupted(staleBefore);
            if (this.#workerUnhealthy) {
              const unhealthyRun = this.#unhealthyRun;
              if (!unhealthyRun) {
                this.#clearWorkerHealth();
              } else {
                const run = await this.#sync.getRun(unhealthyRun.accountId, unhealthyRun.runId);
                if (run.status === "completed" || run.status === "paused" || run.status === "failed") {
                  this.#clearWorkerHealth();
                } else if (run.status === "running") {
                  this.#rearmRecovery();
                  return;
                }
              }
            }
          } catch {
            this.#markWorkerUnhealthy();
            return;
          }
        }
        this.#wakeRequested = false;
        const idle = await this.#drainUntilEmpty();
        if (idle && !this.#closed && !this.#wakeRequested) {
          await this.#onIdleBeforeDrainRelease?.();
        }
      } while (!this.#closed && (this.#wakeRequested || this.#recoverRequested));
    })();
    this.#drain = drain;
    try {
      await drain;
    } finally {
      if (this.#drain !== drain) return;
      this.#drain = null;
      const wakeRequested = this.#wakeRequested;
      this.#wakeRequested = false;
      if (wakeRequested && !this.#closed) void this.#launchDrain(false).catch(() => undefined);
    }
  }

  async #route<T>(task: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    try {
      return await task();
    } catch (error) {
      if (error instanceof WeReadRouteError) throw error;
      throw new WeReadRouteError(toApiError(error));
    }
  }

  #assertOpen() {
    if (this.#closed) throw new WeReadRouteError(internalError());
  }
}

export async function createWeReadRuntime(options: CreateWeReadRuntimeOptions): Promise<WeReadRuntime> {
  const encryptionKey = parseModelEncryptionKey(options.encryptionKey, "production");
  const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0) {
    throw new Error("WEREAD_STALE_THRESHOLD_INVALID");
  }
  const recoveryDelayMs = options.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;
  if (!Number.isFinite(recoveryDelayMs) || recoveryDelayMs < 1) {
    throw new Error("WEREAD_RECOVERY_DELAY_INVALID");
  }
  const maxRecoveryDelayMs = options.maxRecoveryDelayMs ?? DEFAULT_MAX_RECOVERY_DELAY_MS;
  if (!Number.isFinite(maxRecoveryDelayMs) || maxRecoveryDelayMs < recoveryDelayMs) {
    throw new Error("WEREAD_MAX_RECOVERY_DELAY_INVALID");
  }
  const sqlMax = options.sqlMax ?? 4;
  if (!Number.isSafeInteger(sqlMax) || sqlMax < 1) throw new Error("WEREAD_SQL_POOL_INVALID");
  const sql = postgres(options.databaseUrl, { max: sqlMax });
  try {
    const connections = new WeReadConnectionStore(sql, { encryptionKey });
    const runtime = new WeReadRuntime({
      sql,
      encryptionKey,
      adapter: options.adapter ?? createWeReadGatewayAdapter({
        resolveConnection: connections.resolveConnection.bind(connections),
      }),
      staleThresholdMs,
      now: options.now,
      autoDrain: options.autoStart ?? true,
      onIdleBeforeDrainRelease: options.onIdleBeforeDrainRelease,
      onSnapshotFenceLocked: options.onSnapshotFenceLocked,
      beforeInitialBooksEnqueue: options.beforeInitialBooksEnqueue,
      beforeWorkerStoreWrite: options.beforeWorkerStoreWrite,
      afterWorkerStoreWrite: options.afterWorkerStoreWrite,
      beforeWorkerFailureWrite: options.beforeWorkerFailureWrite,
      recoveryDelayMs,
      maxRecoveryDelayMs,
      scheduleRecovery: options.scheduleRecovery ?? ((task, delayMs) => setTimeout(() => { void task(); }, delayMs)),
      clearRecovery: options.clearRecovery ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    });
    if (options.autoStart ?? true) await runtime.start();
    return runtime;
  } catch (error) {
    await sql.end({ timeout: 2 });
    throw error;
  } finally {
    encryptionKey.fill(0);
  }
}

function toApiError(error: unknown): WeReadApiError {
  if (error instanceof WeReadAdapterError) {
    if (
      error.code === "WEREAD_INVALID_API_KEY"
      || error.code === "WEREAD_CONNECTION_NOT_FOUND"
      || error.code === "WEREAD_CONNECTION_REVOKED"
      || error.code === "WEREAD_CONNECTION_FORBIDDEN"
    ) {
      return { code: "EXTERNAL_AUTH_REQUIRED", message: "微信读书连接需要重新验证", retryable: false };
    }
    return {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: error.retryable,
    };
  }
  if (error instanceof Error) {
    if (error.message === "STALE_VERSION") {
      return { code: "STALE_VERSION", message: "连接状态已变化，请刷新后重试", retryable: false };
    }
    if (error.message === "CONFLICT") {
      return { code: "CONFLICT", message: "请求与当前状态冲突", retryable: false };
    }
    if (error.message === "WEREAD_RUN_NOT_FOUND" || error.message === "WEREAD_SNAPSHOT_NOT_FOUND") {
      return { code: "VALIDATION_FAILED", message: "未找到对应的微信读书数据", retryable: false };
    }
  }
  return internalError();
}

function toProviderApiError(error: unknown): WeReadApiError {
  const mapped = toApiError(error);
  if (mapped.code !== "INTERNAL_ERROR") return mapped;
  return { code: "EXTERNAL_SERVICE_FAILED", message: "微信读书暂时不可用", retryable: true };
}

function internalError(): WeReadApiError {
  return { code: "INTERNAL_ERROR", message: "微信读书服务暂不可用", retryable: false };
}

type StoredConnectionRow = {
  connectionId: string;
  accountExternalId: string;
  keyHint: string | null;
  status: "verified" | "paused" | "disconnected";
  verifiedAt: Date | null;
  revision: string | number;
  lastRequestId: string;
  lastRequestFingerprint: string;
};

type StoredBooksRunRow = {
  runId: string;
  requestId: string;
  connectionId: string;
  accountExternalId: string;
  status: "queued" | "running" | "completed" | "paused" | "failed";
  snapshot: "none" | "fresh" | "last_success";
  cursor: string | null;
  nextCursor: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  pause: unknown;
  error: unknown;
};

async function replaceConnectionAndEnqueue(
  transaction: TransactionSql,
  input: {
    accountId: string;
    apiKey: string;
    requestId: string;
    expectedRevision: string | null;
    accountExternalId: string;
    encryptionKey: Buffer;
    now: Date;
    beforeInitialBooksEnqueue?: () => void | Promise<void>;
  },
): Promise<{ connection: import("@selfalone/contracts").WeReadConnectionProjection; run: WeReadBooksSyncRunProjection }> {
  const accountId = requiredText(input.accountId, "ACCOUNT_REQUIRED");
  const apiKey = requiredApiKey(input.apiKey);
  const requestId = requiredText(input.requestId, "WEREAD_REQUEST_REQUIRED");
  const accountExternalId = requiredText(input.accountExternalId, "WEREAD_ACCOUNT_EXTERNAL_ID_REQUIRED");
  const expectedRevision = input.expectedRevision === null
    ? null
    : requiredText(input.expectedRevision, "STALE_VERSION");
  const now = validNow(input.now);
  const [account] = await transaction<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE
  `;
  if (!account) throw new Error("ACCOUNT_REQUIRED");
  const [current] = await transaction<StoredConnectionRow[]>`
    SELECT connection_id AS "connectionId", account_external_id AS "accountExternalId",
      key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision,
      last_request_id AS "lastRequestId", last_request_fingerprint AS "lastRequestFingerprint"
    FROM weread_connections WHERE account_id = ${accountId} FOR UPDATE
  `;
  const replacementFingerprint = fingerprint([
    accountId,
    apiKey,
    accountExternalId,
    expectedRevision,
  ]);
  let connection: import("@selfalone/contracts").WeReadConnectionProjection;
  let encrypted: { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } | undefined;
  try {
    if (current?.lastRequestId === requestId) {
      if (current.lastRequestFingerprint !== replacementFingerprint || current.status === "disconnected") {
        throw new Error("CONFLICT");
      }
      connection = toConnectionProjection(current);
    } else {
      const visibleRevision = current && current.status !== "disconnected" ? String(current.revision) : null;
      if (visibleRevision !== expectedRevision) throw new Error("STALE_VERSION");
      const connectionId = randomUUID();
      encrypted = encryptConnection(apiKey, input.encryptionKey, accountId);
      const nextRevision = current ? BigInt(current.revision) + 1n : 1n;
      const [stored] = await transaction<StoredConnectionRow[]>`
        INSERT INTO weread_connections (
          account_id, connection_id, account_external_id,
          ciphertext, nonce, auth_tag, key_version, key_hint,
          status, verified_at, revision, last_request_id,
          last_request_fingerprint, created_at, updated_at
        ) VALUES (
          ${accountId}, ${connectionId}, ${accountExternalId},
          ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.authTag}, 'v1', ${maskApiKey(apiKey)},
          'verified', ${now}, ${nextRevision.toString()}, ${requestId}, ${replacementFingerprint}, ${now}, ${now}
        )
        ON CONFLICT (account_id) DO UPDATE
        SET connection_id = EXCLUDED.connection_id,
            account_external_id = EXCLUDED.account_external_id,
            ciphertext = EXCLUDED.ciphertext,
            nonce = EXCLUDED.nonce,
            auth_tag = EXCLUDED.auth_tag,
            key_version = EXCLUDED.key_version,
            key_hint = EXCLUDED.key_hint,
            status = EXCLUDED.status,
            verified_at = EXCLUDED.verified_at,
            revision = EXCLUDED.revision,
            last_request_id = EXCLUDED.last_request_id,
            last_request_fingerprint = EXCLUDED.last_request_fingerprint,
            updated_at = EXCLUDED.updated_at
        RETURNING connection_id AS "connectionId", account_external_id AS "accountExternalId",
          key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision,
          last_request_id AS "lastRequestId", last_request_fingerprint AS "lastRequestFingerprint"
      `;
      if (!stored) throw new Error("WEREAD_CONNECTION_NOT_FOUND");
      connection = toConnectionProjection(stored);
    }
    await input.beforeInitialBooksEnqueue?.();
    const internalRequestId = initialBooksRequestId(connection.connectionId, requestId);
    const requestFingerprint = fingerprint(["books", null]);
    const [existing] = await transaction<StoredBooksRunRow[]>`
      SELECT run_id AS "runId", request_id AS "requestId", connection_id AS "connectionId",
        account_external_id AS "accountExternalId", status, snapshot, cursor,
        next_cursor AS "nextCursor", retry_count AS "retryCount",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", pause, error
      FROM weread_sync_runs
      WHERE account_id = ${accountId} AND request_id = ${internalRequestId}
      FOR UPDATE
    `;
    if (existing) {
      const [storedFingerprint] = await transaction<Array<{ requestFingerprint: string }>>`
        SELECT request_fingerprint AS "requestFingerprint"
        FROM weread_sync_runs WHERE account_id = ${accountId} AND request_id = ${internalRequestId}
      `;
      if (storedFingerprint?.requestFingerprint !== requestFingerprint) throw new Error("CONFLICT");
      return { connection, run: toBooksRunProjection(existing) };
    }
    const [storedRun] = await transaction<StoredBooksRunRow[]>`
      INSERT INTO weread_sync_runs (
        run_id, account_id, request_id, request_fingerprint, operation,
        connection_id, account_external_id, book_id, book_external_id,
        cursor, next_cursor, status, snapshot, retry_count, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${accountId}, ${internalRequestId}, ${requestFingerprint}, 'books',
        ${connection.connectionId}, ${connection.accountExternalId}, NULL, NULL,
        NULL, NULL, 'queued', 'none', 0, ${now}, ${now}
      )
      RETURNING run_id AS "runId", request_id AS "requestId", connection_id AS "connectionId",
        account_external_id AS "accountExternalId", status, snapshot, cursor,
        next_cursor AS "nextCursor", retry_count AS "retryCount",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", pause, error
    `;
    if (!storedRun) throw new Error("WEREAD_RUN_NOT_FOUND");
    return { connection, run: toBooksRunProjection(storedRun) };
  } finally {
    encrypted?.ciphertext.fill(0);
    encrypted?.nonce.fill(0);
    encrypted?.authTag.fill(0);
  }
}

function initialBooksRequestId(connectionId: string, requestId: string) {
  return `connection-books:${fingerprint([connectionId, requestId])}`;
}

function toConnectionProjection(row: StoredConnectionRow) {
  if ((row.status !== "verified" && row.status !== "paused") || !row.keyHint || !row.verifiedAt) {
    throw new Error("WEREAD_CONNECTION_NOT_FOUND");
  }
  return {
    connectionId: row.connectionId,
    accountExternalId: row.accountExternalId,
    apiKeyHint: row.keyHint,
    status: row.status,
    verifiedAt: row.verifiedAt.toISOString(),
    revision: String(row.revision),
  };
}

function toBooksRunProjection(row: StoredBooksRunRow): WeReadBooksSyncRunProjection {
  const base = {
    runId: row.runId,
    requestId: row.requestId,
    operation: "books" as const,
    connectionId: row.connectionId,
    accountExternalId: row.accountExternalId,
    status: row.status,
    snapshot: row.snapshot,
    cursor: row.cursor,
    nextCursor: row.nextCursor,
    retryCount: row.retryCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.status === "paused" ? { pause: row.pause } : {}),
    ...(row.status === "failed" ? { error: row.error } : {}),
  };
  return base as WeReadBooksSyncRunProjection;
}

function encryptConnection(apiKey: string, key: Buffer, accountId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${accountId}:v1`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function requiredText(value: string, code: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) throw new Error(code);
  return value.trim();
}

function requiredApiKey(value: string) {
  const apiKey = requiredText(value, "WEREAD_INVALID_API_KEY");
  if (!/^wrk-\S+$/.test(apiKey) || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
  }
  return apiKey;
}

function validNow(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("WEREAD_CLOCK_INVALID");
  return value;
}

function maskApiKey(apiKey: string) {
  return `••••${apiKey.slice(-4)}`;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
