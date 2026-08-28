import type {
  WeReadAnnotation,
  WeReadBook,
  WeReadCursor,
  WeReadExternalId,
  WeReadSyncPause,
  WeReadTimestamp,
} from "./weread-sync";

/** Version of the JSON boundary consumed by the Web and Mini App clients. */
export const WEREAD_API_CONTRACT_VERSION = "v1" as const;

/** A projection never contains the credential used to create the connection. */
export type WeReadConnectionProjection = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  apiKeyHint: string;
  status: "verified" | "paused" | "disconnected";
  verifiedAt: WeReadTimestamp;
  /** Opaque account-owned revision used by compare-and-swap writes. */
  revision: string;
};

export type WeReadConnectionGetResponse = {
  connection: WeReadConnectionProjection | null;
};

/** The raw key is accepted only on this request and is never a response field. */
export type WeReadConnectionPutRequest = {
  apiKey: string;
  /** Account-scoped idempotency key for a replacement request. */
  requestId: string;
  /** Revision read from the current connection; null explicitly confirms no prior connection. */
  expectedRevision: string | null;
};

export type WeReadConnectionPutResponse = {
  connection: WeReadConnectionProjection;
  /** Successful validation starts the first asynchronous books sync. */
  sync: WeReadBooksSyncResponse;
};

export type WeReadConnectionDeleteResponse = {
  status: "disconnected";
};

/** A delete must target the connection revision the client actually observed. */
export type WeReadConnectionDeleteRequest = {
  expectedRevision: string;
};

export type WeReadSyncOperation = "books" | "annotations";
export type WeReadSyncRunStatus = "queued" | "running" | "completed" | "paused" | "failed";
export type WeReadSyncSnapshot = "none" | "fresh" | "last_success";

export type WeReadApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "EXTERNAL_AUTH_REQUIRED"
  | "EXTERNAL_SERVICE_FAILED"
  | "STALE_VERSION"
  | "INTERNAL_ERROR";

/** Provider payloads are normalized before crossing the HTTP boundary. */
export type WeReadApiError = {
  code: WeReadApiErrorCode;
  message: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
};

type WeReadSyncRunBase<TOperation extends WeReadSyncOperation> = {
  runId: string;
  /** Reusing this value in another account is valid; within an account it is idempotent. */
  requestId: string;
  operation: TOperation;
  connectionId: string;
  accountExternalId: WeReadExternalId;
  status: WeReadSyncRunStatus;
  snapshot: WeReadSyncSnapshot;
  cursor: WeReadCursor | null;
  nextCursor: WeReadCursor | null;
  retryCount: number;
  createdAt: WeReadTimestamp;
  updatedAt: WeReadTimestamp;
  completedAt?: WeReadTimestamp | null;
} & (TOperation extends "annotations"
  ? {
      /** Local book identity used by clients and persistence. */
      bookId: string;
      /** Provider identity resolved by the server for this local book. */
      bookExternalId: WeReadExternalId;
    }
  : { bookId?: never; bookExternalId?: never });

type WeReadSyncRunProjectionFor<TOperation extends WeReadSyncOperation> =
  | (WeReadSyncRunBase<TOperation> & {
      status: "queued" | "running";
      snapshot: "none";
      error?: never;
      pause?: never;
    })
  | (WeReadSyncRunBase<TOperation> & {
      status: "completed";
      snapshot: "fresh";
      nextCursor: null;
      error?: never;
      pause?: never;
    })
  | (WeReadSyncRunBase<TOperation> & {
      status: "paused";
      snapshot: "last_success";
      nextCursor: null;
      pause: WeReadSyncPause;
      error?: never;
    })
  | (WeReadSyncRunBase<TOperation> & {
      status: "failed";
      snapshot: "last_success";
      nextCursor: null;
      error: WeReadApiError;
      pause?: never;
    });

export type WeReadBooksSyncRunProjection = WeReadSyncRunProjectionFor<"books">;
export type WeReadAnnotationsSyncRunProjection = WeReadSyncRunProjectionFor<"annotations">;
export type WeReadSyncRunProjection =
  | WeReadBooksSyncRunProjection
  | WeReadAnnotationsSyncRunProjection;

export type WeReadBooksSyncRequest = {
  /** Unique only within the authenticated account. */
  requestId: string;
  /** Provider cursor is opaque; null and omission both mean the first page. */
  cursor?: WeReadCursor | null;
};

/** Body returned with HTTP 202 for POST books sync. */
export type WeReadBooksSyncResponse = {
  run: WeReadBooksSyncRunProjection;
};

/** Body returned by GET /weread/sync/:runId. */
export type WeReadSyncStatusResponse = {
  run: WeReadSyncRunProjection;
};

type WeReadBooksSnapshotBase = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  cursor: WeReadCursor | null;
  nextCursor: WeReadCursor | null;
  books: readonly WeReadBook[];
};

export type WeReadBooksSnapshotResponse =
  | (WeReadBooksSnapshotBase & {
      status: "success";
      /** GET returns the most recently committed complete snapshot. */
      snapshot: "last_success";
    })
  | (WeReadBooksSnapshotBase & {
      status: "paused";
      snapshot: "last_success";
      nextCursor: null;
      pause: WeReadSyncPause;
    })
  | (WeReadBooksSnapshotBase & {
      status: "failed";
      snapshot: "last_success";
      nextCursor: null;
      error: WeReadApiError;
    });

/** Optional read pagination is also opaque and never an offset. */
export type WeReadBooksSnapshotRequest = {
  cursor?: WeReadCursor | null;
};

export type WeReadAnnotationsSyncRequest = {
  /** The local opaque book ID; callers never choose a provider account ID. */
  requestId: string;
  bookId: string;
};

export type WeReadAnnotationsSyncResponse = {
  run: WeReadAnnotationsSyncRunProjection;
};

type WeReadAnnotationsSnapshotBase = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  /** Local book identity used by clients and persistence. */
  bookId: string;
  /** Provider identity resolved by the server for this local book. */
  bookExternalId: WeReadExternalId;
  annotations: readonly WeReadAnnotation[];
};

export type WeReadAnnotationsSnapshotResponse =
  | (WeReadAnnotationsSnapshotBase & {
      status: "success";
      /** GET returns the most recently committed complete snapshot. */
      snapshot: "last_success";
    })
  | (WeReadAnnotationsSnapshotBase & {
      status: "paused";
      snapshot: "last_success";
      pause: WeReadSyncPause;
    })
  | (WeReadAnnotationsSnapshotBase & {
      status: "failed";
      snapshot: "last_success";
      error: WeReadApiError;
    });

export type WeReadAnnotationsSnapshotRequest = {
  bookId: string;
};
