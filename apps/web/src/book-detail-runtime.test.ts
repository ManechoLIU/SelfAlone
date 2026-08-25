import { describe, expect, it, vi } from "vitest";
import { createBookDetailPptRuntime } from "./book-detail-runtime";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const book = { id: "book-a", title: "雨后山亭", sourceLabel: "本地" };

describe("book detail presentation runtime", () => {
  it("requests a book-scoped endpoint and maps current plus history", async () => {
    const fetcher = vi.fn(async () => response({
      book,
      state: "normal",
      current: {
        id: "task-running",
        draftId: "draft-a",
        bookId: "book-a",
        title: "《雨后山亭》读书分享",
        status: "generating",
        taskStatus: "running",
        completedPages: 1,
        totalPages: 3,
        version: 2,
        stale: false,
      },
      history: [{
        id: "task-completed",
        draftId: "draft-old",
        bookId: "book-a",
        title: "《雨后山亭》读书分享",
        status: "completed",
        taskStatus: "completed",
        completedPages: 3,
        totalPages: 3,
        version: 1,
        stale: true,
        artifactId: "artifact-a",
      }],
    }));
    const runtime = createBookDetailPptRuntime({ fetcher });

    await expect(runtime.load("book-a")).resolves.toMatchObject({
      state: "normal",
      works: [
        { id: "task-running", status: "generating" },
        { id: "task-completed", status: "completed", downloadHref: "/api/v1/ppt-artifacts/artifact-a/download" },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/books/book-a/presentation");
  });

  it("retains prior works and the server error when the current book fails", async () => {
    const previous = [{
      id: "task-completed",
      title: "《雨后山亭》读书分享",
      status: "completed" as const,
      downloadHref: "/api/v1/ppt-artifacts/artifact-a/download",
    }];
    const runtime = createBookDetailPptRuntime({
      fetcher: async () => response({
        book,
        state: "failed",
        current: {
          id: "task-failed",
          draftId: "draft-a",
          bookId: "book-a",
          title: "《雨后山亭》读书分享",
          status: "failed",
          taskStatus: "failed",
          completedPages: 1,
          totalPages: 3,
          version: 4,
          stale: false,
          error: "PRESENTATION_GENERATION_FAILED",
        },
        history: [],
      }),
    });

    await expect(runtime.load("book-a", previous)).resolves.toMatchObject({
      state: "failed",
      works: previous,
      error: "PRESENTATION_GENERATION_FAILED",
    });
  });

  it("retains prior works on transport failure and fails closed for another book", async () => {
    const previous = [{ id: "task-old", title: "旧作品", status: "completed" as const }];
    const failed = createBookDetailPptRuntime({ fetcher: async () => response({ code: "INTERNAL_ERROR" }, 500) });
    await expect(failed.load("book-a", previous)).resolves.toMatchObject({ state: "failed", works: previous });

    const mismatched = createBookDetailPptRuntime({
      fetcher: async () => response({ book: { id: "book-other", title: "别的书", sourceLabel: "本地" }, state: "normal", current: null, history: [] }),
    });
    await expect(mismatched.load("book-a", previous)).resolves.toMatchObject({
      state: "failed",
      works: previous,
      error: "PPT 作品暂时没有载入，请稍后重试。",
    });
  });

  it("fails closed and retains prior works when the response omits its book scope", async () => {
    const previous = [{ id: "task-old", title: "旧作品", status: "completed" as const }];
    const runtime = createBookDetailPptRuntime({
      fetcher: async () => response({
        book,
        state: "normal",
        current: { id: "task-unscoped", title: "不应显示", status: "completed", artifactId: "artifact-a" },
        history: [],
      }),
    });

    await expect(runtime.load("book-a", previous)).resolves.toMatchObject({
      state: "failed",
      works: previous,
      error: "PPT 作品暂时没有载入，请稍后重试。",
    });
  });

  it("fails closed and retains prior works when the response omits its book title", async () => {
    const previous = [{ id: "task-old", title: "旧作品", status: "completed" as const }];
    const runtime = createBookDetailPptRuntime({
      fetcher: async () => response({
        book: { id: "book-a" },
        state: "empty",
        current: null,
        history: [],
      }),
    });

    await expect(runtime.load("book-a", previous)).resolves.toMatchObject({
      state: "failed",
      works: previous,
      error: "PPT 作品暂时没有载入，请稍后重试。",
    });
  });
});
