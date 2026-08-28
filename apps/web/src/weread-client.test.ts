import { describe, expect, it } from "vitest";
import type {
  WeReadAnnotation,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncResponse,
  WeReadBooksSnapshotResponse,
  WeReadBooksSyncResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionPutResponse,
  WeReadSyncStatusResponse,
} from "@selfalone/contracts";
import {
  createNoCallWeReadClient,
  createWeReadClient,
  type WeReadClientPort,
} from "./weread-client";

const connection = {
  connectionId: "connection-1",
  accountExternalId: "account-1",
  apiKeyHint: "••••1234",
  status: "verified" as const,
  verifiedAt: "2026-08-28T00:00:00.000Z",
  revision: "revision-1",
};

const book = {
  bookId: "local-book-1",
  externalId: "weread-book-1",
  title: "置身事内",
  author: "兰小欢",
  coverUrl: "/book-covers/local-default-celadon-ink-v1.png",
  progressPercent: 63,
  lastReadAt: "2026-08-27T08:00:00.000Z",
};

const annotation: WeReadAnnotation = {
  externalId: "weread-note-1",
  bookExternalId: book.externalId,
  quote: "理解一个系统，先看它的激励。",
  thought: "先看激励，再看结果。",
  location: "第 3 章",
  createdAt: "2026-08-27T08:10:00.000Z",
  updatedAt: "2026-08-27T08:10:00.000Z",
};

const run = {
  runId: "run-1",
  requestId: "request-1",
  operation: "books" as const,
  connectionId: connection.connectionId,
  accountExternalId: connection.accountExternalId,
  status: "completed" as const,
  snapshot: "fresh" as const,
  cursor: null,
  nextCursor: null,
  retryCount: 0,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  completedAt: "2026-08-28T00:00:00.000Z",
};

function unusedPort(): WeReadClientPort {
  return {
    getConnection: async () => ({ connection }),
    putConnection: async () => ({ connection, sync: { run } }),
    deleteConnection: async () => ({ status: "disconnected" }),
    syncBooks: async () => ({ run }),
    getBooksSnapshot: async () => ({
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      cursor: null,
      nextCursor: null,
      books: [book],
      status: "success",
      snapshot: "last_success",
    }),
    getSyncStatus: async () => ({ run }),
    syncAnnotations: async () => ({
      run: {
        ...run,
        runId: "run-annotations-1",
        operation: "annotations",
        bookId: "local-book-1",
        bookExternalId: book.externalId,
      },
    }),
    getAnnotationsSnapshot: async () => ({
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      bookId: "local-book-1",
      bookExternalId: book.externalId,
      annotations: [annotation],
      status: "success",
      snapshot: "last_success",
    }),
  };
}

describe("desktop WeRead client port", () => {
  it("starts a fresh no-call client disconnected without demo books", async () => {
    const client = createNoCallWeReadClient();

    await expect(client.getConnection()).resolves.toEqual({ connection: null });
    await expect(client.getBooksSnapshot()).rejects.toThrow("EXTERNAL_AUTH_REQUIRED");
  });

  it("forwards the JSON-contract operations through an injected port", async () => {
    const calls: string[] = [];
    const port = unusedPort();
    const client = createWeReadClient({
      ...port,
      getConnection: async () => {
        calls.push("getConnection");
        return port.getConnection();
      },
      getBooksSnapshot: async () => {
        calls.push("getBooksSnapshot");
        return port.getBooksSnapshot();
      },
      getAnnotationsSnapshot: async (input) => {
        calls.push(`getAnnotationsSnapshot:${input.bookId}`);
        return port.getAnnotationsSnapshot(input);
      },
    });

    await expect(client.getConnection()).resolves.toEqual({ connection });
    await expect(client.getBooksSnapshot()).resolves.toMatchObject({ books: [book] });
    await expect(client.getAnnotationsSnapshot({ bookId: "local-book-1" })).resolves.toMatchObject({
      annotations: [annotation],
    });
    expect(calls).toEqual([
      "getConnection",
      "getBooksSnapshot",
      "getAnnotationsSnapshot:local-book-1",
    ]);
  });

  it("provides deterministic local book and annotation data without a network call", async () => {
    const client = createNoCallWeReadClient({
      connection,
      books: [book],
      annotations: [annotation],
    });

    const snapshot = await client.getBooksSnapshot();
    const notes = await client.getAnnotationsSnapshot({ bookId: "local-book-1" });

    expect(snapshot.status).toBe("success");
    expect(snapshot.books).toEqual([book]);
    expect(notes.annotations).toEqual([annotation]);
    expect(JSON.stringify(snapshot)).not.toContain("1234");
  });

  it("rejects an unknown local book id instead of falling back to the first book", async () => {
    const client = createNoCallWeReadClient({
      connection,
      books: [book],
      annotations: [annotation],
    });

    await expect(client.getAnnotationsSnapshot({ bookId: "unknown-local-book" })).rejects.toThrow("VALIDATION_FAILED");
    await expect(client.getAnnotationsSnapshot({ bookId: book.externalId })).rejects.toThrow("VALIDATION_FAILED");
    await expect(client.syncAnnotations({ requestId: "request-annotations-unknown", bookId: "unknown-local-book" }))
      .rejects.toThrow("VALIDATION_FAILED");
  });

  it("supports an explicit no-call fail-once seam and accepts the same request id on retry", async () => {
    let consumed = 0;
    const client = createNoCallWeReadClient(
      { connection, books: [book], annotations: [annotation] },
      {
        failOnceOperation: "books",
        onFailOnceConsumed: () => { consumed += 1; },
      },
    );

    await expect(client.syncBooks({ requestId: "retry-books-1" })).rejects.toThrow("EXTERNAL_SERVICE_FAILED");
    await expect(client.syncBooks({ requestId: "retry-books-1" })).resolves.toMatchObject({
      run: { requestId: "retry-books-1", operation: "books", status: "completed" },
    });
    expect(consumed).toBe(1);
  });

  it("never returns the raw key when a local connection is replaced", async () => {
    const client = createNoCallWeReadClient({ connection: null, books: [], annotations: [] });

    const response = await client.putConnection({
      apiKey: "local-only-secret",
      requestId: "request-connect-1",
      expectedRevision: null,
    });

    expect(response.connection.apiKeyHint).toContain("••••");
    expect(JSON.stringify(response)).not.toContain("local-only-secret");
    expect(response.sync.run.operation).toBe("books");
  });
});
