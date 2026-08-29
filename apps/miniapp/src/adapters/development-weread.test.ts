import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeReadConnectionProjection } from "../core/weread-state";
import { createDevelopmentWeReadPort } from "./development-weread";

type Port = ReturnType<typeof createDevelopmentWeReadPort>;

type ConnectInput = {
  apiKey: string;
  requestId: string;
  expectedRevision: string | null;
};

/**
 * The development QA path is deterministic: the first attempt for a fresh
 * requestId fails retryable, and a retry with the SAME requestId succeeds.
 */
async function connectWithRetry(port: Port, input: ConnectInput): Promise<WeReadConnectionProjection> {
  await expect(port.putConnection(input)).rejects.toMatchObject({
    code: "EXTERNAL_SERVICE_FAILED",
    retryable: true,
  });
  const response = await port.putConnection(input);
  return response.connection;
}

describe("Mini development WeRead port", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects after a deterministic fail-once with the same requestId and hydrates the shelf", async () => {
    const port = createDevelopmentWeReadPort();
    await expect(port.getConnection()).resolves.toEqual({ connection: null });

    const connection = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-connect-a",
      expectedRevision: null,
    });
    expect(connection).toMatchObject({
      accountExternalId: "weread-dev-account-a",
      status: "verified",
    });

    // Idempotent replay: the same requestId keeps returning the first result.
    const replayed = await port.putConnection({
      apiKey: "wrk-dev-a",
      requestId: "req-connect-a",
      expectedRevision: null,
    });
    expect(replayed.connection).toEqual(connection);

    await expect(port.getConnection()).resolves.toEqual({ connection });

    const books = await port.getBooks();
    expect(books).toMatchObject({
      status: "success",
      snapshot: "last_success",
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      nextCursor: null,
    });
    expect(books.books.length).toBeGreaterThan(0);
    for (const book of books.books) {
      expect(book.bookId).toBe(`weread:${book.externalId}`);
    }
    await expect(port.getBooks({ cursor: null })).resolves.toEqual(books);

    const first = books.books[0]!;
    const annotations = await port.getAnnotations({ bookId: first.bookId });
    expect(annotations).toMatchObject({
      status: "success",
      snapshot: "last_success",
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      bookId: first.bookId,
      bookExternalId: first.externalId,
    });
    expect(annotations.annotations.length).toBeGreaterThan(0);
    for (const annotation of annotations.annotations) {
      expect(annotation.bookExternalId).toBe(first.externalId);
    }
  });

  it("replaces account A with account B and isolates shelves and annotations", async () => {
    const port = createDevelopmentWeReadPort();
    const connectionA = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-replace-a",
      expectedRevision: null,
    });
    const booksA = await port.getBooks();
    const annotationsA = await port.getAnnotations({ bookId: booksA.books[0]!.bookId });

    const connectionB = await connectWithRetry(port, {
      apiKey: "wrk-dev-b",
      requestId: "req-replace-b",
      expectedRevision: connectionA.revision,
    });
    expect(connectionB.accountExternalId).toBe("weread-dev-account-b");
    expect(connectionB.revision).not.toBe(connectionA.revision);
    await expect(port.getConnection()).resolves.toEqual({ connection: connectionB });

    const booksB = await port.getBooks();
    expect(booksB.accountExternalId).toBe("weread-dev-account-b");
    expect(booksB.books.length).toBeGreaterThan(0);
    const idsA = new Set(booksA.books.map((book) => book.bookId));
    for (const book of booksB.books) {
      expect(idsA.has(book.bookId)).toBe(false);
    }

    // Account A content is unreachable while account B is active.
    await expect(port.getAnnotations({ bookId: booksA.books[0]!.bookId }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
    const annotationsB = await port.getAnnotations({ bookId: booksB.books[0]!.bookId });
    expect(annotationsB.annotations.map((annotation) => annotation.externalId))
      .not.toEqual(annotationsA.annotations.map((annotation) => annotation.externalId));
  });

  it("fails closed on invalid keys and stale revisions without mutating state", async () => {
    const port = createDevelopmentWeReadPort();

    // Invalid fake values fail deterministically, not via the fail-once path.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(port.putConnection({
        apiKey: "wrk-dev-unknown",
        requestId: `req-invalid-${attempt}`,
        expectedRevision: null,
      })).rejects.toMatchObject({ code: "EXTERNAL_AUTH_REQUIRED", retryable: false });
    }
    await expect(port.getConnection()).resolves.toEqual({ connection: null });

    const connectionA = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-stale-a",
      expectedRevision: null,
    });
    await expect(port.putConnection({
      apiKey: "wrk-dev-b",
      requestId: "req-stale-b",
      expectedRevision: "999",
    })).rejects.toMatchObject({ code: "CONFLICT", retryable: false });
    await expect(port.getConnection()).resolves.toEqual({ connection: connectionA });
  });

  it("disconnects and then fails closed for shelf, annotations, and repeated delete", async () => {
    const port = createDevelopmentWeReadPort();
    const connection = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-disconnect-a",
      expectedRevision: null,
    });

    await expect(port.deleteConnection({ expectedRevision: "999" }))
      .rejects.toMatchObject({ code: "CONFLICT", retryable: false });
    await expect(port.deleteConnection({ expectedRevision: connection.revision }))
      .resolves.toEqual({ status: "disconnected" });

    await expect(port.getConnection()).resolves.toEqual({ connection: null });
    await expect(port.getBooks()).rejects.toMatchObject({ code: "EXTERNAL_AUTH_REQUIRED", retryable: false });
    await expect(port.getAnnotations({ bookId: "weread:wr-dev-book-a-quiet" }))
      .rejects.toMatchObject({ code: "EXTERNAL_AUTH_REQUIRED", retryable: false });
    await expect(port.deleteConnection({ expectedRevision: connection.revision }))
      .rejects.toMatchObject({ code: "CONFLICT", retryable: false });
  });

  it("supports sync runs, idempotent replay, and sync status lookup", async () => {
    const port = createDevelopmentWeReadPort();
    await expect(port.syncBooks({ requestId: "req-sync-disconnected" }))
      .rejects.toMatchObject({ code: "EXTERNAL_AUTH_REQUIRED", retryable: false });

    const connection = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-sync-connect",
      expectedRevision: null,
    });

    const booksRun = (await port.syncBooks({ requestId: "req-sync-books" })).run;
    expect(booksRun).toMatchObject({
      requestId: "req-sync-books",
      operation: "books",
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      status: "completed",
      snapshot: "fresh",
      nextCursor: null,
    });
    const replayed = (await port.syncBooks({ requestId: "req-sync-books" })).run;
    expect(replayed.runId).toBe(booksRun.runId);
    await expect(port.getSyncStatus(booksRun.runId)).resolves.toEqual({ run: booksRun });

    const books = await port.getBooks();
    const first = books.books[0]!;
    const annotationsRun = (await port.syncAnnotations({
      requestId: "req-sync-annotations",
      bookId: first.bookId,
    })).run;
    expect(annotationsRun).toMatchObject({
      requestId: "req-sync-annotations",
      operation: "annotations",
      bookId: first.bookId,
      bookExternalId: first.externalId,
      status: "completed",
      snapshot: "fresh",
    });
    await expect(port.getSyncStatus(annotationsRun.runId)).resolves.toEqual({ run: annotationsRun });

    await expect(port.syncAnnotations({ requestId: "req-sync-missing", bookId: "weread:wr-dev-book-missing" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
    await expect(port.getSyncStatus("dev-wr-run-unknown"))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
  });

  it("stays deterministic in memory and never touches network or persistent storage", async () => {
    const request = vi.fn(() => { throw new Error("wx.request must not be called"); });
    const getStorageSync = vi.fn(() => { throw new Error("wx.getStorageSync must not be called"); });
    const setStorageSync = vi.fn(() => { throw new Error("wx.setStorageSync must not be called"); });
    vi.stubGlobal("wx", { request, getStorageSync, setStorageSync });
    const fetchSpy = vi.fn(() => { throw new Error("fetch must not be called"); });
    vi.stubGlobal("fetch", fetchSpy);

    const port = createDevelopmentWeReadPort();
    const connectionA = await connectWithRetry(port, {
      apiKey: "wrk-dev-a",
      requestId: "req-isolation-a",
      expectedRevision: null,
    });
    await port.getBooks();
    const booksA = await port.getBooks();
    await port.getAnnotations({ bookId: booksA.books[0]!.bookId });
    await connectWithRetry(port, {
      apiKey: "wrk-dev-b",
      requestId: "req-isolation-b",
      expectedRevision: connectionA.revision,
    });
    await port.deleteConnection({
      expectedRevision: (await port.getConnection()).connection!.revision,
    });

    expect(request).not.toHaveBeenCalled();
    expect(getStorageSync).not.toHaveBeenCalled();
    expect(setStorageSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // State lives only in memory: a fresh port starts disconnected.
    const fresh = createDevelopmentWeReadPort();
    await expect(fresh.getConnection()).resolves.toEqual({ connection: null });
  });
});
