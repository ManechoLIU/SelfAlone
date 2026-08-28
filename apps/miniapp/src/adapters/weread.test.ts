import { describe, expect, it, vi } from "vitest";
import {
  createNoCallWeReadPort,
  createWeReadAdapter,
  type WeReadPort,
} from "./weread";

const connection = {
  connectionId: "connection-a",
  accountExternalId: "weread-account-a",
  apiKeyHint: "wrk-••••••••",
  status: "verified" as const,
  verifiedAt: "2024-01-02T03:04:05.000Z",
  revision: "3",
};

function portFixture(): WeReadPort {
  return {
    getConnection: vi.fn(async () => ({ connection })),
    putConnection: vi.fn(async (input) => ({
      connection,
      sync: {
        run: {
          runId: "run-books-a",
          requestId: input.requestId,
          operation: "books" as const,
          connectionId: connection.connectionId,
          accountExternalId: connection.accountExternalId,
          status: "queued" as const,
          snapshot: "none" as const,
          cursor: null,
          nextCursor: null,
          retryCount: 0,
          createdAt: connection.verifiedAt,
          updatedAt: connection.verifiedAt,
        },
      },
    })),
    deleteConnection: vi.fn(async () => ({ status: "disconnected" as const })),
    getBooks: vi.fn(async () => ({
      status: "success" as const,
      snapshot: "last_success" as const,
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      cursor: null,
      nextCursor: null,
      books: [],
    })),
    syncBooks: vi.fn(async () => ({
      run: {
        runId: "run-books-a",
        requestId: "request-a",
        operation: "books" as const,
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
        status: "running" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: connection.verifiedAt,
        updatedAt: connection.verifiedAt,
      },
    })),
    getAnnotations: vi.fn(async ({ bookId }) => ({
      status: "success" as const,
      snapshot: "last_success" as const,
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      bookId,
      bookExternalId: "weread-book-a",
      annotations: [],
    })),
    syncAnnotations: vi.fn(async ({ bookId }) => ({
      run: {
        runId: "run-annotations-a",
        requestId: "request-a",
        operation: "annotations" as const,
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
        bookId,
        bookExternalId: "weread-book-a",
        status: "running" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: connection.verifiedAt,
        updatedAt: connection.verifiedAt,
      },
    })),
    getSyncStatus: vi.fn(async () => ({ run: {} as never })),
  };
}

describe("Mini WeRead contract adapter", () => {
  it("forwards contract-shaped connection, book, and annotation calls without inventing an HTTP route", async () => {
    const port = portFixture();
    const client = createWeReadAdapter(port);
    await client.getConnection();
    await client.putConnection({ apiKey: "wrk-secret", requestId: "request-a", expectedRevision: null });
    await client.getBooks({ cursor: null });
    await client.syncBooks({ requestId: "request-a", cursor: null });
    await client.getAnnotations({ bookId: "weread:weread-book-a" });
    await client.syncAnnotations({ requestId: "request-a", bookId: "weread:weread-book-a" });

    expect(port.putConnection).toHaveBeenCalledWith({ apiKey: "wrk-secret", requestId: "request-a", expectedRevision: null });
    expect(port.getBooks).toHaveBeenCalledWith({ cursor: null });
    expect(port.getAnnotations).toHaveBeenCalledWith({ bookId: "weread:weread-book-a" });
  });

  it("fails closed through a no-call port and never touches wx.request", async () => {
    const request = vi.fn(() => { throw new Error("wx.request must not be called"); });
    vi.stubGlobal("wx", { request });
    const client = createWeReadAdapter(createNoCallWeReadPort());

    await expect(client.getConnection()).resolves.toEqual({ connection: null });
    await expect(client.putConnection({ apiKey: "wrk-secret", requestId: "request-a", expectedRevision: null }))
      .rejects.toMatchObject({ code: "WEREAD_NO_CALL" });
    expect(request).not.toHaveBeenCalled();
  });
});
