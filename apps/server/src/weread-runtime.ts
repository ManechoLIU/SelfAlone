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
import { createHash } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { parseModelEncryptionKey } from "./model-config-runtime";
import { WeReadAdapterError, WeReadSyncPausedError, type WeReadAdapter } from "./weread-adapter";
import { WeReadConnectionStore } from "./weread-connection-store";
import { createWeReadGatewayAdapter } from "./weread-gateway-adapter";
import { WeReadRouteError, type WeReadRouteRuntime } from "./weread-routes";
import { WeReadSyncStore } from "./weread-sync-store";

const DEFAULT_STALE_THRESHOLD_MS = 60_000;

export type CreateWeReadRuntimeOptions = {
  databaseUrl: string;
  encryptionKey?: string | Buffer;
  adapter?: WeReadAdapter;
  autoStart?: boolean;
  staleThresholdMs?: number;
  now?: () => Date;
  /** Test-only deterministic barrier after an empty claim and before release. */
  onIdleBeforeDrainRelease?: () => void | Promise<void>;
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
  readonly #onIdleBeforeDrainRelease?: () => void | Promise<void>;
  #autoDrain: boolean;
  #closed = false;
  #drain: Promise<void> | null = null;
  #wakeRequested = false;

  constructor(options: {
    sql: Sql;
    encryptionKey: Buffer;
    adapter: WeReadAdapter;
    staleThresholdMs: number;
    now?: () => Date;
    autoDrain: boolean;
    onIdleBeforeDrainRelease?: () => void | Promise<void>;
  }) {
    this.#sql = options.sql;
    this.#connections = new WeReadConnectionStore(options.sql, { encryptionKey: options.encryptionKey });
    this.#sync = new WeReadSyncStore(options.sql, { now: options.now });
    this.#adapter = options.adapter;
    this.#now = options.now ?? (() => new Date());
    this.#staleThresholdMs = options.staleThresholdMs;
    this.#onIdleBeforeDrainRelease = options.onIdleBeforeDrainRelease;
    this.#autoDrain = options.autoDrain;
  }

  async ready() {
    if (this.#closed) return false;
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
      const connection = await this.#connections.replace(accountId, {
        apiKey: input.apiKey,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        accountExternalId: account.externalId,
      });
      const run = await this.#sync.enqueueBooks(accountId, {
        requestId: initialBooksRequestId(input.requestId),
        cursor: null,
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
    return this.#route(() => this.#sync.getBooksSnapshot(accountId, input));
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
    return this.#route(() => this.#sync.getAnnotationsSnapshot(accountId, input));
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#drain?.catch(() => undefined);
    await this.#sql.end({ timeout: 2 });
  }

  async #drainUntilEmpty() {
    while (!this.#closed) {
      const claimed = await this.#drainOne();
      if (!claimed) return true;
    }
    return false;
  }

  async #drainOne(): Promise<boolean> {
    const claimed = await this.#sync.claimNext();
    if (!claimed) return false;
    try {
      if (claimed.run.operation === "books") {
        const page = await this.#adapter.syncBooks(claimed.run.connectionId, claimed.run.cursor ?? undefined);
        await this.#sync.completeBooks(claimed.accountId, claimed.run.runId, page);
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
        } catch (error) {
          if (!(error instanceof WeReadSyncPausedError)) throw error;
          if (error.kind !== "annotations") throw error;
          await this.#sync.completeAnnotations(claimed.accountId, claimed.run.runId, {
            status: "paused",
            snapshot: "last_success",
            connectionId: claimed.run.connectionId,
            accountExternalId: claimed.run.accountExternalId,
            bookExternalId: claimed.run.bookExternalId,
            annotations: error.snapshot as readonly WeReadAnnotation[],
            pause: error.pause,
          });
        }
      }
    } catch (error) {
      try {
        await this.#sync.fail(claimed.accountId, claimed.run.runId, toProviderApiError(error));
      } catch {
        // The worker owns no caller promise. A safe terminal failure is best-effort;
        // never let a provider or store exception become an unhandled rejection.
      }
    }
    return true;
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
    if (this.#drain) {
      this.#wakeRequested = true;
      await this.#drain;
      return;
    }
    const drain = (async () => {
      if (recover) {
        const staleBefore = new Date(this.#now().getTime() - this.#staleThresholdMs);
        await this.#sync.recoverInterrupted(staleBefore);
      }
      do {
        this.#wakeRequested = false;
        const idle = await this.#drainUntilEmpty();
        if (idle && !this.#closed && !this.#wakeRequested) {
          await this.#onIdleBeforeDrainRelease?.();
        }
      } while (!this.#closed && this.#wakeRequested);
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
  const sql = postgres(options.databaseUrl, { max: 4 });
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

function initialBooksRequestId(requestId: string) {
  return `connection-books:${createHash("sha256").update(requestId).digest("hex")}`;
}
