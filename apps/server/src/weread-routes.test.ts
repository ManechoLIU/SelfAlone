import { describe, expect, it } from "vitest";
import type {
  WeReadAnnotationsSyncRunProjection,
  WeReadBookProjection,
  WeReadBooksSyncRunProjection,
  WeReadConnectionProjection,
} from "@selfalone/contracts";
import { createApp } from "./app";
import { WeReadRouteError, type WeReadRouteRuntime } from "./weread-routes";

const connection: WeReadConnectionProjection = {
  connectionId: "connection-a",
  accountExternalId: "weread-account-a",
  apiKeyHint: "••••cret",
  status: "verified",
  verifiedAt: "2026-09-01T10:00:00.000Z",
  revision: "3",
};

const booksRun: WeReadBooksSyncRunProjection = {
  runId: "run-books-a",
  requestId: "request-books-a",
  operation: "books",
  connectionId: connection.connectionId,
  accountExternalId: connection.accountExternalId,
  status: "running",
  snapshot: "none",
  cursor: null,
  nextCursor: null,
  retryCount: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const book: WeReadBookProjection = {
  bookId: "book-local-a",
  externalId: "book-external-a",
  title: "一本书",
  author: "作者",
  coverUrl: null,
  progressPercent: 42,
  lastReadAt: "2026-09-01T09:00:00.000Z",
};

const annotationsRun: WeReadAnnotationsSyncRunProjection = {
  ...booksRun,
  runId: "run-annotations-a",
  requestId: "request-annotations-a",
  operation: "annotations",
  bookId: book.bookId,
  bookExternalId: book.externalId,
};

describe("WeRead HTTP routes", () => {
  it("account-scopes a strict connection replacement without reflecting the raw key", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async putConnection(accountId, input) {
          calls.push({ accountId, input });
          return { connection, sync: { run: booksRun } };
        },
      }),
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/weread/connection",
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        apiKey: "wrk-a-secret",
        requestId: "request-connect-a",
        expectedRevision: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connection, sync: { run: booksRun } });
    expect(response.body).not.toContain("wrk-a-secret");
    expect(calls).toEqual([{
      accountId: "account-a",
      input: {
        apiKey: "wrk-a-secret",
        requestId: "request-connect-a",
        expectedRevision: null,
      },
    }]);
    await app.close();
  });

  it("returns 202 for an account-scoped books sync with an opaque cursor", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async syncBooks(accountId, input) {
          calls.push({ accountId, input });
          return { run: { ...booksRun, cursor: "opaque/page-2" } };
        },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/weread/sync/books",
      headers: { "x-selfalone-account": "account-a" },
      payload: { requestId: "request-books-a", cursor: "opaque/page-2" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().run.cursor).toBe("opaque/page-2");
    expect(calls).toEqual([{
      accountId: "account-a",
      input: { requestId: "request-books-a", cursor: "opaque/page-2" },
    }]);
    await app.close();
  });

  it("routes connection reads and revision-guarded disconnects", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async getConnection(accountId) {
          calls.push({ operation: "get", accountId });
          return { connection };
        },
        async deleteConnection(accountId, input) {
          calls.push({ operation: "delete", accountId, input });
          return { status: "disconnected" as const };
        },
      }),
    });

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/weread/connection",
      headers: { "x-selfalone-account": "account-a" },
    });
    const disconnected = await app.inject({
      method: "DELETE",
      url: "/api/v1/weread/connection",
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedRevision: "3" },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ connection });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json()).toEqual({ status: "disconnected" });
    expect(calls).toEqual([
      { operation: "get", accountId: "account-a" },
      { operation: "delete", accountId: "account-a", input: { expectedRevision: "3" } },
    ]);
    await app.close();
  });

  it("routes the last complete books snapshot and account-owned run status", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async getBooksSnapshot(accountId, input) {
          calls.push({ operation: "books", accountId, input });
          return {
            status: "success" as const,
            snapshot: "last_success" as const,
            connectionId: connection.connectionId,
            accountExternalId: connection.accountExternalId,
            cursor: "opaque/read-2",
            nextCursor: null,
            books: [book],
          };
        },
        async getSyncStatus(accountId, runId) {
          calls.push({ operation: "status", accountId, runId });
          return { run: booksRun };
        },
      }),
    });

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/v1/weread/books?cursor=opaque%2Fread-2",
      headers: { "x-selfalone-account": "account-a" },
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/v1/weread/sync/run-books-a",
      headers: { "x-selfalone-account": "account-a" },
    });

    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().books).toEqual([book]);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ run: booksRun });
    expect(calls).toEqual([
      { operation: "books", accountId: "account-a", input: { cursor: "opaque/read-2" } },
      { operation: "status", accountId: "account-a", runId: "run-books-a" },
    ]);
    await app.close();
  });

  it("routes explicit local-book annotation sync and snapshot reads", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async syncAnnotations(accountId, input) {
          calls.push({ operation: "sync", accountId, input });
          return { run: annotationsRun };
        },
        async getAnnotationsSnapshot(accountId, input) {
          calls.push({ operation: "snapshot", accountId, input });
          return {
            status: "success" as const,
            snapshot: "last_success" as const,
            connectionId: connection.connectionId,
            accountExternalId: connection.accountExternalId,
            bookId: book.bookId,
            bookExternalId: book.externalId,
            annotations: [],
          };
        },
      }),
    });

    const sync = await app.inject({
      method: "POST",
      url: "/api/v1/weread/sync/annotations",
      headers: { "x-selfalone-account": "account-a" },
      payload: { requestId: "request-annotations-a", bookId: book.bookId },
    });
    const snapshot = await app.inject({
      method: "GET",
      url: `/api/v1/weread/annotations?bookId=${book.bookId}`,
      headers: { "x-selfalone-account": "account-a" },
    });

    expect(sync.statusCode).toBe(202);
    expect(sync.json()).toEqual({ run: annotationsRun });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().bookExternalId).toBe(book.externalId);
    expect(calls).toEqual([
      {
        operation: "sync",
        accountId: "account-a",
        input: { requestId: "request-annotations-a", bookId: book.bookId },
      },
      { operation: "snapshot", accountId: "account-a", input: { bookId: book.bookId } },
    ]);
    await app.close();
  });

  it("rejects extra credential fields before the runtime receives a raw key", async () => {
    let putCalls = 0;
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async putConnection() {
          putCalls += 1;
          return { connection, sync: { run: booksRun } };
        },
      }),
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/weread/connection",
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        apiKey: "wrk-a-secret",
        requestId: "request-connect-a",
        expectedRevision: null,
        providerUrl: "https://attacker.invalid",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_FAILED",
      message: "请求格式无效",
      retryable: false,
    });
    expect(response.body).not.toContain("wrk-a-secret");
    expect(putCalls).toBe(0);
    await app.close();
  });

  it("returns a safe retryable provider error without reflecting the credential", async () => {
    const app = createApp({
      readiness: async () => true,
      weread: runtime({
        async putConnection() {
          throw new WeReadRouteError({
            code: "EXTERNAL_SERVICE_FAILED",
            message: "微信读书暂时不可用",
            retryable: true,
          });
        },
      }),
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/weread/connection",
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        apiKey: "wrk-a-secret",
        requestId: "request-connect-a",
        expectedRevision: null,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: "EXTERNAL_SERVICE_FAILED",
      message: "微信读书暂时不可用",
      retryable: true,
    });
    expect(response.body).not.toContain("wrk-a-secret");
    await app.close();
  });
});

function runtime(overrides: Partial<WeReadRouteRuntime>): WeReadRouteRuntime {
  return {
    async getConnection() { return { connection: null }; },
    async putConnection() { return { connection, sync: { run: booksRun } }; },
    async deleteConnection() { return { status: "disconnected" as const }; },
    async syncBooks() { return { run: booksRun }; },
    async getBooksSnapshot() {
      return {
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
        cursor: null,
        nextCursor: null,
        books: [],
      };
    },
    async getSyncStatus() { return { run: booksRun }; },
    async syncAnnotations() { throw new Error("NOT_IMPLEMENTED"); },
    async getAnnotationsSnapshot() { throw new Error("NOT_IMPLEMENTED"); },
    ...overrides,
  };
}
