import { createHash } from "node:crypto";
import type {
  WeReadAdapter,
  WeReadAccount,
  WeReadAnnotation,
  WeReadBook,
  WeReadCursor,
  WeReadSyncPage,
  WeReadSyncPause,
} from "./weread-adapter";
import { WeReadAdapterError, WeReadSyncPausedError } from "./weread-adapter";

export const WEREAD_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway" as const;
export const WEREAD_SKILL_VERSION = "1.0.4" as const;

/** Central allowlist: only the official api_name values required by WeReadAdapter. */
export const WEREAD_GATEWAY_API_NAMES = Object.freeze({
  validate: "/shelf/sync",
  syncBooks: "/shelf/sync",
  syncAnnotations: "/book/bookmarklist",
} as const);

export type WeReadGatewayApiName =
  (typeof WEREAD_GATEWAY_API_NAMES)[keyof typeof WEREAD_GATEWAY_API_NAMES];

const ALLOWED_API_NAMES = new Set<string>(Object.values(WEREAD_GATEWAY_API_NAMES));
const AUTH_ERRCODES = new Set([-2010, -2012, 401, 403]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

export type WeReadGatewayConnectionContext = {
  apiKey: string;
  accountExternalId: string;
  lastSuccessfulBooks?: readonly WeReadBook[];
  lastSuccessfulAnnotations?: readonly WeReadAnnotation[];
};

export type WeReadGatewayAdapterOptions = {
  fetcher?: typeof fetch;
  skillVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  resolveConnection?: (
    connectionId: string,
  ) =>
    | WeReadGatewayConnectionContext
    | null
    | undefined
    | Promise<WeReadGatewayConnectionContext | null | undefined>;
};

type GatewaySuccess = {
  kind: "success";
  payload: Record<string, unknown>;
};

type GatewayPause = {
  kind: "paused";
  pause: WeReadSyncPause;
};

/**
 * Production-shaped Tencent WeRead Agent Gateway adapter. Credentials are
 * supplied at call time, never logged, and never returned. Tests inject fetch
 * and must not contact the live provider.
 */
export function createWeReadGatewayAdapter(
  options: WeReadGatewayAdapterOptions = {},
): WeReadAdapter {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const skillVersion = (options.skillVersion ?? WEREAD_SKILL_VERSION).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  if (typeof fetcher !== "function" || !skillVersion || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: false });
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: false });
  }

  const tails = new Map<string, Promise<unknown>>();

  const enqueue = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    tails.set(key, current);
    return current;
  };

  const request = (
    apiKey: string,
    apiName: WeReadGatewayApiName,
    params: Record<string, unknown> = {},
  ): Promise<GatewaySuccess | GatewayPause> => {
    const credential = assertApiKey(apiKey);
    assertAllowlisted(apiName);
    return enqueue(`key:${digestApiKey(credential)}`, () =>
      callGateway({
        fetcher,
        skillVersion,
        timeoutMs,
        maxRetries,
        sleep,
        apiKey: credential,
        apiName,
        params,
      }),
    );
  };

  return {
    async validate(apiKey: string): Promise<WeReadAccount> {
      const credential = assertApiKey(apiKey);
      const result = await request(credential, WEREAD_GATEWAY_API_NAMES.validate);
      if (result.kind === "paused") {
        throw new WeReadAdapterError("WEREAD_SYNC_PAUSED", {
          retryable: true,
          errcode: result.pause.errcode,
          upgradeInfo: result.pause.upgradeInfo,
        });
      }
      return readAccount(result.payload, credential);
    },

    async syncBooks(connectionId: string, cursor?: WeReadCursor): Promise<WeReadSyncPage> {
      const connection = await requireConnection(options.resolveConnection, connectionId);
      const requestedCursor = cursor ?? null;
      if (requestedCursor !== null) {
        throw new WeReadAdapterError("WEREAD_CURSOR_INVALID");
      }
      const result = await request(connection.apiKey, WEREAD_GATEWAY_API_NAMES.syncBooks);
      if (result.kind === "paused") {
        return {
          status: "paused",
          snapshot: "last_success",
          connectionId,
          accountExternalId: connection.accountExternalId,
          cursor: requestedCursor,
          nextCursor: null,
          books: cloneBooks(connection.lastSuccessfulBooks ?? []),
          pause: result.pause,
        };
      }
      return {
        status: "success",
        snapshot: "fresh",
        connectionId,
        accountExternalId: connection.accountExternalId,
        cursor: requestedCursor,
        nextCursor: null,
        books: readBooks(result.payload),
      };
    },

    async syncAnnotations(connectionId: string, bookExternalId: string): Promise<WeReadAnnotation[]> {
      if (typeof bookExternalId !== "string" || !bookExternalId.trim()) {
        throw new WeReadAdapterError("WEREAD_BOOK_NOT_FOUND");
      }
      const connection = await requireConnection(options.resolveConnection, connectionId);
      const result = await request(connection.apiKey, WEREAD_GATEWAY_API_NAMES.syncAnnotations, {
        bookId: bookExternalId.trim(),
      });
      if (result.kind === "paused") {
        throw new WeReadSyncPausedError({
          kind: "annotations",
          pause: result.pause,
          snapshot: cloneAnnotations(connection.lastSuccessfulAnnotations ?? []),
        });
      }
      return readAnnotations(result.payload, bookExternalId.trim());
    },
  };
}

function assertAllowlisted(apiName: string): asserts apiName is WeReadGatewayApiName {
  if (!ALLOWED_API_NAMES.has(apiName)) {
    throw new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: false });
  }
}

function assertApiKey(apiKey: string): string {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
  }
  const normalized = apiKey.trim();
  if (!/^wrk-\S+$/.test(normalized)) {
    throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
  }
  return normalized;
}

async function requireConnection(
  resolveConnection: WeReadGatewayAdapterOptions["resolveConnection"],
  connectionId: string,
): Promise<WeReadGatewayConnectionContext> {
  if (typeof connectionId !== "string" || !connectionId.trim()) {
    throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
  }
  if (!resolveConnection) {
    throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
  }
  const connection = await resolveConnection(connectionId.trim());
  if (!connection || typeof connection.apiKey !== "string" || typeof connection.accountExternalId !== "string") {
    throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
  }
  if (!connection.accountExternalId.trim()) {
    throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
  }
  assertApiKey(connection.apiKey);
  return connection;
}

async function callGateway(input: {
  fetcher: typeof fetch;
  skillVersion: string;
  timeoutMs: number;
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
  apiKey: string;
  apiName: WeReadGatewayApiName;
  params: Record<string, unknown>;
}): Promise<GatewaySuccess | GatewayPause> {
  let lastError: WeReadAdapterError | undefined;
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    if (attempt > 0) await input.sleep(200 * 2 ** (attempt - 1));
    try {
      const outcome = await callGatewayOnce(input);
      if (outcome.kind === "retry") {
        lastError = outcome.error;
        continue;
      }
      return outcome;
    } catch (error) {
      const mapped = mapThrownProviderError(error);
      if (!mapped.retryable || attempt === input.maxRetries) throw mapped;
      lastError = mapped;
    }
  }
  throw lastError ?? new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: true });
}

async function callGatewayOnce(input: {
  fetcher: typeof fetch;
  skillVersion: string;
  timeoutMs: number;
  apiKey: string;
  apiName: WeReadGatewayApiName;
  params: Record<string, unknown>;
}): Promise<GatewaySuccess | GatewayPause | { kind: "retry"; error: WeReadAdapterError }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetcher(WEREAD_GATEWAY_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_name: input.apiName,
        skill_version: input.skillVersion,
        ...input.params,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw mapThrownProviderError(error);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await readJsonObject(response);
  const upgradeInfo = readUpgradeInfo(payload);
  const errcode = readErrcode(payload, response.status);
  if (upgradeInfo !== undefined) {
    return {
      kind: "paused",
      pause: {
        reason: "upgrade_required",
        errcode,
        upgradeInfo,
      },
    };
  }
  if (isAuthFailure(response.status, errcode)) {
    throw new WeReadAdapterError("WEREAD_INVALID_API_KEY", { retryable: false, errcode });
  }
  if (!response.ok || errcode !== 0) {
    const error = new WeReadAdapterError("WEREAD_PROVIDER_ERROR", {
      retryable: isRetryableStatus(response.status) || isRetryableErrcode(errcode),
      errcode,
    });
    if (error.retryable) return { kind: "retry", error };
    throw error;
  }
  return { kind: "success", payload };
}

function mapThrownProviderError(error: unknown): WeReadAdapterError {
  if (error instanceof WeReadAdapterError) return error;
  return new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: true });
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: false });
  }
  if (!isRecord(value)) {
    throw new WeReadAdapterError("WEREAD_PROVIDER_ERROR", { retryable: false });
  }
  return value;
}

function readUpgradeInfo(payload: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, "upgrade_info")
    && !Object.prototype.hasOwnProperty.call(payload, "upgradeInfo")) {
    return undefined;
  }
  const raw = payload.upgrade_info ?? payload.upgradeInfo;
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (isRecord(raw) && typeof raw.message === "string") return raw.message;
  return "";
}

function readErrcode(payload: Record<string, unknown>, httpStatus: number): number {
  if (typeof payload.errcode === "number" && Number.isFinite(payload.errcode)) return payload.errcode;
  if (typeof payload.errCode === "number" && Number.isFinite(payload.errCode)) return payload.errCode;
  return httpStatus >= 200 && httpStatus < 300 ? 0 : httpStatus;
}

function isAuthFailure(httpStatus: number, errcode: number): boolean {
  return httpStatus === 401 || httpStatus === 403 || AUTH_ERRCODES.has(errcode);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableErrcode(errcode: number): boolean {
  return errcode === 408 || errcode === 425 || errcode === 429 || errcode >= 500;
}

function readAccount(payload: Record<string, unknown>, apiKey: string): WeReadAccount {
  const user = isRecord(payload.user) ? payload.user : undefined;
  const externalId = readOpaqueId(payload.userVid)
    ?? readOpaqueId(payload.vid)
    ?? readOpaqueId(user?.userVid)
    ?? readOpaqueId(user?.vid)
    ?? digestApiKey(apiKey);
  return {
    externalId,
    displayName: readDisplayName(payload, user),
  };
}

function readDisplayName(
  payload: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): string | null {
  const candidates = [payload.name, payload.nickname, payload.userName, user?.name, user?.nickname];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function readBooks(payload: Record<string, unknown>): WeReadBook[] {
  if (payload.books == null) return [];
  if (!Array.isArray(payload.books)) {
    throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  }
  return payload.books.map(readBook);
}

function readBook(value: unknown): WeReadBook {
  if (!isRecord(value)) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  const externalId = readOpaqueId(value.bookId);
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!externalId || !title) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  const author = value.author == null ? null : typeof value.author === "string" ? value.author : null;
  const coverUrl = typeof value.cover === "string"
    ? value.cover
    : typeof value.coverUrl === "string" ? value.coverUrl : null;
  return {
    externalId,
    title,
    author,
    coverUrl,
    progressPercent: readProgress(value),
    lastReadAt: readTimestamp(value.readUpdateTime ?? value.lastReadAt),
  };
}

function readProgress(value: Record<string, unknown>): number | null {
  const progress = value.progress ?? value.readingProgress ?? value.progressPercent;
  if (typeof progress === "number" && Number.isSafeInteger(progress) && progress >= 0 && progress <= 100) {
    return progress;
  }
  return null;
}

function readAnnotations(payload: Record<string, unknown>, bookExternalId: string): WeReadAnnotation[] {
  if (payload.updated == null) return [];
  if (!Array.isArray(payload.updated)) {
    throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  }
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const titles = new Map<string, string>();
  for (const chapter of chapters) {
    if (!isRecord(chapter)) continue;
    const chapterUid = readOpaqueId(chapter.chapterUid);
    if (chapterUid && typeof chapter.title === "string" && chapter.title.trim()) {
      titles.set(chapterUid, chapter.title);
    }
  }
  return payload.updated.map((item) => readAnnotation(item, bookExternalId, titles));
}

function readAnnotation(
  value: unknown,
  fallbackBookExternalId: string,
  titles: Map<string, string>,
): WeReadAnnotation {
  if (!isRecord(value)) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  const externalId = readOpaqueId(value.bookmarkId);
  const bookExternalId = readOpaqueId(value.bookId) ?? fallbackBookExternalId;
  const quote = typeof value.markText === "string" ? value.markText.trim() : "";
  if (!externalId || !bookExternalId || !quote) {
    throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  }
  const createdAt = readTimestamp(value.createTime);
  if (!createdAt) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  const chapterUid = readOpaqueId(value.chapterUid);
  const location = chapterUid ? titles.get(chapterUid) ?? null : null;
  return {
    externalId,
    bookExternalId,
    quote,
    thought: null,
    location,
    createdAt,
    updatedAt: createdAt,
  };
}

function cloneBooks(books: readonly WeReadBook[]): WeReadBook[] {
  return books.map((book) => ({ ...book }));
}

function cloneAnnotations(annotations: readonly WeReadAnnotation[]): WeReadAnnotation[] {
  return annotations.map((annotation) => ({ ...annotation }));
}

function readOpaqueId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return undefined;
}

function readTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1_000;
    const date = new Date(millis);
    if (!Number.isFinite(date.getTime())) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
    return date.toISOString();
  }
  if (typeof value === "string" && /T.*Z$/i.test(value.trim())) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
    return date.toISOString();
  }
  return null;
}

function digestApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
