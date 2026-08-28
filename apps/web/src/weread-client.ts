import type {
  WeReadAnnotation,
  WeReadAnnotationsSnapshotRequest,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncRequest,
  WeReadAnnotationsSyncResponse,
  WeReadBookProjection,
  WeReadBooksSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadBooksSyncRequest,
  WeReadBooksSyncResponse,
  WeReadConnectionDeleteRequest,
  WeReadConnectionDeleteResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionProjection,
  WeReadConnectionPutRequest,
  WeReadConnectionPutResponse,
  WeReadSyncRunProjection,
  WeReadSyncStatusResponse,
} from "@selfalone/contracts";

/**
 * A provider-neutral port for the frozen JSON contract.  The Web client owns
 * no HTTP URL and can therefore be exercised with a local or test transport.
 */
export type WeReadClientPort = {
  getConnection(): Promise<WeReadConnectionGetResponse>;
  putConnection(input: WeReadConnectionPutRequest): Promise<WeReadConnectionPutResponse>;
  deleteConnection(input: WeReadConnectionDeleteRequest): Promise<WeReadConnectionDeleteResponse>;
  syncBooks(input: WeReadBooksSyncRequest): Promise<WeReadBooksSyncResponse>;
  getBooksSnapshot(input?: WeReadBooksSnapshotRequest): Promise<WeReadBooksSnapshotResponse>;
  getSyncStatus(runId: string): Promise<WeReadSyncStatusResponse>;
  syncAnnotations(input: WeReadAnnotationsSyncRequest): Promise<WeReadAnnotationsSyncResponse>;
  getAnnotationsSnapshot(input: WeReadAnnotationsSnapshotRequest): Promise<WeReadAnnotationsSnapshotResponse>;
};

export type WeReadClient = WeReadClientPort;

export function createWeReadClient(port: WeReadClientPort): WeReadClient {
  return { ...port };
}

export type NoCallWeReadSeed = {
  connection: WeReadConnectionProjection | null;
  books: readonly WeReadBookProjection[];
  annotations: readonly WeReadAnnotation[];
};

export type NoCallWeReadOptions = {
  failOnceOperation?: "books";
  onFailOnceConsumed?: () => void;
};

const localTimestamp = "2026-08-28T00:00:00.000Z";

const emptySeed: NoCallWeReadSeed = {
  connection: null,
  books: [],
  annotations: [],
};

function cloneSeed(seed: NoCallWeReadSeed): NoCallWeReadSeed {
  return {
    connection: seed.connection ? { ...seed.connection } : null,
    books: seed.books.map((book) => ({ ...book })),
    annotations: seed.annotations.map((annotation) => ({ ...annotation })),
  };
}

function localError(code: string): Error {
  return new Error(code);
}

function maskApiKey(apiKey: string) {
  const suffix = apiKey.length > 4 ? apiKey.slice(-4) : "****";
  return `••••${suffix}`;
}

function runProjection(
  operation: "books" | "annotations",
  connection: WeReadConnectionProjection,
  requestId: string,
  bookId?: string,
  bookExternalId?: string,
): WeReadSyncRunProjection {
  const base = {
    runId: `local-run-${operation}-${requestId}`,
    requestId,
    operation,
    connectionId: connection.connectionId,
    accountExternalId: connection.accountExternalId,
    status: "completed" as const,
    snapshot: "fresh" as const,
    cursor: null,
    nextCursor: null,
    retryCount: 0,
    createdAt: localTimestamp,
    updatedAt: localTimestamp,
    completedAt: localTimestamp,
  };
  if (operation === "books") return { ...base, operation: "books" };
  return {
    ...base,
    operation: "annotations",
    bookId: bookId ?? "",
    bookExternalId: bookExternalId ?? "",
  };
}

export function createNoCallWeReadClient(
  seed: NoCallWeReadSeed = emptySeed,
  options: NoCallWeReadOptions = {},
): WeReadClient {
  const initial = cloneSeed(seed);
  let connection = initial.connection;
  let books = [...initial.books];
  let annotations = [...initial.annotations];
  let revision = Number(connection?.revision.match(/(\d+)$/)?.[1] ?? "1");
  let latestRun: WeReadSyncRunProjection | null = null;
  let failOnceOperation = options.failOnceOperation;

  function requireConnection() {
    if (!connection) throw localError("EXTERNAL_AUTH_REQUIRED");
    return connection;
  }

  function annotationsForBook(bookId: string) {
    const resolvedBook = books.find((book) => book.bookId === bookId);
    if (!resolvedBook) return [];
    return annotations
      .filter((annotation) => annotation.bookExternalId === resolvedBook.externalId)
      .map((annotation) => ({ ...annotation }));
  }

  return createWeReadClient({
    async getConnection() {
      return { connection: connection ? { ...connection } : null };
    },

    async putConnection(input) {
      const apiKey = input.apiKey.trim();
      if (!apiKey) throw localError("VALIDATION_FAILED");
      const currentRevision = connection?.revision ?? null;
      if (input.expectedRevision !== currentRevision) throw localError("CONFLICT");
      revision += 1;
      connection = {
        connectionId: connection?.connectionId ?? "local-weread-connection",
        accountExternalId: connection?.accountExternalId ?? "local-weread-account",
        apiKeyHint: maskApiKey(apiKey),
        status: "verified",
        verifiedAt: localTimestamp,
        revision: `local-revision-${revision}`,
      };
      const booksRun = runProjection("books", connection, input.requestId) as Extract<WeReadSyncRunProjection, { operation: "books" }>;
      latestRun = booksRun;
      return { connection: { ...connection }, sync: { run: booksRun } };
    },

    async deleteConnection(input) {
      const current = requireConnection();
      if (input.expectedRevision !== current.revision) throw localError("CONFLICT");
      connection = null;
      latestRun = null;
      return { status: "disconnected" };
    },

    async syncBooks(input) {
      const current = requireConnection();
      if (failOnceOperation === "books") {
        failOnceOperation = undefined;
        options.onFailOnceConsumed?.();
        throw localError("EXTERNAL_SERVICE_FAILED");
      }
      const booksRun = runProjection("books", current, input.requestId) as Extract<WeReadSyncRunProjection, { operation: "books" }>;
      latestRun = booksRun;
      return { run: booksRun };
    },

    async getBooksSnapshot(_input) {
      const current = requireConnection();
      return {
        connectionId: current.connectionId,
        accountExternalId: current.accountExternalId,
        cursor: null,
        nextCursor: null,
        books: books.map((book) => ({ ...book })),
        status: "success",
        snapshot: "last_success",
      };
    },

    async getSyncStatus(runId) {
      if (!latestRun || latestRun.runId !== runId) throw localError("INTERNAL_ERROR");
      return { run: latestRun };
    },

    async syncAnnotations(input) {
      const current = requireConnection();
      const resolvedBook = books.find((book) => book.bookId === input.bookId);
      if (!resolvedBook) throw localError("VALIDATION_FAILED");
      latestRun = runProjection("annotations", current, input.requestId, input.bookId, resolvedBook.externalId);
      return { run: latestRun as Extract<WeReadSyncRunProjection, { operation: "annotations" }> };
    },

    async getAnnotationsSnapshot(input) {
      const current = requireConnection();
      const resolvedBook = books.find((book) => book.bookId === input.bookId);
      if (!resolvedBook) throw localError("VALIDATION_FAILED");
      return {
        connectionId: current.connectionId,
        accountExternalId: current.accountExternalId,
        bookId: input.bookId,
        bookExternalId: resolvedBook.externalId,
        annotations: annotationsForBook(input.bookId),
        status: "success",
        snapshot: "last_success",
      };
    },
  });
}
