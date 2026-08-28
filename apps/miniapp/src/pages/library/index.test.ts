import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DevelopmentClient } from "../../adapters/development";

type LibraryPageHarness = {
  data: Record<string, any>;
  developmentState: string;
  setData(patch: Record<string, any>, callback?: () => void): void;
  loadBooks(): Promise<void>;
  retryBooks(): void;
  showWeReadBoundary(): void;
  openBook(event: MiniappEvent): Promise<void> | void;
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

  it("merges injected WeRead books with a real cover and sync status into the unified shelf", async () => {
    const wereadClient = {
      getConnection: vi.fn(async () => ({
        connection: {
          connectionId: "connection-a",
          accountExternalId: "weread-account-a",
          apiKeyHint: "wrk-••••••••",
          status: "verified" as const,
          verifiedAt: "2024-01-02T03:04:05.000Z",
          revision: "3",
        },
      })),
      getBooks: vi.fn(async () => ({
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        cursor: null,
        nextCursor: null,
        books: [{
          bookId: "local-book-a",
          externalId: "weread-book-a",
          title: "同步书",
          author: "同步作者",
          coverUrl: "https://cdn.example.test/sync-book.jpg",
          progressPercent: 43,
          lastReadAt: "2024-01-02T03:04:05.000Z",
        }],
      })),
    };
    vi.stubGlobal("getApp", () => ({
      globalData: {
        client: { listBooks: vi.fn(async () => []) },
        developmentAdapter: false,
        wereadClient,
      },
    }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;

    await page.loadBooks();

    expect(page.data.wereadSyncStatus).toBe("success");
    expect(page.data.visibleBooks).toEqual([expect.objectContaining({
      id: "local-book-a",
      source: "weread",
      coverUrl: "https://cdn.example.test/sync-book.jpg",
      progressLabel: "43%",
    })]);
  });

  it("follows opaque WeRead cursors until the complete snapshot is read", async () => {
    const getBooks = vi.fn(async ({ cursor }: { cursor?: string | null }) => cursor === null
      ? {
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        cursor: null,
        nextCursor: "opaque/page-2",
        books: [{
          bookId: "local-book-a",
          externalId: "weread-book-a",
          title: "第一页",
          author: "作者 A",
          coverUrl: "https://cdn.example.test/page-1.jpg",
          progressPercent: 20,
          lastReadAt: null,
        }],
      }
      : {
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        cursor: "opaque/page-2",
        nextCursor: null,
        books: [{
          bookId: "local-book-b",
          externalId: "weread-book-b",
          title: "第二页",
          author: "作者 B",
          coverUrl: "https://cdn.example.test/page-2.jpg",
          progressPercent: 80,
          lastReadAt: null,
        }],
      });
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks,
    };
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient,
    } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;

    await page.loadBooks();

    expect(getBooks).toHaveBeenNthCalledWith(1, { cursor: null });
    expect(getBooks).toHaveBeenNthCalledWith(2, { cursor: "opaque/page-2" });
    expect(page.data.wereadBooks.map((book: { id: string }) => book.id)).toEqual([
      "local-book-a",
      "local-book-b",
    ]);
  });

  it("keeps cached WeRead books when the next sync fails", async () => {
    const wereadBook = {
      id: "weread:weread-book-a",
      title: "缓存同步书",
      author: "作者",
      source: "weread" as const,
      sourceLabel: "微信读书",
      format: "weread" as const,
      progress: 0.43,
      coverUrl: "https://cdn.example.test/cached.jpg",
      coverVariant: 0,
    };
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks: vi.fn(async () => { throw new Error("微信读书暂时不可用"); }),
    };
    vi.stubGlobal("getApp", () => ({
      globalData: {
        client: { listBooks: vi.fn(async () => []) },
        developmentAdapter: false,
        wereadClient,
      },
    }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.wereadBooks = [wereadBook];
    page.data.books = [wereadBook];
    page.data.localBooks = [];

    await page.loadBooks();

    expect(page.data.wereadSyncStatus).toBe("failed");
    expect(page.data.wereadBooks).toEqual([wereadBook]);
    expect(page.data.visibleBooks).toEqual([expect.objectContaining({ id: wereadBook.id })]);
    expect(page.data.wereadNotice).toBe("微信读书暂时不可用");
  });

  it("ignores a WeRead books response from a stale connection", async () => {
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks: vi.fn(async () => ({
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-old",
        accountExternalId: "weread-account-old",
        cursor: null,
        nextCursor: null,
        books: [{
          bookId: "old-local-book",
          externalId: "old-provider-book",
          title: "旧连接书",
          author: "旧作者",
          coverUrl: "https://cdn.example.test/old.jpg",
          progressPercent: 40,
          lastReadAt: null,
        }],
      })),
    };
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient,
    } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.wereadBooks = [{
      id: "current-local-book",
      title: "当前书",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.3,
      coverVariant: 0,
    }];

    await page.loadBooks();

    expect(page.data.wereadBooks).toEqual([expect.objectContaining({ id: "current-local-book" })]);
    expect(page.data.wereadSyncStatus).toBe("idle");
  });

  it.each([
    ["connection", { connectionId: "connection-old", accountExternalId: "weread-account-a" }],
    ["account", { connectionId: "connection-a", accountExternalId: "weread-account-old" }],
    ["book", { connectionId: "connection-a", accountExternalId: "weread-account-a", bookId: "other-local-book" }],
  ] as const)("ignores a stale WeRead annotation response by %s identity", async (_kind, identity) => {
    const showModal = vi.fn();
    const getAnnotations = vi.fn(async () => ({
      status: "success" as const,
      snapshot: "last_success" as const,
      connectionId: identity.connectionId,
      accountExternalId: identity.accountExternalId,
      bookId: "bookId" in identity ? identity.bookId : "local-book-a",
      bookExternalId: "weread-book-a",
      annotations: [{
        externalId: "stale-annotation",
        bookExternalId: "weread-book-a",
        quote: "旧内容",
        thought: null,
        location: null,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      }],
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient: { getAnnotations },
    } }));
    vi.stubGlobal("wx", { showModal, stopPullDownRefresh: vi.fn() });
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      apiKeyHint: "wrk-••••••••",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    page.data.wereadAnnotations = { "local-book-a": [] };

    await page.openWeReadAnnotations({
      id: "local-book-a",
      title: "当前书",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.3,
      coverVariant: 0,
      coverAsset: "",
      progressLabel: "30%",
      annotationCount: 0,
    });

    expect(page.data.wereadAnnotations).toEqual({ "local-book-a": [] });
    expect(showModal).not.toHaveBeenCalled();
  });

  it("ignores an annotation response that arrives after the active connection changes", async () => {
    let resolveAnnotations: ((value: any) => void) | undefined;
    const showModal = vi.fn();
    const getAnnotations = vi.fn(() => new Promise((resolve) => {
      resolveAnnotations = resolve;
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient: { getAnnotations },
    } }));
    vi.stubGlobal("wx", { showModal, stopPullDownRefresh: vi.fn() });
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-old",
      accountExternalId: "weread-account-old",
      apiKeyHint: "old",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    page.data.wereadAnnotations = { "local-book-a": [] };
    const opening = page.openWeReadAnnotations({
      id: "local-book-a",
      title: "当前书",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.3,
      coverVariant: 0,
      coverAsset: "",
      progressLabel: "30%",
      annotationCount: 0,
    });

    page.data.wereadConnection = {
      connectionId: "connection-new",
      accountExternalId: "weread-account-new",
      apiKeyHint: "new",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "4",
    };
    resolveAnnotations?.({
      status: "success",
      snapshot: "last_success",
      connectionId: "connection-old",
      accountExternalId: "weread-account-old",
      bookId: "local-book-a",
      bookExternalId: "weread-book-a",
      annotations: [{
        externalId: "old-annotation",
        bookExternalId: "weread-book-a",
        quote: "旧连接内容",
        thought: null,
        location: null,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      }],
    });
    await opening;

    expect(page.data.wereadAnnotations).toEqual({ "local-book-a": [] });
    expect(page.data.wereadAnnotationLoadingId).toBe("");
    expect(showModal).not.toHaveBeenCalled();
  });

  it("clears the stale annotation loading marker when an old target rejects", async () => {
    let rejectAnnotations: ((error: Error) => void) | undefined;
    const showModal = vi.fn();
    const getAnnotations = vi.fn(() => new Promise((_resolve, reject) => {
      rejectAnnotations = reject;
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient: { getAnnotations },
    } }));
    vi.stubGlobal("wx", { showModal, stopPullDownRefresh: vi.fn() });
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-old",
      accountExternalId: "weread-account-old",
      apiKeyHint: "old",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    const opening = page.openWeReadAnnotations({
      id: "local-book-a",
      title: "当前书",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.3,
      coverVariant: 0,
      coverAsset: "",
      progressLabel: "30%",
      annotationCount: 0,
    });

    page.data.wereadConnection = {
      connectionId: "connection-new",
      accountExternalId: "weread-account-new",
      apiKeyHint: "new",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "4",
    };
    rejectAnnotations?.(new Error("旧连接失败"));
    await opening;

    expect(page.data.wereadAnnotationLoadingId).toBe("");
    expect(page.data.wereadNotice).toBe("");
    expect(showModal).not.toHaveBeenCalled();
  });

  it("uses unknown progress as a labelled state instead of a false 0%", async () => {
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks: vi.fn(async () => ({
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        cursor: null,
        nextCursor: null,
        books: [{
          bookId: "local-unknown-progress",
          externalId: "weread-unknown-progress",
          title: "未知进度",
          author: null,
          coverUrl: "https://cdn.example.test/unknown.jpg",
          progressPercent: null,
          lastReadAt: null,
        }],
      })),
    };
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient,
    } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;

    await page.loadBooks();

    expect(page.data.visibleBooks).toEqual([expect.objectContaining({
      progressLabel: "未读取",
      progressWidth: "0%",
    })]);
  });

  it("clears the previous WeRead shelf when a successful sync returns an empty snapshot", async () => {
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks: vi.fn(async () => ({
        status: "success" as const,
        snapshot: "last_success" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        cursor: null,
        nextCursor: null,
        books: [],
      })),
    };
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient,
    } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.wereadBooks = [{
      id: "weread:stale-book",
      title: "旧同步书",
      source: "weread",
      sourceLabel: "微信读书",
      format: "weread",
      progress: 0.3,
      coverVariant: 0,
    }];

    await page.loadBooks();

    expect(page.data.wereadSyncStatus).toBe("success");
    expect(page.data.wereadBooks).toEqual([]);
    expect(page.data.visibleBooks).toEqual([]);
  });

  it.each([
    ["failed", { code: "EXTERNAL_SERVICE_FAILED", message: "同步失败", retryable: true }],
    ["paused", { reason: "upgrade_required", errcode: 1001, upgradeInfo: "请更新微信读书" }],
  ] as const)("keeps the last-success shelf when a %s snapshot cannot refresh it", async (status, detail) => {
    const wereadBook = {
      id: "weread:known-book",
      title: "上次成功书",
      source: "weread" as const,
      sourceLabel: "微信读书",
      format: "weread" as const,
      progress: 0.4,
      coverVariant: 0,
    };
    const wereadClient = {
      getConnection: vi.fn(async () => ({ connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "3",
      } })),
      getBooks: vi.fn(async () => status === "failed"
        ? {
          status: "failed" as const,
          snapshot: "last_success" as const,
          connectionId: "connection-a",
          accountExternalId: "weread-account-a",
          cursor: null,
          nextCursor: null,
          books: [],
          error: detail,
        }
        : {
          status: "paused" as const,
          snapshot: "last_success" as const,
          connectionId: "connection-a",
          accountExternalId: "weread-account-a",
          cursor: null,
          nextCursor: null,
          books: [],
          pause: detail,
        }),
    };
    vi.stubGlobal("getApp", () => ({ globalData: {
      client: { listBooks: vi.fn(async () => []) },
      developmentAdapter: false,
      wereadClient,
    } }));
    const page = createPage();
    page.developmentState = "normal";
    page.data.developmentAdapter = false;
    page.data.wereadBooks = [wereadBook];

    await page.loadBooks();

    expect(page.data.wereadSyncStatus).toBe(status);
    expect(page.data.wereadBooks).toEqual([wereadBook]);
    expect(page.data.visibleBooks).toEqual([expect.objectContaining({ id: wereadBook.id })]);
  });

  it("routes the bookshelf connection entry to Settings instead of opening a static boundary modal", () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("wx", { stopPullDownRefresh: vi.fn(), navigateTo });
    const page = createPage();

    page.showWeReadBoundary();

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/settings/index?service=weread" });
  });
});
