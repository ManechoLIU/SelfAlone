import { describe, expect, it } from "vitest";
import { WEREAD_API_CONTRACT_VERSION } from "./weread-api";
import type {
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncRequest,
  WeReadAnnotationsSyncResponse,
  WeReadApiError,
  WeReadAnnotationsSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadBooksSnapshotRequest,
  WeReadBooksSyncRequest,
  WeReadBooksSyncResponse,
  WeReadConnectionDeleteResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionPutRequest,
  WeReadConnectionPutResponse,
  WeReadConnectionProjection,
  WeReadSyncRunProjection,
  WeReadSyncStatusResponse,
} from "./weread-api";

const connection: WeReadConnectionProjection = {
  connectionId: "connection-a",
  accountExternalId: "weread-account-a",
  apiKeyHint: "wrk-••••••••",
  status: "verified",
  verifiedAt: "2024-01-02T03:04:05.000Z",
  revision: "3",
};

const pause = {
  reason: "upgrade_required" as const,
  errcode: 426,
  upgradeInfo: "upgrade skill",
};

const book = {
  externalId: "book-a",
  title: "一本书",
  author: "作者",
  coverUrl: null,
  progressPercent: 43,
  lastReadAt: "2024-01-02T03:04:05.000Z",
} as const;

const annotation = {
  externalId: "annotation-a",
  bookExternalId: "book-a",
  quote: "重要的一句",
  thought: "我的想法",
  location: null,
  createdAt: "2024-01-02T03:04:05.000Z",
  updatedAt: "2024-01-02T03:05:05.000Z",
} as const;

const runningBooksRun: WeReadSyncRunProjection = {
  runId: "run-books-a",
  requestId: "request-account-a-1",
  operation: "books",
  connectionId: "connection-a",
  accountExternalId: "weread-account-a",
  status: "running",
  snapshot: "none",
  cursor: null,
  nextCursor: "opaque/page-2",
  retryCount: 0,
  createdAt: "2024-01-02T03:04:05.000Z",
  updatedAt: "2024-01-02T03:04:06.000Z",
};

describe("shared WeRead HTTP contract", () => {
  it("publishes a stable JSON contract version for both clients", () => {
    expect(WEREAD_API_CONTRACT_VERSION).toBe("v1");
  });

  it("keeps connection GET/PUT/DELETE JSON shapes safe and account-neutral", () => {
    const getResponse: WeReadConnectionGetResponse = { connection };
    const putRequest: WeReadConnectionPutRequest = {
      apiKey: "wrk-a-secret",
      requestId: "request-account-a-1",
    };
    const putResponse: WeReadConnectionPutResponse = {
      connection,
      sync: { run: runningBooksRun },
    };
    const deleteResponse: WeReadConnectionDeleteResponse = { status: "disconnected" };

    const json = JSON.stringify({ getResponse, putRequest, putResponse, deleteResponse });
    expect(json).toContain("wrk-a-secret");
    expect(JSON.parse(JSON.stringify(getResponse))).toEqual({ connection });
    expect(JSON.parse(JSON.stringify(putResponse))).toEqual({
      connection,
      sync: { run: runningBooksRun },
    });
    expect(deleteResponse.status).toBe("disconnected");
    expect(connection.apiKeyHint).not.toContain("wrk-a-secret");
    expect(connection.apiKeyHint).not.toContain("secret");
  });

  it("models a 202 books sync run with account-scoped idempotency and opaque pagination", () => {
    const request: WeReadBooksSyncRequest = {
      requestId: "request-account-a-1",
      cursor: "opaque/page-2",
    };
    const response: WeReadBooksSyncResponse = { run: runningBooksRun };
    const status: WeReadSyncStatusResponse = { run: runningBooksRun };

    expect(request.requestId).toBe("request-account-a-1");
    expect(request.cursor).toBe("opaque/page-2");
    expect(response.run.operation).toBe("books");
    expect(response.run.nextCursor).toBe("opaque/page-2");
    expect(status.run.runId).toBe("run-books-a");
    expect(JSON.parse(JSON.stringify({ request, response, status }))).toEqual({
      request,
      response,
      status,
    });
  });

  it("keeps the complete books snapshot multi-record and read pagination opaque", () => {
    const request: WeReadBooksSnapshotRequest = { cursor: "opaque/read-page-2" };
    const response: WeReadBooksSnapshotResponse = {
      status: "success",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: "opaque/read-page-2",
      nextCursor: null,
      books: [book, { ...book, externalId: "book-b", title: "另一本书" }],
    };

    expect(response.books).toHaveLength(2);
    expect(response.books.map((item) => item.externalId)).toEqual(["book-a", "book-b"]);
    expect(response.cursor).toBe("opaque/read-page-2");
    expect(response.nextCursor).toBeNull();
    expect(JSON.parse(JSON.stringify({ request, response }))).toEqual({ request, response });
  });

  it("returns only the last complete books snapshot while a run is paused", () => {
    const response: WeReadBooksSnapshotResponse = {
      status: "paused",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: "opaque/page-2",
      nextCursor: null,
      books: [book],
      pause,
    };

    expect(response.status).toBe("paused");
    expect(response.snapshot).toBe("last_success");
    expect(response.books).toHaveLength(1);
    expect(response.nextCursor).toBeNull();
    expect(response.pause.errcode).toBe(426);
    expect(response.pause.upgradeInfo).toBe("upgrade skill");
  });

  it("keeps retryable failure metadata separate from a preserved books snapshot", () => {
    const error: WeReadApiError = {
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    };
    const response: WeReadBooksSnapshotResponse = {
      status: "failed",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: "opaque/page-2",
      nextCursor: null,
      books: [book],
      error,
    };

    expect(response.status).toBe("failed");
    expect(response.snapshot).toBe("last_success");
    expect(response.error.retryable).toBe(true);
    expect(response.books[0]?.externalId).toBe("book-a");
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });

  it("requires explicit single-book annotation sync and preserves its last snapshot", () => {
    const request: WeReadAnnotationsSyncRequest = {
      requestId: "request-account-a-annotations-1",
      bookId: "book-a",
    };
    const run: WeReadSyncRunProjection = {
      runId: "run-annotations-a",
      requestId: request.requestId,
      operation: "annotations",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      status: "running",
      snapshot: "none",
      cursor: null,
      nextCursor: null,
      retryCount: 0,
      bookId: request.bookId,
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-01-02T03:04:06.000Z",
    };
    const accepted: WeReadAnnotationsSyncResponse = { run };
    const snapshot: WeReadAnnotationsSnapshotResponse = {
      status: "success",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      bookId: "book-a",
      annotations: [annotation, { ...annotation, externalId: "annotation-b" }],
    };

    expect(request.bookId).toBe("book-a");
    expect(accepted.run.operation).toBe("annotations");
    expect(accepted.run.bookId).toBe("book-a");
    expect(snapshot.annotations).toHaveLength(2);
    expect(snapshot.annotations.every((item) => item.bookExternalId === "book-a")).toBe(true);
    expect(JSON.parse(JSON.stringify({ request, accepted, snapshot }))).toEqual({
      request,
      accepted,
      snapshot,
    });

    const readRequest: WeReadAnnotationsSnapshotRequest = { bookId: "book-a" };
    expect(readRequest.bookId).toBe("book-a");
  });

  it("exposes paused annotation snapshots without an empty location or secret", () => {
    const response: WeReadAnnotationsSnapshotResponse = {
      status: "paused",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      bookId: "book-a",
      annotations: [{ ...annotation, location: null }],
      pause,
    };

    expect(response.snapshot).toBe("last_success");
    expect(response.annotations[0]?.location).toBeNull();
    expect(response.pause.reason).toBe("upgrade_required");
    expect(JSON.stringify(response)).not.toContain("wrk-a-secret");
  });
});
