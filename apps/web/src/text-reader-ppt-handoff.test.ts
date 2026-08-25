import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseTextReaderPptIntent,
  resolveTextReaderPptHandoff,
  textReaderPptConversationScrollPolicy,
} from "./text-reader-ppt-handoff";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

const seedWorkspace = {
  book: {
    id: "book-development-changan-lychee",
    title: "长安的荔枝",
  },
  draft: { id: "draft-1" },
};

const seedHash = "#/conversation?stage=requirements&book=book-development-changan-lychee&bookTitle=%E9%95%BF%E5%AE%89%E7%9A%84%E8%8D%94%E6%9E%9D";

describe("text reader PPT handoff", () => {
  it("parses a complete book-scoped intent with the exact id and title", () => {
    expect(parseTextReaderPptIntent(seedHash)).toEqual({
      status: "ready",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
    });
  });

  it("fails closed when either book id or title is missing", () => {
    expect(parseTextReaderPptIntent("#/conversation?stage=requirements&book=book-1")).toEqual({
      status: "blocked",
      reason: "BOOK_TITLE_MISSING",
    });
    expect(parseTextReaderPptIntent("#/conversation?stage=requirements&bookTitle=%E9%95%BF%E5%AE%89%E7%9A%84%E8%8D%94%E6%9E%9D")).toEqual({
      status: "blocked",
      reason: "BOOK_ID_MISSING",
    });
  });

  it("rejects ambiguous or empty query values instead of choosing the first one", () => {
    expect(parseTextReaderPptIntent("#/conversation?book=book-1&book=book-2&bookTitle=%E9%95%BF%E5%AE%89%E7%9A%84%E8%8D%94%E6%9E%9D")).toEqual({
      status: "blocked",
      reason: "BOOK_ID_AMBIGUOUS",
    });
    expect(parseTextReaderPptIntent("#/conversation?book=book-1&bookTitle=")).toEqual({
      status: "blocked",
      reason: "BOOK_TITLE_EMPTY",
    });
  });

  it("treats an ordinary conversation route without a PPT intent as not applicable", () => {
    expect(parseTextReaderPptIntent("#/conversation?stage=requirements")).toEqual({ status: "none" });
    expect(parseTextReaderPptIntent("#/library")).toEqual({ status: "none" });
  });

  it("accepts only the workspace for the exact requested book", () => {
    const result = resolveTextReaderPptHandoff(seedHash, seedWorkspace);

    expect(result).toEqual({
      status: "ready",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      workspace: seedWorkspace,
    });
  });

  it("blocks a mismatched workspace instead of falling back to another book", () => {
    const idMismatch = resolveTextReaderPptHandoff(seedHash, {
      ...seedWorkspace,
      book: { id: "book-other", title: "长安的荔枝" },
    });
    expect(idMismatch).toEqual({
      status: "blocked",
      reason: "BOOK_ID_MISMATCH",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      display: {
        kind: "book-mismatch",
        requestedBook: {
          bookId: "book-development-changan-lychee",
          bookTitle: "长安的荔枝",
        },
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区与当前书籍不一致，已停止展示旧工作区。",
      },
    });
    expect(JSON.stringify(idMismatch)).not.toContain("book-other");

    expect(resolveTextReaderPptHandoff(seedHash, {
      ...seedWorkspace,
      book: { id: "book-development-changan-lychee", title: "另一本文本" },
    })).toEqual({
      status: "blocked",
      reason: "BOOK_TITLE_MISMATCH",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      display: {
        kind: "book-mismatch",
        requestedBook: {
          bookId: "book-development-changan-lychee",
          bookTitle: "长安的荔枝",
        },
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区与当前书籍不一致，已停止展示旧工作区。",
      },
    });
  });

  it("blocks a missing workspace rather than showing a book-less PPT flow", () => {
    expect(resolveTextReaderPptHandoff(seedHash, null)).toEqual({
      status: "blocked",
      reason: "WORKSPACE_MISSING",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      display: {
        kind: "workspace-unavailable",
        requestedBook: {
          bookId: "book-development-changan-lychee",
          bookTitle: "长安的荔枝",
        },
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区暂时不可用，未展示其他书籍内容。",
      },
    });
  });

  it("blocks a malformed workspace book before attempting an id/title match", () => {
    expect(resolveTextReaderPptHandoff(seedHash, {})).toEqual({
      status: "blocked",
      reason: "WORKSPACE_BOOK_MISSING",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      display: {
        kind: "workspace-unavailable",
        requestedBook: {
          bookId: "book-development-changan-lychee",
          bookTitle: "长安的荔枝",
        },
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区暂时不可用，未展示其他书籍内容。",
      },
    });
    expect(resolveTextReaderPptHandoff(seedHash, {
      book: { id: "", title: "长安的荔枝" },
    })).toEqual({
      status: "blocked",
      reason: "WORKSPACE_BOOK_ID_MISSING",
      intent: {
        bookId: "book-development-changan-lychee",
        bookTitle: "长安的荔枝",
      },
      display: {
        kind: "workspace-unavailable",
        requestedBook: {
          bookId: "book-development-changan-lychee",
          bookTitle: "长安的荔枝",
        },
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区暂时不可用，未展示其他书籍内容。",
      },
    });
  });

  it("resets conversation scroll when a new book intent enters after restored scroll", () => {
    expect(textReaderPptConversationScrollPolicy(null, {
      bookId: "book-2",
      bookTitle: "新书",
    }, 90.5)).toEqual({
      action: "reset",
      targetScrollTop: 0,
      reason: "new-book-intent",
    });
  });

  it("resets conversation scroll when the book intent changes, while preserving the same intent", () => {
    const previous = { bookId: "book-1", bookTitle: "旧书" };
    expect(textReaderPptConversationScrollPolicy(previous, {
      bookId: "book-2",
      bookTitle: "新书",
    }, 90.5)).toEqual({
      action: "reset",
      targetScrollTop: 0,
      reason: "changed-book-intent",
    });
    expect(textReaderPptConversationScrollPolicy(previous, {
      bookId: "book-1",
      bookTitle: "同一本书的新标题",
    }, 90.5)).toEqual({
      action: "reset",
      targetScrollTop: 0,
      reason: "changed-book-intent",
    });
    expect(textReaderPptConversationScrollPolicy(previous, previous, 90.5)).toEqual({
      action: "preserve",
      targetScrollTop: 90.5,
      reason: "same-book-intent",
    });
  });
});

describe("text reader PPT shared seam", () => {
  it("resets restored conversation scroll before adopting the next book intent", () => {
    const persistIndex = mainSource.indexOf("persistConversationScroll();", mainSource.indexOf("function renderRoute()"));
    const syncIndex = mainSource.indexOf("syncTextReaderPptConversationScroll(window.location.hash);", persistIndex);
    const adoptIndex = mainSource.indexOf("bookPptIntentId = bookPptIntentFromHash(window.location.hash);", syncIndex);

    expect(persistIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(persistIndex);
    expect(adoptIndex).toBeGreaterThan(syncIndex);
  });

  it("fails closed before rendering a workspace from another book", () => {
    expect(mainSource).toContain("resolveTextReaderPptHandoff(window.location.hash, workspace)");
    expect(mainSource).toContain("renderTextReaderPptBlockedHandoff(handoff.display)");
  });
});
