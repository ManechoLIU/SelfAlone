/**
 * Shared WeRead contract.
 *
 * The provider uses opaque IDs and cursors.  We never turn an external ID or
 * cursor into a number: doing so would make a provider change look like a
 * local record or page offset.  The shared boundary is JSON-compatible so it
 * can be consumed by both the Web and Mini App clients.
 */

export const WEREAD_SOURCE = "weread" as const;
export const WEREAD_CURSOR_SEMANTICS = "opaque" as const;
export const WEREAD_PROGRESS_UNIT = "percent" as const;
export const WEREAD_TIMESTAMP_UNIT = "iso-8601-utc" as const;

export type WeReadExternalId = string;
export type WeReadCursor = string;
export type WeReadTimestamp = string;

export type WeReadAccount = {
  externalId: WeReadExternalId;
  displayName: string | null;
};

/**
 * A provider book is metadata plus the user's own reading progress.  The
 * progress value is a whole percentage (0..100), never the provider's 0..1
 * fraction.  Unknown progress is represented by null.
 */
export type WeReadBook = {
  externalId: WeReadExternalId;
  title: string;
  author: string | null;
  coverUrl: string | null;
  progressPercent: number | null;
  /** Canonical UTC timestamp; null means the provider did not expose one. */
  lastReadAt: WeReadTimestamp | null;
};

/**
 * WeRead locations are display-only.  Unlike local text locators they do not
 * promise a jump back into full text, so an unknown location remains null.
 */
export type WeReadAnnotation = {
  externalId: WeReadExternalId;
  bookExternalId: WeReadExternalId;
  quote: string;
  thought: string | null;
  location: string | null;
  createdAt: WeReadTimestamp;
  updatedAt: WeReadTimestamp;
};

export type WeReadSyncPause = {
  reason: "upgrade_required";
  errcode: number;
  upgradeInfo: string;
};

export type WeReadSyncPage =
  | {
      status: "success";
      snapshot: "fresh";
      connectionId: string;
      accountExternalId: WeReadExternalId;
      /** The cursor used for this page; null denotes the initial page. */
      cursor: WeReadCursor | null;
      /** An opaque cursor for the next page, or null at the end. */
      nextCursor: WeReadCursor | null;
      books: readonly WeReadBook[];
    }
  | {
      status: "paused";
      snapshot: "last_success";
      connectionId: string;
      accountExternalId: WeReadExternalId;
      /** The cursor whose provider response requested the pause. */
      cursor: WeReadCursor | null;
      nextCursor: null;
      /** The complete last committed snapshot, never a partial failed run. */
      books: readonly WeReadBook[];
      pause: WeReadSyncPause;
    };

export type WeReadAnnotationsSyncResult =
  | {
      status: "success";
      snapshot: "fresh";
      connectionId: string;
      accountExternalId: WeReadExternalId;
      bookExternalId: WeReadExternalId;
      annotations: readonly WeReadAnnotation[];
    }
  | {
      status: "paused";
      snapshot: "last_success";
      connectionId: string;
      accountExternalId: WeReadExternalId;
      bookExternalId: WeReadExternalId;
      /** The complete last committed annotation snapshot for this book. */
      annotations: readonly WeReadAnnotation[];
      pause: WeReadSyncPause;
    };

/**
 * The adapter shape mirrors TECHNICAL.md §5.3.  Account ownership is bound to
 * the connection on the server side; provider IDs are never used as local
 * account IDs.
 */
export interface WeReadAdapter {
  validate(apiKey: string): Promise<WeReadAccount>;
  syncBooks(connectionId: string, cursor?: WeReadCursor): Promise<WeReadSyncPage>;
  syncAnnotations(connectionId: string, bookExternalId: WeReadExternalId): Promise<WeReadAnnotation[]>;
}

export type WeReadConnectionStatus = "verified" | "paused" | "disconnected";

/** Safe connection projection.  It intentionally has no credential field. */
export type WeReadConnection = {
  connectionId: string;
  accountId: string;
  accountExternalId: WeReadExternalId;
  apiKeyHint: string;
  status: WeReadConnectionStatus;
  verifiedAt: WeReadTimestamp;
};

export type WeReadProviderErrorPayload = {
  errcode: number;
  upgrade_info?: string | null;
};
