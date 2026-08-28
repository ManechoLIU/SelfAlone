import { describe, expect, it } from "vitest";
import type {
  WeReadAnnotation,
  WeReadBooksSnapshotResponse,
  WeReadConnectionProjection,
} from "@selfalone/contracts";
import {
  applyWeReadAnnotationsSnapshot,
  applyWeReadBooksSnapshot,
  createWeReadState,
  failWeReadOperation,
  parseWeReadState,
  resolveWeReadConnection,
  serializeWeReadState,
} from "./weread-state";

const connection: WeReadConnectionProjection = {
  connectionId: "connection-1",
  accountExternalId: "account-1",
  apiKeyHint: "••••1234",
  status: "verified",
  verifiedAt: "2026-08-28T00:00:00.000Z",
  revision: "revision-1",
};

const book = {
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

const booksSuccess: WeReadBooksSnapshotResponse = {
  connectionId: connection.connectionId,
  accountExternalId: connection.accountExternalId,
  cursor: null,
  nextCursor: null,
  books: [book],
  status: "success",
  snapshot: "last_success",
};

describe("desktop WeRead state", () => {
  it("persists safe snapshots while dropping the raw connection draft", () => {
    const state = createWeReadState({
      view: "connection",
      connection,
      books: [book],
      annotations: { [book.externalId]: [annotation] },
      draftApiKey: "local-only-secret",
      error: "上次同步失败，数据已保留。",
    });

    const encoded = serializeWeReadState(state);
    expect(encoded).not.toContain("local-only-secret");
    expect(parseWeReadState(encoded)).toMatchObject({
      connection,
      books: [book],
      annotations: { [book.externalId]: [annotation] },
      draftApiKey: "",
      error: "上次同步失败，数据已保留。",
    });
  });

  it("moves a verified connection into syncing without retaining the raw key", () => {
    const state = createWeReadState({ view: "connection", draftApiKey: "local-only-secret" });
    const next = resolveWeReadConnection(state, {
      connection,
      sync: {
        run: {
          runId: "run-books-1",
          requestId: "request-connect-1",
          operation: "books",
          connectionId: connection.connectionId,
          accountExternalId: connection.accountExternalId,
          status: "queued",
          snapshot: "none",
          cursor: null,
          nextCursor: null,
          retryCount: 0,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    });

    expect(next.connection).toEqual(connection);
    expect(next.phase).toBe("syncing");
    expect(next.draftApiKey).toBe("");
  });

  it("keeps the last books and notes visible when a later sync fails", () => {
    const ready = applyWeReadAnnotationsSnapshot(
      applyWeReadBooksSnapshot(createWeReadState({ connection }), booksSuccess),
      {
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
        bookId: "local-book-1",
        bookExternalId: book.externalId,
        annotations: [annotation],
        status: "success",
        snapshot: "last_success",
      },
    );
    const failed = applyWeReadBooksSnapshot(
      { ...ready, phase: "syncing" },
      {
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
        cursor: null,
        nextCursor: null,
        books: [book],
        status: "failed",
        snapshot: "last_success",
        error: {
          code: "EXTERNAL_SERVICE_FAILED",
          message: "同步服务暂时不可用",
          retryable: true,
        },
      },
    );

    expect(failed.phase).toBe("failed");
    expect(failed.books).toEqual([book]);
    expect(failed.annotations[book.externalId]).toEqual([annotation]);
    expect(failed.error).toContain("同步服务暂时不可用");
  });

  it("retains the current snapshot and draft when a connection mutation fails", () => {
    const state = createWeReadState({
      connection,
      books: [book],
      draftApiKey: "retry-key",
      phase: "saving",
    });
    const failed = failWeReadOperation(state, new Error("EXTERNAL_AUTH_REQUIRED"));

    expect(failed.phase).toBe("failed");
    expect(failed.draftApiKey).toBe("retry-key");
    expect(failed.books).toEqual([book]);
    expect(failed.error).toContain("微信读书连接未完成");
  });
});
