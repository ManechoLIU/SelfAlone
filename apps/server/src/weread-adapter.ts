import { createHash } from "node:crypto";
import type {
  WeReadAdapter,
  WeReadAccount,
  WeReadAnnotation,
  WeReadAnnotationsSyncResult,
  WeReadBook,
  WeReadConnection,
  WeReadCursor,
  WeReadProviderErrorPayload,
  WeReadSyncPage,
  WeReadSyncPause,
} from "@selfalone/contracts";

export type {
  WeReadAdapter,
  WeReadAccount,
  WeReadAnnotation,
  WeReadAnnotationsSyncResult,
  WeReadBook,
  WeReadConnection,
  WeReadCursor,
  WeReadSyncPage,
  WeReadSyncPause,
} from "@selfalone/contracts";

export type FakeWeReadGatewayFailure = WeReadProviderErrorPayload & {
  /** Camel-case input is accepted for test fixtures; provider payloads use snake case. */
  upgradeInfo?: string | null;
};

export type FakeWeReadBookPage = {
  /** `null` is the only initial cursor; every other value is opaque. */
  cursor: WeReadCursor | null;
  books: readonly WeReadBook[];
  nextCursor: WeReadCursor | null;
  failure?: FakeWeReadGatewayFailure;
};

export type FakeWeReadDataset = {
  account: WeReadAccount;
  /** Raw key is accepted only while constructing the fake and is immediately digested. */
  apiKey?: string;
  /** Tests that already have a fixture digest can avoid passing a raw key. */
  apiKeyDigest?: string;
  /** Optional explicit hint; the fake never returns or stores the raw key. */
  apiKeyHint?: string;
  books?: readonly WeReadBook[];
  annotations?: readonly WeReadAnnotation[];
  bookPages?: readonly FakeWeReadBookPage[];
  /** Alias useful for fixture builders; both names have identical semantics. */
  pages?: readonly FakeWeReadBookPage[];
  pageSize?: number;
  lastSuccessfulBooks?: readonly WeReadBook[];
  lastSuccessfulAnnotations?: Readonly<Record<string, readonly WeReadAnnotation[]>>;
  annotationFailure?: FakeWeReadGatewayFailure;
  annotationFailures?: Readonly<Record<string, FakeWeReadGatewayFailure>>;
};

export type FakeWeReadAdapterOptions = {
  datasets?: readonly FakeWeReadDataset[];
  /** Alias retained for callers that describe provider accounts rather than datasets. */
  accounts?: readonly FakeWeReadDataset[];
  pageSize?: number;
  now?: () => string | number | Date;
};

export type WeReadAdapterErrorCode =
  | "WEREAD_INVALID_API_KEY"
  | "WEREAD_CONNECTION_NOT_FOUND"
  | "WEREAD_CONNECTION_REVOKED"
  | "WEREAD_CONNECTION_FORBIDDEN"
  | "WEREAD_CURSOR_INVALID"
  | "WEREAD_BOOK_NOT_FOUND"
  | "WEREAD_PROVIDER_ERROR"
  | "WEREAD_SYNC_PAUSED"
  | "WEREAD_INVALID_RECORD";

export class WeReadAdapterError extends Error {
  constructor(
    readonly code: WeReadAdapterErrorCode,
    details?: {
      retryable?: boolean;
      errcode?: number;
      upgradeInfo?: string;
    },
  ) {
    super(code);
    this.name = "WeReadAdapterError";
    this.retryable = details?.retryable ?? isRetryable(code);
    this.errcode = details?.errcode;
    this.upgradeInfo = details?.upgradeInfo;
  }

  readonly retryable: boolean;
  readonly errcode?: number;
  readonly upgradeInfo?: string;
}

export type WeReadSyncPausedErrorInput = {
  kind: "books" | "annotations";
  pause: WeReadSyncPause;
  snapshot: readonly WeReadBook[] | readonly WeReadAnnotation[];
};

/** Array-returning TECHNICAL.md port methods throw this typed pause result. */
export class WeReadSyncPausedError extends WeReadAdapterError {
  readonly kind: WeReadSyncPausedErrorInput["kind"];
  readonly pause: WeReadSyncPause;
  readonly snapshot: readonly WeReadBook[] | readonly WeReadAnnotation[];

  constructor(input: WeReadSyncPausedErrorInput) {
    super("WEREAD_SYNC_PAUSED", {
      retryable: true,
      errcode: input.pause.errcode,
      upgradeInfo: input.pause.upgradeInfo,
    });
    this.name = "WeReadSyncPausedError";
    this.kind = input.kind;
    this.pause = input.pause;
    this.snapshot = input.snapshot;
  }
}

export type FakeWeReadCall =
  | { operation: "validate"; accountId?: undefined }
  | { operation: "syncBooks"; connectionId: string; cursor: WeReadCursor | null }
  | { operation: "syncAnnotations"; connectionId: string; bookExternalId: string };

type InternalDataset = {
  account: WeReadAccount;
  credentialDigest: string;
  apiKeyHint: string;
  books: readonly WeReadBook[];
  annotations: readonly WeReadAnnotation[];
  bookPages: readonly FakeWeReadBookPage[];
  lastSuccessfulBooks: readonly WeReadBook[];
  lastSuccessfulAnnotations: Map<string, readonly WeReadAnnotation[]>;
  annotationFailure?: FakeWeReadGatewayFailure;
  annotationFailures: Readonly<Record<string, FakeWeReadGatewayFailure>>;
};

type BookSyncRun = {
  expectedCursor: WeReadCursor | null;
  records: WeReadBook[];
};

type InternalConnection = {
  projection: WeReadConnection;
  dataset: InternalDataset;
  lastSuccessfulBooks: WeReadBook[];
  lastSuccessfulAnnotations: Map<string, WeReadAnnotation[]>;
  bookSyncRun?: BookSyncRun;
  pause?: WeReadSyncPause;
};

/**
 * Deterministic local-only WeRead adapter.  It models the port and provider
 * failure boundary without HTTP, credentials persistence, database access, or
 * a real WeRead account.  Fixture keys are hashed at construction time and
 * are never present in a projection, call log, or adapter error.
 */
export class FakeWeReadAdapter implements WeReadAdapter {
  readonly calls: FakeWeReadCall[] = [];

  readonly #datasets: readonly InternalDataset[];
  readonly #connections = new Map<string, InternalConnection>();
  readonly #currentByAccount = new Map<string, string>();
  readonly #now: () => string;
  #connectionSequence = 0;

  constructor(options: FakeWeReadAdapterOptions) {
    const fixtureDatasets = options.datasets ?? options.accounts ?? [];
    if (options.datasets && options.accounts) {
      throw new Error("WEREAD_DUPLICATE_DATASET_INPUT");
    }
    const defaultPageSize = options.pageSize ?? Number.POSITIVE_INFINITY;
    if (!Number.isSafeInteger(defaultPageSize) && defaultPageSize !== Number.POSITIVE_INFINITY) {
      throw new Error("WEREAD_INVALID_PAGE_SIZE");
    }
    if (defaultPageSize <= 0) throw new Error("WEREAD_INVALID_PAGE_SIZE");
    this.#now = () => normalizeNow(options.now?.() ?? new Date());
    this.#datasets = fixtureDatasets.map((fixture) => createDataset(fixture, defaultPageSize));
  }

  async validate(apiKey: string): Promise<WeReadAccount> {
    this.calls.push({ operation: "validate" });
    const dataset = this.findDataset(apiKey);
    return cloneAccount(dataset.account);
  }

  /** Validate first, then atomically replace the current account connection. */
  async replaceConnection(accountId: string, apiKey: string): Promise<WeReadConnection> {
    assertNonEmpty(accountId, "WEREAD_INVALID_RECORD");
    const validatedAccount = await this.validate(apiKey);
    const dataset = this.findDataset(apiKey);
    if (dataset.account.externalId !== validatedAccount.externalId) {
      throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
    }
    // Nothing below this point mutates the old connection, so failed validation
    // leaves it fully usable.  The new connection starts with no merged data.
    const connectionId = `weread-connection-${++this.#connectionSequence}`;
    const projection: WeReadConnection = {
      connectionId,
      accountId,
      accountExternalId: dataset.account.externalId,
      apiKeyHint: dataset.apiKeyHint,
      status: "verified",
      verifiedAt: this.#now(),
    };
    const connection: InternalConnection = {
      projection,
      dataset,
      lastSuccessfulBooks: cloneBooks(dataset.lastSuccessfulBooks),
      lastSuccessfulAnnotations: cloneAnnotationMap(dataset.lastSuccessfulAnnotations),
    };
    const previousId = this.#currentByAccount.get(accountId);
    if (previousId) {
      const previous = this.#connections.get(previousId);
      if (previous) previous.projection = { ...previous.projection, status: "disconnected" };
    }
    this.#connections.set(connectionId, connection);
    this.#currentByAccount.set(accountId, connectionId);
    return cloneConnection(projection);
  }

  /** Alias used by callers that call the first verified connection `connect`. */
  async connect(accountId: string, apiKey: string): Promise<WeReadConnection> {
    return this.replaceConnection(accountId, apiKey);
  }

  async getCurrentConnection(accountId: string): Promise<WeReadConnection | null> {
    const connectionId = this.#currentByAccount.get(accountId);
    const connection = connectionId ? this.#connections.get(connectionId) : undefined;
    return connection ? cloneConnection(connection.projection) : null;
  }

  async getConnection(connectionId: string): Promise<WeReadConnection | null> {
    const connection = this.#connections.get(connectionId);
    return connection ? cloneConnection(connection.projection) : null;
  }

  async syncBooks(connectionId: string, cursor?: WeReadCursor): Promise<WeReadSyncPage> {
    const connection = this.requireConnection(connectionId);
    const requestedCursor = cursor ?? null;
    this.calls.push({ operation: "syncBooks", connectionId, cursor: requestedCursor });

    if (connection.projection.status === "paused") {
      return pausedBooksPage(connection, requestedCursor);
    }

    if (requestedCursor === null) {
      connection.bookSyncRun = { expectedCursor: null, records: [] };
    } else if (!connection.bookSyncRun || connection.bookSyncRun.expectedCursor !== requestedCursor) {
      throw new WeReadAdapterError("WEREAD_CURSOR_INVALID");
    }

    const page = connection.dataset.bookPages.find((candidate) => candidate.cursor === requestedCursor);
    if (!page) throw new WeReadAdapterError("WEREAD_CURSOR_INVALID");
    const failure = page.failure;
    if (failure && (failure.errcode !== 0 || hasUpgradeInfo(failure))) {
      const pause = upgradePause(failure);
      if (pause) {
        connection.pause = pause;
        connection.projection = { ...connection.projection, status: "paused" };
        return pausedBooksPage(connection, requestedCursor);
      }
      throw providerError(failure);
    }

    const pageBooks = page.books.map(cloneBook);
    const run = connection.bookSyncRun ?? { expectedCursor: requestedCursor, records: [] };
    run.records.push(...pageBooks);
    run.expectedCursor = page.nextCursor;
    connection.bookSyncRun = run;
    if (page.nextCursor === null) {
      connection.lastSuccessfulBooks = stableBooks(run.records);
      connection.bookSyncRun = undefined;
      connection.projection = { ...connection.projection, status: "verified" };
    }
    return {
      status: "success",
      snapshot: "fresh",
      connectionId,
      accountExternalId: connection.dataset.account.externalId,
      cursor: requestedCursor,
      nextCursor: page.nextCursor,
      books: pageBooks,
    };
  }

  async syncBooksForAccount(
    accountId: string,
    connectionId: string,
    cursor?: WeReadCursor,
  ): Promise<WeReadSyncPage> {
    this.requireOwnedConnection(accountId, connectionId);
    return this.syncBooks(connectionId, cursor);
  }

  getLastSuccessfulBooks(connectionId: string): readonly WeReadBook[] {
    return cloneBooks(this.lookupConnection(connectionId).lastSuccessfulBooks);
  }

  async syncAnnotations(
    connectionId: string,
    bookExternalId: string,
  ): Promise<WeReadAnnotation[]> {
    const result = await this.syncAnnotationsResult(connectionId, bookExternalId);
    if (result.status === "paused") {
      throw new WeReadSyncPausedError({
        kind: "annotations",
        pause: result.pause,
        snapshot: result.annotations,
      });
    }
    return result.annotations.map(cloneAnnotation);
  }

  async syncAnnotationsResult(
    connectionId: string,
    bookExternalId: string,
  ): Promise<WeReadAnnotationsSyncResult> {
    const connection = this.requireConnection(connectionId);
    assertNonEmpty(bookExternalId, "WEREAD_BOOK_NOT_FOUND");
    this.calls.push({ operation: "syncAnnotations", connectionId, bookExternalId });
    if (!connection.dataset.books.some((book) => book.externalId === bookExternalId)) {
      throw new WeReadAdapterError("WEREAD_BOOK_NOT_FOUND");
    }

    if (connection.projection.status === "paused") {
      return pausedAnnotationsResult(connection, bookExternalId);
    }

    const failure = connection.dataset.annotationFailures[bookExternalId]
      ?? connection.dataset.annotationFailure;
    if (failure && (failure.errcode !== 0 || hasUpgradeInfo(failure))) {
      const pause = upgradePause(failure);
      if (pause) {
        connection.pause = pause;
        connection.projection = { ...connection.projection, status: "paused" };
        return pausedAnnotationsResult(connection, bookExternalId);
      }
      throw providerError(failure);
    }

    const annotations = connection.dataset.annotations
      .filter((annotation) => annotation.bookExternalId === bookExternalId)
      .map(cloneAnnotation);
    connection.lastSuccessfulAnnotations.set(bookExternalId, annotations);
    connection.projection = { ...connection.projection, status: "verified" };
    return {
      status: "success",
      snapshot: "fresh",
      connectionId,
      accountExternalId: connection.dataset.account.externalId,
      bookExternalId,
      annotations,
    };
  }

  async syncAnnotationsForAccount(
    accountId: string,
    connectionId: string,
    bookExternalId: string,
  ): Promise<WeReadAnnotation[]> {
    this.requireOwnedConnection(accountId, connectionId);
    return this.syncAnnotations(connectionId, bookExternalId);
  }

  getLastSuccessfulAnnotations(connectionId: string, bookExternalId: string): readonly WeReadAnnotation[] {
    const connection = this.lookupConnection(connectionId);
    return cloneAnnotations(connection.lastSuccessfulAnnotations.get(bookExternalId) ?? []);
  }

  get callLog(): readonly FakeWeReadCall[] {
    return this.calls;
  }

  private findDataset(apiKey: string): InternalDataset {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
    }
    const normalized = apiKey.trim();
    if (!/^wrk-\S+$/.test(normalized)) {
      throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
    }
    const digest = digestApiKey(normalized);
    const dataset = this.#datasets.find((candidate) => candidate.credentialDigest === digest);
    if (!dataset) throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
    return dataset;
  }

  private requireConnection(connectionId: string): InternalConnection {
    const connection = this.lookupConnection(connectionId);
    if (connection.projection.status === "disconnected") {
      throw new WeReadAdapterError("WEREAD_CONNECTION_REVOKED");
    }
    return connection;
  }

  /** Read-only snapshots survive disconnect/replacement, while sync calls do not. */
  private lookupConnection(connectionId: string): InternalConnection {
    if (typeof connectionId !== "string" || !connectionId.trim()) {
      throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
    }
    const connection = this.#connections.get(connectionId);
    if (!connection) throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
    return connection;
  }

  private requireOwnedConnection(accountId: string, connectionId: string): InternalConnection {
    const connection = this.requireConnection(connectionId);
    if (connection.projection.accountId !== accountId) {
      throw new WeReadAdapterError("WEREAD_CONNECTION_FORBIDDEN");
    }
    return connection;
  }
}

export function createFakeWeReadAdapter(options: FakeWeReadAdapterOptions): FakeWeReadAdapter {
  return new FakeWeReadAdapter(options);
}

/** Explicit name for development/QA wiring; it is not production fallback behavior. */
export const createDevelopmentWeReadAdapter = createFakeWeReadAdapter;
export const createWeReadFakeAdapter = createFakeWeReadAdapter;

export function maskWeReadApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "••••";
  return `••••••••${apiKey.slice(-4)}`;
}

function createDataset(fixture: FakeWeReadDataset, defaultPageSize: number): InternalDataset {
  if (!fixture.account || typeof fixture.account.externalId !== "string" || !fixture.account.externalId.trim()) {
    throw new Error("WEREAD_INVALID_RECORD");
  }
  const normalizedApiKey = fixture.apiKey?.trim();
  if (normalizedApiKey && !/^wrk-\S+$/.test(normalizedApiKey)) {
    throw new Error("WEREAD_INVALID_API_KEY");
  }
  const credentialDigest = fixture.apiKeyDigest?.trim()
    || (normalizedApiKey ? digestApiKey(normalizedApiKey) : "");
  if (!credentialDigest || !/^[0-9a-f]{64}$/i.test(credentialDigest)) {
    throw new Error("WEREAD_INVALID_API_KEY");
  }
  const explicitPages = fixture.bookPages ?? fixture.pages;
  const pages = explicitPages?.map(clonePage);
  const books = (fixture.books ?? pages?.flatMap((page) => page.books) ?? []).map(cloneBook);
  const annotations = (fixture.annotations ?? []).map(cloneAnnotation);
  const pageSize = fixture.pageSize ?? defaultPageSize;
  if (!Number.isSafeInteger(pageSize) && pageSize !== Number.POSITIVE_INFINITY) {
    throw new Error("WEREAD_INVALID_PAGE_SIZE");
  }
  if (pageSize <= 0) throw new Error("WEREAD_INVALID_PAGE_SIZE");
  const bookPages = pages
    ? pages
    : buildBookPages(books, pageSize);
  const lastSuccessfulAnnotations = new Map<string, readonly WeReadAnnotation[]>();
  for (const [bookExternalId, values] of Object.entries(fixture.lastSuccessfulAnnotations ?? {})) {
    lastSuccessfulAnnotations.set(bookExternalId, values.map(cloneAnnotation));
  }
  return {
    account: cloneAccount(fixture.account),
    credentialDigest: credentialDigest.toLowerCase(),
    apiKeyHint: safeApiKeyHint(fixture.apiKeyHint, normalizedApiKey),
    books,
    annotations,
    bookPages,
    lastSuccessfulBooks: (fixture.lastSuccessfulBooks ?? []).map(cloneBook),
    lastSuccessfulAnnotations,
    annotationFailure: fixture.annotationFailure,
    annotationFailures: fixture.annotationFailures ?? {},
  };
}

function buildBookPages(books: readonly WeReadBook[], pageSize: number): FakeWeReadBookPage[] {
  if (books.length === 0) return [{ cursor: null, books: [], nextCursor: null }];
  const pages: FakeWeReadBookPage[] = [];
  for (let offset = 0; offset < books.length; offset += pageSize) {
    const pageIndex = pages.length;
    const nextCursor = offset + pageSize < books.length ? `fake-cursor-${pageIndex + 1}` : null;
    pages.push({
      cursor: pageIndex === 0 ? null : `fake-cursor-${pageIndex}`,
      books: books.slice(offset, offset + pageSize),
      nextCursor,
    });
  }
  return pages;
}

function clonePage(page: FakeWeReadBookPage): FakeWeReadBookPage {
  return {
    cursor: page.cursor,
    books: page.books.map(cloneBook),
    nextCursor: page.nextCursor,
    ...(page.failure ? { failure: { ...page.failure } } : {}),
  };
}

function cloneAccount(account: WeReadAccount): WeReadAccount {
  return { externalId: account.externalId, displayName: account.displayName ?? null };
}

function cloneConnection(connection: WeReadConnection): WeReadConnection {
  return { ...connection };
}

function cloneBook(book: WeReadBook): WeReadBook {
  if (
    !book
    || typeof book.externalId !== "string"
    || !book.externalId.trim()
    || typeof book.title !== "string"
    || !book.title.trim()
    || (book.author !== null && typeof book.author !== "string")
    || (book.coverUrl !== null && typeof book.coverUrl !== "string")
    || (book.progressPercent !== null
      && (!Number.isSafeInteger(book.progressPercent) || book.progressPercent < 0 || book.progressPercent > 100))
    || (book.lastReadAt !== null && !isCanonicalTimestamp(book.lastReadAt))
  ) {
    throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  }
  return { ...book };
}

function cloneBooks(books: readonly WeReadBook[]): WeReadBook[] {
  return books.map(cloneBook);
}

function cloneAnnotation(annotation: WeReadAnnotation): WeReadAnnotation {
  if (
    !annotation
    || typeof annotation.externalId !== "string"
    || !annotation.externalId.trim()
    || typeof annotation.bookExternalId !== "string"
    || !annotation.bookExternalId.trim()
    || typeof annotation.quote !== "string"
    || !annotation.quote.trim()
    || (annotation.thought !== null && typeof annotation.thought !== "string")
    || (annotation.location !== null && typeof annotation.location !== "string")
    || !isCanonicalTimestamp(annotation.createdAt)
    || !isCanonicalTimestamp(annotation.updatedAt)
  ) {
    throw new WeReadAdapterError("WEREAD_INVALID_RECORD");
  }
  return { ...annotation, location: normalizeLocation(annotation.location) };
}

function cloneAnnotations(annotations: readonly WeReadAnnotation[]): WeReadAnnotation[] {
  return annotations.map(cloneAnnotation);
}

function cloneAnnotationMap(
  values: Map<string, readonly WeReadAnnotation[]>,
): Map<string, WeReadAnnotation[]> {
  return new Map([...values].map(([bookExternalId, annotations]) => [
    bookExternalId,
    cloneAnnotations(annotations),
  ]));
}

function stableBooks(books: readonly WeReadBook[]): WeReadBook[] {
  const byId = new Map<string, WeReadBook>();
  for (const book of books) byId.set(book.externalId, cloneBook(book));
  return [...byId.values()];
}

function pausedBooksPage(connection: InternalConnection, cursor: WeReadCursor | null): WeReadSyncPage {
  if (!connection.pause) throw new WeReadAdapterError("WEREAD_SYNC_PAUSED");
  return {
    status: "paused",
    snapshot: "last_success",
    connectionId: connection.projection.connectionId,
    accountExternalId: connection.dataset.account.externalId,
    cursor,
    nextCursor: null,
    books: cloneBooks(connection.lastSuccessfulBooks),
    pause: { ...connection.pause },
  };
}

function pausedAnnotationsResult(
  connection: InternalConnection,
  bookExternalId: string,
): WeReadAnnotationsSyncResult {
  if (!connection.pause) throw new WeReadAdapterError("WEREAD_SYNC_PAUSED");
  return {
    status: "paused",
    snapshot: "last_success",
    connectionId: connection.projection.connectionId,
    accountExternalId: connection.dataset.account.externalId,
    bookExternalId,
    annotations: cloneAnnotations(connection.lastSuccessfulAnnotations.get(bookExternalId) ?? []),
    pause: { ...connection.pause },
  };
}

function digestApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function normalizeNow(value: string | number | Date): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("WEREAD_INVALID_TIMESTAMP");
    return value.toISOString();
  }
  const date = typeof value === "number"
    ? Number.isFinite(value) ? new Date(value * 1_000) : new Date(Number.NaN)
    : typeof value === "string" && /T.*Z$/i.test(value.trim()) ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new Error("WEREAD_INVALID_TIMESTAMP");
  return date.toISOString();
}

function assertNonEmpty(value: string, code: WeReadAdapterErrorCode): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new WeReadAdapterError(code);
}

function hasUpgradeInfo(failure: FakeWeReadGatewayFailure): boolean {
  return typeof (failure.upgrade_info ?? failure.upgradeInfo) === "string"
    && Boolean((failure.upgrade_info ?? failure.upgradeInfo)?.trim());
}

function upgradePause(failure: FakeWeReadGatewayFailure): WeReadSyncPause | undefined {
  const rawInfo = failure.upgrade_info ?? failure.upgradeInfo;
  if (typeof rawInfo !== "string" || !rawInfo.trim()) return undefined;
  return {
    reason: "upgrade_required",
    errcode: failure.errcode,
    upgradeInfo: rawInfo,
  };
}

function providerError(failure: FakeWeReadGatewayFailure): WeReadAdapterError {
  return new WeReadAdapterError("WEREAD_PROVIDER_ERROR", {
    retryable: failure.errcode === 408 || failure.errcode === 425 || failure.errcode === 429 || failure.errcode >= 500,
    errcode: failure.errcode,
  });
}

function isRetryable(code: WeReadAdapterErrorCode): boolean {
  return code === "WEREAD_PROVIDER_ERROR" || code === "WEREAD_SYNC_PAUSED";
}

function isCanonicalTimestamp(value: string): boolean {
  return typeof value === "string"
    && /T.*Z$/i.test(value.trim())
    && Number.isFinite(new Date(value).getTime());
}

function safeApiKeyHint(configuredHint: string | undefined, normalizedApiKey: string | undefined): string {
  const fallback = normalizedApiKey ? maskWeReadApiKey(normalizedApiKey) : "••••";
  const hint = configuredHint?.trim();
  if (!hint || (normalizedApiKey && hint.includes(normalizedApiKey))) return fallback;
  if (hint === "••••" || /^••••••••\S{4}$/u.test(hint)) return hint;
  return fallback;
}

function normalizeLocation(location: string | null): string | null {
  return location === null || location.trim() === "" ? null : location;
}
