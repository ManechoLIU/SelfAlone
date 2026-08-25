import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import {
  createBookPresentationService,
  type BookPresentationBookRecord,
  type BookPresentationRepository,
  type BookPresentationTaskRecord,
} from "./book-presentation";

const book: BookPresentationBookRecord = {
  id: "book-a",
  title: "雨后山亭",
  sourceLabel: "本地",
};

function task(overrides: Partial<BookPresentationTaskRecord> = {}): BookPresentationTaskRecord {
  return {
    id: "task-a",
    draftId: "draft-a",
    bookId: book.id,
    status: "completed",
    completedPages: 3,
    totalPages: 3,
    version: 1,
    ...overrides,
  };
}

function repository(overrides: Partial<BookPresentationRepository> = {}): BookPresentationRepository {
  return {
    findBook: async () => book,
    listTasks: async () => [],
    ...overrides,
  };
}

describe("book-scoped presentation service", () => {
  it("passes the account and book scope to both repository lookups", async () => {
    const findBook = vi.fn(async () => book);
    const listTasks = vi.fn(async () => []);
    const service = createBookPresentationService(repository({ findBook, listTasks }));

    await expect(service.getBookPresentation("account-a", "book-a")).resolves.toMatchObject({
      book,
      state: "empty",
      current: null,
      history: [],
    });
    expect(findBook).toHaveBeenCalledWith("account-a", "book-a");
    expect(listTasks).toHaveBeenCalledWith("account-a", "book-a");
  });

  it("keeps the failed current task and completed history visible", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [
        task({ id: "task-old", version: 1, artifactId: "artifact-old", stale: true }),
        task({ id: "task-failed", version: 2, status: "failed", error: "PRESENTATION_GENERATION_FAILED" }),
      ],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).resolves.toMatchObject({
      state: "failed",
      current: {
        id: "task-failed",
        status: "failed",
        taskStatus: "failed",
        error: "PRESENTATION_GENERATION_FAILED",
      },
      history: [{ id: "task-old", status: "completed", artifactId: "artifact-old" }],
    });
  });

  it("returns the latest non-stale task as current and older tasks as history", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [
        task({ id: "task-old", version: 1, artifactId: "artifact-old", stale: true }),
        task({ id: "task-current", version: 2, status: "running", completedPages: 1, totalPages: 3 }),
      ],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).resolves.toMatchObject({
      state: "normal",
      current: {
        id: "task-current",
        status: "generating",
        taskStatus: "running",
        stale: false,
        completedPages: 1,
        totalPages: 3,
      },
      history: [{ id: "task-old", status: "completed", artifactId: "artifact-old", stale: true }],
    });
  });

  it("keeps stale records as history without treating them as current", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [
        task({ id: "task-stale-failed", version: 3, status: "failed", error: "DRAFT_REVISED", stale: true }),
        task({ id: "task-stale-completed", version: 2, artifactId: "artifact-stale", stale: true }),
      ],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).resolves.toMatchObject({
      state: "empty",
      current: null,
      history: [
        { id: "task-stale-failed", status: "failed", stale: true },
        { id: "task-stale-completed", status: "completed", stale: true },
      ],
    });
  });

  it("fails closed when two drafts have the same latest version", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [
        task({ id: "task-draft-a", draftId: "draft-a", version: 2 }),
        task({ id: "task-draft-b", draftId: "draft-b", version: 2 }),
      ],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).rejects.toThrow("BOOK_PRESENTATION_AMBIGUOUS");
  });

  it("fails closed when two drafts have different latest versions", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [
        task({ id: "task-draft-a", draftId: "draft-a", version: 4 }),
        task({ id: "task-draft-b", draftId: "draft-b", version: 1 }),
      ],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).rejects.toThrow("BOOK_PRESENTATION_AMBIGUOUS");
  });

  it("fails closed for an unknown book or a task returned for another book", async () => {
    const unknown = createBookPresentationService(repository({ findBook: async () => null }));
    await expect(unknown.getBookPresentation("account-a", "missing")).rejects.toThrow("BOOK_NOT_FOUND");

    const mismatched = createBookPresentationService(repository({
      listTasks: async () => [task({ bookId: "book-other" })],
    }));
    await expect(mismatched.getBookPresentation("account-a", "book-a")).rejects.toThrow("BOOK_PRESENTATION_MISMATCH");
  });

  it("fails closed when storage returns an unsupported task status", async () => {
    const service = createBookPresentationService(repository({
      listTasks: async () => [task({ status: "queued-but-unknown" as BookPresentationTaskRecord["status"] })],
    }));

    await expect(service.getBookPresentation("account-a", "book-a")).rejects.toThrow("INVALID_PRESENTATION_STATUS");
  });
});

describe("book-scoped presentation route", () => {
  it("uses the requested book and session account instead of the legacy workspace", async () => {
    const snapshot = {
      book,
      state: "empty" as const,
      current: null,
      history: [],
    };
    const getBookPresentation = vi.fn(async () => snapshot);
    const app = createApp({
      readiness: async () => true,
      bookPresentation: { getBookPresentation },
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/books/book-a/presentation",
        headers: { "x-selfalone-account": "account-a" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(snapshot);
      expect(getBookPresentation).toHaveBeenCalledWith("account-a", "book-a");

      const unauthenticated = await app.inject({
        method: "GET",
        url: "/api/v1/books/book-a/presentation",
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json()).toEqual({ code: "ACCOUNT_REQUIRED" });
    } finally {
      await app.close();
    }
  });
});
