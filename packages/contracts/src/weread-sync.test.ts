import { describe, expect, it } from "vitest";
import {
  WEREAD_CURSOR_SEMANTICS,
  WEREAD_PROGRESS_UNIT,
  WEREAD_TIMESTAMP_UNIT,
  type WeReadAnnotation,
  type WeReadBook,
  type WeReadSyncPage,
} from "./weread-sync";

describe("shared WeRead data contract", () => {
  it("keeps multi-record page and annotation shapes JSON-compatible", () => {
    const book: WeReadBook = {
      externalId: "book-a",
      title: "一本书",
      author: "作者",
      coverUrl: "https://cdn.example.test/book-a.jpg",
      progressPercent: 43,
      lastReadAt: "2024-01-02T03:04:05.000Z",
    };
    const annotation: WeReadAnnotation = {
      externalId: "annotation-a",
      bookExternalId: "book-a",
      quote: "重要的一句",
      thought: "我的想法",
      location: "第一章",
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-01-02T03:05:05.000Z",
    };
    const page: WeReadSyncPage = {
      status: "success",
      snapshot: "fresh",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: null,
      nextCursor: "cursor:opaque/二",
      books: [book, { ...book, externalId: "book-b", title: "另一本书" }],
    };

    expect(page.books).toHaveLength(2);
    expect(page.nextCursor).toBe("cursor:opaque/二");
    expect(WEREAD_CURSOR_SEMANTICS).toBe("opaque");
    expect(WEREAD_PROGRESS_UNIT).toBe("percent");
    expect(WEREAD_TIMESTAMP_UNIT).toBe("iso-8601-utc");
    expect(book.progressPercent).toBe(43);
    expect(book.lastReadAt).toMatch(/T.*Z$/);
    expect(annotation.bookExternalId).toBe(book.externalId);
    expect(JSON.parse(JSON.stringify({ page, annotation }))).toEqual({ page, annotation });
  });

  it("models an upgrade pause as a last-success snapshot without changing success shape", () => {
    const paused: WeReadSyncPage = {
      status: "paused",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      cursor: "opaque-cursor",
      nextCursor: null,
      books: [],
      pause: {
        reason: "upgrade_required",
        errcode: 426,
        upgradeInfo: "upgrade skill",
      },
    };

    expect(paused.status).toBe("paused");
    expect(paused.snapshot).toBe("last_success");
    expect(paused.pause?.reason).toBe("upgrade_required");
    expect(paused.nextCursor).toBeNull();
  });
});
