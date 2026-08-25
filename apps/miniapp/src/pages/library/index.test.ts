import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DevelopmentClient } from "../../adapters/development";

type LibraryPageHarness = {
  data: Record<string, any>;
  developmentState: string;
  setData(patch: Record<string, any>, callback?: () => void): void;
  loadBooks(): Promise<void>;
  retryBooks(): void;
  [key: string]: any;
};

let pageDefinition: LibraryPageHarness;

function createPage(): LibraryPageHarness {
  return {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)) as Record<string, any>,
    setData(this: LibraryPageHarness, patch: Record<string, any>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  } as LibraryPageHarness;
}

beforeAll(async () => {
  const client = new DevelopmentClient();
  vi.stubGlobal("Page", (definition: LibraryPageHarness) => { pageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({ globalData: { client, developmentAdapter: true } }));
  vi.stubGlobal("wx", { stopPullDownRefresh: vi.fn() });
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Library initial load failure", () => {
  it("keeps the known development bookshelf visible with an inline failure notice", async () => {
    const page = createPage();
    page.developmentState = "failed";
    page.data.developmentAdapter = true;

    await page.loadBooks();

    expect(page.data).toMatchObject({
      phase: "ready",
      kind: "content",
      query: "",
      notice: "开发适配器模拟了可恢复失败",
    });
    expect(page.data.books.map((book: { id: string }) => book.id)).toEqual([
      "dev-local-ink",
      "dev-local-bridge",
      "dev-local-paper",
    ]);
    expect(page.data.visibleBooks).toHaveLength(3);
  });

  it("retries the failed development route without replacing the known bookshelf", async () => {
    const page = createPage();
    page.developmentState = "failed";
    page.data.developmentAdapter = true;
    await page.loadBooks();
    const failedBookIds = page.data.books.map((book: { id: string }) => book.id);

    page.retryBooks();

    await vi.waitFor(() => expect(page.data.notice).toBe(""));
    expect(page.data).toMatchObject({ phase: "ready", kind: "content", query: "" });
    expect(page.data.books.map((book: { id: string }) => book.id)).toEqual(failedBookIds);
  });
});
