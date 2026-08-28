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

  it("passes the active query to the account-scoped client and trusts server filtering", async () => {
    const listBooks = vi.fn(async (input: { query: string }) => {
      expect(input).toEqual({ query: "作者关键词" });
      return [{
        id: "server-book",
        title: "服务端索引命中的书",
        source: "local" as const,
        sourceLabel: "本地",
        format: "txt" as const,
        progress: 0.67,
        coverVariant: 0,
      }];
    });
    vi.stubGlobal("getApp", () => ({ globalData: { client: { listBooks }, developmentAdapter: false } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.query = "作者关键词";

    await page.loadBooks();

    expect(listBooks).toHaveBeenCalledWith({ query: "作者关键词" });
    expect(page.data).toMatchObject({ phase: "ready", kind: "content", query: "作者关键词", queryApplied: true });
    expect(page.data.visibleBooks).toHaveLength(1);
  });

  it("preserves the shelf and active query when a filtered refresh fails", async () => {
    const listBooks = vi.fn(async (_input: { query: string }) => { throw new Error("服务暂时不可用"); });
    vi.stubGlobal("getApp", () => ({ globalData: { client: { listBooks }, developmentAdapter: false } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.query = "作者关键词";
    page.data.queryApplied = true;
    page.data.books = [{
      id: "known-book",
      title: "不含搜索词的缓存标题",
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0,
      coverVariant: 0,
    }];

    await page.loadBooks();

    expect(listBooks).toHaveBeenCalledWith({ query: "作者关键词" });
    expect(page.data).toMatchObject({
      phase: "ready",
      kind: "content",
      query: "作者关键词",
      queryApplied: true,
      notice: "服务暂时不可用",
    });
    expect(page.data.visibleBooks).toHaveLength(1);
  });

  it("keeps the shelf and search input when local import fails", async () => {
    const importBook = vi.fn(async () => { throw new Error("文件超过 50 MB 上限"); });
    const showModal = vi.fn();
    vi.stubGlobal("getApp", () => ({ globalData: { client: { importBook }, developmentAdapter: false } }));
    vi.stubGlobal("wx", { stopPullDownRefresh: vi.fn(), showModal });
    const page = createPage();
    page.data.query = "当前搜索";
    page.data.queryApplied = true;
    page.data.books = [{
      id: "known-book",
      title: "缓存书",
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0.5,
      coverVariant: 0,
    }];

    await page.importSelectedBook({ path: "/tmp/large.epub", name: "large.epub" });

    expect(importBook).toHaveBeenCalledWith({ path: "/tmp/large.epub", name: "large.epub" });
    expect(page.data).toMatchObject({
      phase: "ready",
      kind: "content",
      query: "当前搜索",
      queryApplied: true,
      notice: "文件超过 50 MB 上限",
    });
    expect(page.data.books).toEqual([expect.objectContaining({ id: "known-book" })]);
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "导入未完成" }));
  });

  it("sends the query from the real search event and preserves the shelf when the request fails", async () => {
    const listBooks = vi.fn(async (input: { query: string }) => {
      expect(input).toEqual({ query: "真实搜索" });
      throw new Error("搜索服务暂时不可用");
    });
    vi.stubGlobal("getApp", () => ({ globalData: { client: { listBooks }, developmentAdapter: false } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.queryApplied = true;
    page.data.books = [{
      id: "cached-book",
      title: "未包含搜索词的缓存书",
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0.4,
      coverVariant: 0,
    }];

    await page.onSearch({ detail: { value: "真实搜索" }, currentTarget: { dataset: {} } });

    expect(listBooks).toHaveBeenCalledWith({ query: "真实搜索" });
    expect(page.data).toMatchObject({
      phase: "ready",
      kind: "content",
      query: "真实搜索",
      queryApplied: true,
      notice: "搜索服务暂时不可用",
    });
    expect(page.data.books).toEqual([expect.objectContaining({ id: "cached-book" })]);
  });

  it("does not let an older search response overwrite the latest query", async () => {
    const deferred = new Map<string, { resolve: (books: any[]) => void }>();
    const listBooks = vi.fn((input: { query: string }) => new Promise<any[]>((resolve) => {
      deferred.set(input.query, { resolve });
    }));
    vi.stubGlobal("getApp", () => ({ globalData: { client: { listBooks }, developmentAdapter: false } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.books = [];

    const firstSearch = page.onSearch({ detail: { value: "先搜" }, currentTarget: { dataset: {} } });
    const secondSearch = page.onSearch({ detail: { value: "后搜" }, currentTarget: { dataset: {} } });
    deferred.get("先搜")?.resolve([{
      id: "stale-book",
      title: "旧结果",
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0,
      coverVariant: 0,
    }]);
    deferred.get("后搜")?.resolve([{
      id: "current-book",
      title: "新结果",
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0,
      coverVariant: 0,
    }]);

    await Promise.all([firstSearch, secondSearch]);

    expect(listBooks).toHaveBeenNthCalledWith(1, { query: "先搜" });
    expect(listBooks).toHaveBeenNthCalledWith(2, { query: "后搜" });
    expect(page.data).toMatchObject({ query: "后搜", queryApplied: true, kind: "content" });
    expect(page.data.books).toEqual([expect.objectContaining({ id: "current-book" })]);
  });
});
