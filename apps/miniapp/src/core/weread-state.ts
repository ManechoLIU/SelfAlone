import type { BookSummary } from "./library-state";

/**
 * These structural types intentionally mirror the frozen v1 JSON contract in
 * packages/contracts.  The Mini App package does not depend on the contracts
 * package at runtime, so this module keeps the boundary type-only and route
 * agnostic.
 */
export const WEREAD_API_CONTRACT_VERSION = "v1" as const;

export type WeReadExternalId = string;
export type WeReadCursor = string;
export type WeReadTimestamp = string;

export type WeReadConnectionProjection = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  apiKeyHint: string;
  status: "verified" | "paused" | "disconnected";
  verifiedAt: WeReadTimestamp;
  revision: string;
};

export type WeReadConnectionGetResponse = {
  connection: WeReadConnectionProjection | null;
};

export type WeReadConnectionPutRequest = {
  apiKey: string;
  requestId: string;
  expectedRevision: string | null;
};

export type WeReadBooksSyncRunProjection = WeReadSyncRunProjectionBase<"books">;
export type WeReadAnnotationsSyncRunProjection = WeReadSyncRunProjectionBase<"annotations">;

export type WeReadConnectionPutResponse = {
  connection: WeReadConnectionProjection;
  sync: { run: WeReadBooksSyncRunProjection };
};

export type WeReadConnectionDeleteRequest = { expectedRevision: string };
export type WeReadConnectionDeleteResponse = { status: "disconnected" };

export type WeReadApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "EXTERNAL_AUTH_REQUIRED"
  | "EXTERNAL_SERVICE_FAILED"
  | "STALE_VERSION"
  | "INTERNAL_ERROR";

export type WeReadApiError = {
  code: WeReadApiErrorCode;
  message: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
};

export type WeReadSyncOperation = "books" | "annotations";
export type WeReadSyncRunStatus = "queued" | "running" | "completed" | "paused" | "failed";
export type WeReadSyncSnapshot = "none" | "fresh" | "last_success";

export type WeReadSyncPause = {
  reason: "upgrade_required";
  errcode: number;
  upgradeInfo: string;
};

type WeReadSyncRunBase<TOperation extends WeReadSyncOperation> = {
  runId: string;
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
  ? { bookId: string; bookExternalId: WeReadExternalId }
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

type WeReadSyncRunProjectionBase<TOperation extends WeReadSyncOperation> = WeReadSyncRunProjectionFor<TOperation>;
export type WeReadSyncRunProjection = WeReadBooksSyncRunProjection | WeReadAnnotationsSyncRunProjection;

export type WeReadBooksSyncRequest = {
  requestId: string;
  cursor?: WeReadCursor | null;
};

export type WeReadBooksSyncResponse = { run: WeReadBooksSyncRunProjection };
export type WeReadSyncStatusResponse = { run: WeReadSyncRunProjection };

export type WeReadBook = {
  /** Account-owned local identity; provider externalId remains separate. */
  bookId: string;
  externalId: WeReadExternalId;
  title: string;
  author: string | null;
  coverUrl: string | null;
  progressPercent: number | null;
  lastReadAt: WeReadTimestamp | null;
};

type WeReadBooksSnapshotBase = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  cursor: WeReadCursor | null;
  nextCursor: WeReadCursor | null;
  books: readonly WeReadBook[];
};

export type WeReadBooksSnapshotResponse =
  | (WeReadBooksSnapshotBase & { status: "success"; snapshot: "last_success" })
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

export type WeReadBooksSnapshotRequest = { cursor?: WeReadCursor | null };

export type WeReadAnnotationsSyncRequest = {
  requestId: string;
  bookId: string;
};

export type WeReadAnnotationsSyncResponse = { run: WeReadAnnotationsSyncRunProjection };

type WeReadAnnotationsSnapshotBase = {
  connectionId: string;
  accountExternalId: WeReadExternalId;
  bookId: string;
  bookExternalId: WeReadExternalId;
  annotations: readonly WeReadAnnotation[];
};

export type WeReadAnnotationsSnapshotResponse =
  | (WeReadAnnotationsSnapshotBase & { status: "success"; snapshot: "last_success" })
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

export type WeReadAnnotationsSnapshotRequest = { bookId: string };

export type WeReadAnnotation = {
  externalId: string;
  bookExternalId: string;
  quote: string;
  thought: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeReadAnnotationView = {
  id: string;
  bookId: string;
  quote: string;
  thought: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeReadBookSummary = BookSummary & {
  wereadExternalId: WeReadExternalId;
  progressKnown: boolean;
};

export type WeReadSyncViewStatus = "idle" | "loading" | "queued" | "running" | "success" | "paused" | "failed";

export type WeReadSyncPresentation = {
  status: WeReadSyncViewStatus;
  label: string;
  message: string;
};

const WE_READ_ID_PREFIX = "weread:";

export function wereadBookId(externalId: string): string {
  return `${WE_READ_ID_PREFIX}${externalId}`;
}

export function wereadBookExternalId(localBookId: string): string {
  return localBookId.startsWith(WE_READ_ID_PREFIX)
    ? localBookId.slice(WE_READ_ID_PREFIX.length)
    : localBookId;
}

function stableCoverVariant(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 3;
}

export function mapWeReadBook(book: WeReadBook): WeReadBookSummary {
  const progressKnown = typeof book.progressPercent === "number" && Number.isFinite(book.progressPercent);
  const percent = progressKnown
    ? Math.min(100, Math.max(0, book.progressPercent as number))
    : 0;
  const coverUrl = typeof book.coverUrl === "string" && book.coverUrl.trim() ? book.coverUrl.trim() : undefined;
  return {
    id: book.bookId,
    title: book.title,
    ...(book.author?.trim() ? { author: book.author.trim() } : {}),
    source: "weread",
    sourceLabel: "微信读书",
    format: "weread",
    progress: percent / 100,
    wereadExternalId: book.externalId,
    progressKnown,
    ...(coverUrl ? { coverUrl } : {}),
    coverVariant: stableCoverVariant(book.externalId),
  };
}

export function mapWeReadAnnotation(annotation: WeReadAnnotation, localBookId = wereadBookId(annotation.bookExternalId)): WeReadAnnotationView {
  return {
    id: annotation.externalId,
    bookId: localBookId,
    quote: annotation.quote,
    thought: annotation.thought,
    location: annotation.location?.trim() || null,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

export function mergeWeReadBooks(localBooks: readonly BookSummary[], wereadBooks: readonly BookSummary[]): BookSummary[] {
  const seen = new Set<string>();
  return [...localBooks, ...wereadBooks].filter((book) => {
    if (seen.has(book.id)) return false;
    seen.add(book.id);
    return true;
  });
}

export function presentWeReadSync(
  response: WeReadBooksSnapshotResponse | WeReadAnnotationsSnapshotResponse | WeReadSyncStatusResponse | WeReadBooksSyncResponse,
): WeReadSyncPresentation {
  const run = "run" in response ? response.run : null;
  if (run) {
    if (run.status === "queued") return { status: "queued", label: "等待同步", message: "" };
    if (run.status === "running") return { status: "running", label: "同步中", message: "" };
    if (run.status === "completed") return { status: "success", label: "已同步", message: "" };
    if (run.status === "paused") {
      const pause = "pause" in run ? run.pause : undefined;
      return { status: "paused", label: "需要更新", message: pause?.upgradeInfo || "微信读书需要更新后才能同步" };
    }
    const error = "error" in run ? run.error : undefined;
    return { status: "failed", label: "同步失败", message: error?.message || "微信读书同步失败" };
  }
  const snapshot = response as WeReadBooksSnapshotResponse | WeReadAnnotationsSnapshotResponse;
  if (snapshot.status === "success") return { status: "success", label: "已同步", message: "" };
  if (snapshot.status === "paused") return { status: "paused", label: "需要更新", message: snapshot.pause.upgradeInfo || "微信读书需要更新后才能同步" };
  return { status: "failed", label: "同步失败", message: snapshot.error.message };
}

export function preserveWeReadOnFailure<T>(books: readonly T[], notice: string): { books: readonly T[]; notice: string } {
  return { books, notice };
}

export function weReadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "微信读书暂时无法连接，请稍后重试";
}

export function annotationsFromSnapshot(response: WeReadAnnotationsSnapshotResponse): WeReadAnnotationView[] {
  return response.annotations.map((annotation) => mapWeReadAnnotation(annotation, response.bookId));
}
