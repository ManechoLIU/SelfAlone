import { describe, expect, it } from "vitest";
import {
  mapWeReadAnnotation,
  mapWeReadBook,
  mergeWeReadBooks,
  annotationsFromSnapshot,
  presentWeReadSync,
  preserveWeReadOnFailure,
  type WeReadBooksSnapshotResponse,
  type WeReadConnectionProjection,
} from "./weread-state";

const connection: WeReadConnectionProjection = {
  connectionId: "connection-a",
  accountExternalId: "weread-account-a",
  apiKeyHint: "wrk-••••••••",
  status: "verified",
  verifiedAt: "2024-01-02T03:04:05.000Z",
  revision: "3",
};

const book = {
  bookId: "local-book-a",
  externalId: "weread-book-a",
  title: "一本书",
  author: "作者",
  coverUrl: "https://cdn.example.test/book-a.jpg",
  progressPercent: 43,
  lastReadAt: "2024-01-02T03:04:05.000Z",
} as const;

const annotation = {
  externalId: "annotation-a",
  bookExternalId: "weread-book-a",
  quote: "重要的一句",
  thought: "我的想法",
  location: "第一章",
  createdAt: "2024-01-02T03:04:05.000Z",
  updatedAt: "2024-01-02T03:05:05.000Z",
} as const;

describe("Mini WeRead state mapping", () => {
  it("maps provider books to unified shelf records without losing cover or percent progress", () => {
    expect(mapWeReadBook(book)).toEqual(expect.objectContaining({
      id: "local-book-a",
      title: "一本书",
      author: "作者",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.43,
      coverUrl: "https://cdn.example.test/book-a.jpg",
      wereadExternalId: "weread-book-a",
      progressKnown: true,
    }));
  });

  it("does not present an unknown provider progress value as 0%", () => {
    const mapped = mapWeReadBook({ ...book, bookId: "local-book-unknown", progressPercent: null });

    expect(mapped).toEqual(expect.objectContaining({
      id: "local-book-unknown",
      progress: 0,
      progressKnown: false,
    }));
  });

  it("keeps synced annotation quote, thought, and optional location for book detail", () => {
    expect(mapWeReadAnnotation(annotation)).toEqual({
      id: "annotation-a",
      bookId: "weread:weread-book-a",
      quote: "重要的一句",
      thought: "我的想法",
      location: "第一章",
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-01-02T03:05:05.000Z",
    });
  });

  it("uses the snapshot local book id while retaining provider ids in annotations", () => {
    expect(annotationsFromSnapshot({
      status: "success",
      snapshot: "last_success",
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      bookId: "local-book-a",
      bookExternalId: "weread-book-a",
      annotations: [annotation],
    })).toEqual([expect.objectContaining({
      id: "annotation-a",
      bookId: "local-book-a",
    })]);
  });

  it("mixes WeRead records into the local shelf without dropping either source", () => {
    const local = {
      id: "local-book",
      title: "本地书",
      author: "本地作者",
      source: "local" as const,
      sourceLabel: "本地",
      format: "txt" as const,
      progress: 0.2,
      coverVariant: 0,
    };
    expect(mergeWeReadBooks([local], [mapWeReadBook(book)])).toEqual([local, expect.objectContaining({ source: "weread" })]);
  });

  it("exposes a retryable failure while preserving the last successful shelf snapshot", () => {
    const snapshot: WeReadBooksSnapshotResponse = {
      status: "failed",
      snapshot: "last_success",
      connectionId: connection.connectionId,
      accountExternalId: connection.accountExternalId,
      cursor: null,
      nextCursor: null,
      books: [book],
      error: { code: "EXTERNAL_SERVICE_FAILED", message: "微信读书暂时不可用", retryable: true },
    };
    expect(presentWeReadSync(snapshot)).toEqual({ status: "failed", label: "同步失败", message: "微信读书暂时不可用" });
    expect(preserveWeReadOnFailure([mapWeReadBook(book)], "同步失败")).toEqual({
      books: [mapWeReadBook(book)],
      notice: "同步失败",
    });
  });
});
