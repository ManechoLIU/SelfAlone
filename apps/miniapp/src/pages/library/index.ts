import type { MiniappApp } from "../../app";
import { resolveWeReadClient, type WeReadClient } from "../../adapters/weread";
import { parseDevelopmentState, type DevelopmentState } from "../../adapters/client";
import { preserveLibraryOnFailure, presentLibrary, type BookSummary, type LibraryPresentation } from "../../core/library-state";
import {
  annotationsFromSnapshot,
  mapWeReadBook,
  mergeWeReadBooks,
  presentWeReadSync,
  preserveWeReadOnFailure,
  type WeReadBooksSnapshotResponse,
  type WeReadAnnotationView,
  type WeReadConnectionProjection,
  type WeReadSyncViewStatus,
} from "../../core/weread-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";

type VisibleBook = BookSummary & {
  coverAsset: string;
  progressLabel: string;
  progressWidth: string;
  wereadExternalId?: string;
  annotationCount: number;
};
type LibraryFilePicker = {
  chooseMessageFile?: (options: {
    count: number;
    type: "file";
    extension?: string[];
    success?: (result: { tempFiles?: Array<{ path?: string; tempFilePath?: string; name?: string }> }) => void;
    fail?: () => void;
  }) => void;
};
type LibraryData = {
  phase: "loading" | "ready" | "failed";
  books: BookSummary[];
  localBooks: BookSummary[];
  wereadBooks: BookSummary[];
  wereadConnection: WeReadConnectionProjection | null;
  wereadSyncStatus: WeReadSyncViewStatus;
  wereadSyncLabel: string;
  wereadNotice: string;
  wereadAnnotations: Record<string, WeReadAnnotationView[]>;
  wereadAnnotationLoadingId: string;
  visibleBooks: VisibleBook[];
  query: string;
  queryApplied: boolean;
  kind: LibraryPresentation["kind"];
  error: string;
  notice: string;
  drawerOpen: boolean;
  developmentAdapter: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
};

const coverAssets = [
  "/assets/book-covers/local-default-celadon-ink-v1.png",
  "/assets/book-covers/local-default-amber-lamp-v1.png",
  "/assets/book-covers/local-default-indigo-sea-v1.png",
];

class StaleWeReadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleWeReadResponseError";
  }
}

Page<LibraryData>({
  data: {
    phase: "loading",
    books: [],
    localBooks: [],
    wereadBooks: [],
    wereadConnection: null,
    wereadSyncStatus: "idle",
    wereadSyncLabel: "未连接",
    wereadNotice: "",
    wereadAnnotations: {},
    wereadAnnotationLoadingId: "",
    visibleBooks: [],
    query: "",
    queryApplied: false,
    kind: "loading",
    error: "",
    notice: "",
    drawerOpen: false,
    developmentAdapter: false,
    keyboardOpen: false,
    viewportStyle: "",
    viewportMetrics: "",
  },
  onLoad(options: { state?: string }) {
    this.isUnloaded = false;
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (!this.isUnloaded) this.setData(viewportPresentation(geometry));
    });
    const app = getApp<MiniappApp>();
    this.developmentState = parseDevelopmentState(options.state, app.globalData.developmentAdapter);
    this.setData({ developmentAdapter: app.globalData.developmentAdapter });
  },
  onUnload() {
    this.isUnloaded = true;
    this.releaseViewport?.();
  },
  onShow() {
    const app = getApp<MiniappApp>();
    app.globalData.session = app.globalData.sessionStore.restore();
    if (app.globalData.session.kind === "signed-out") {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    void this.loadBooks();
  },
  onPullDownRefresh() {
    void this.loadBooks();
  },
  async loadBooks() {
    const generation = (this.libraryLoadGeneration ?? 0) + 1;
    this.libraryLoadGeneration = generation;
    const state = (this.developmentState ?? "normal") as DevelopmentState;
    const requestedQuery = this.data.query;
    if (state === "loading") {
      this.present({ phase: "loading", books: [], query: requestedQuery, queryApplied: false });
      wx.stopPullDownRefresh();
      return;
    }
    if (!this.data.books.length) this.present({ phase: "loading", books: [], query: requestedQuery, queryApplied: false });
    let recoveryBooks = this.data.localBooks.length
      ? this.data.localBooks
      : this.data.books.filter((book: BookSummary) => book.source !== "weread");
    try {
      const app = getApp<MiniappApp>();
      const client = app.globalData.client;
      if (state === "failed" && !recoveryBooks.length && app.globalData.developmentAdapter) {
        recoveryBooks = await client.listBooks({ query: "", state: "normal" });
      }
      const query = state === "filtered-empty" ? "无匹配书名" : requestedQuery;
      const request = app.globalData.developmentAdapter ? { query, state } : { query };
      const books = await client.listBooks(request);
      if (this.isUnloaded || generation !== this.libraryLoadGeneration) return;
      this.present({ phase: "ready", books, query, queryApplied: true });
      this.setData({ notice: "" });
    } catch (error) {
      if (this.isUnloaded || generation !== this.libraryLoadGeneration) return;
      const recovered = preserveLibraryOnFailure(
        { books: recoveryBooks, query: requestedQuery, queryApplied: this.data.queryApplied },
        readableError(error),
      );
      this.present(recovered);
      if ("notice" in recovered) this.setData({ notice: recovered.notice });
    } finally {
      await this.loadWeRead();
      wx.stopPullDownRefresh();
    }
  },
  async loadWeRead() {
    const generation = (this.wereadLoadGeneration ?? 0) + 1;
    this.wereadLoadGeneration = generation;
    const client = this.resolveWeReadClient();
    const previousSyncState = {
      wereadSyncStatus: this.data.wereadSyncStatus,
      wereadSyncLabel: this.data.wereadSyncLabel,
      wereadNotice: this.data.wereadNotice,
    };
    const expectedConnectionId = this.data.wereadConnection?.connectionId ?? null;
    const expectedAccountExternalId = this.data.wereadConnection?.accountExternalId ?? null;
    const shelfOwner = this.wereadShelfOwner
      ?? (expectedConnectionId !== null && expectedAccountExternalId !== null
        ? { connectionId: expectedConnectionId, accountExternalId: expectedAccountExternalId }
        : null);
    let activeConnection: WeReadConnectionProjection | null = null;
    const initialTargetStillCurrent = () => {
      const current = this.data.wereadConnection;
      return (current?.connectionId ?? null) === expectedConnectionId
        && (current?.accountExternalId ?? null) === expectedAccountExternalId;
    };
    const activeTargetStillCurrent = () => {
      if (!activeConnection) return initialTargetStillCurrent();
      const current = this.data.wereadConnection;
      return !!current
        && current.connectionId === activeConnection.connectionId
        && current.accountExternalId === activeConnection.accountExternalId;
    };
    try {
      const response = await client.getConnection();
      if (this.isUnloaded || generation !== this.wereadLoadGeneration) return;
      if (!initialTargetStillCurrent()) {
        this.setData(previousSyncState);
        return;
      }
      const connection = response.connection?.status === "disconnected" ? null : response.connection;
      if (!connection) {
        this.wereadShelfOwner = shelfOwner;
        this.setData({
          wereadConnection: null,
          wereadSyncStatus: "idle",
          wereadSyncLabel: "未连接",
          wereadNotice: "",
        });
        this.present({
          phase: this.data.localBooks.length ? "ready" : this.data.phase === "loading" ? "ready" : this.data.phase,
          books: this.data.localBooks,
          query: this.data.query,
          queryApplied: this.data.queryApplied,
          error: this.data.error,
        });
        return;
      }

      activeConnection = connection;
      this.setData({
        wereadConnection: connection,
        wereadSyncStatus: "loading",
        wereadSyncLabel: "同步中",
        wereadNotice: "",
      });
      const booksResponse = await this.readWeReadBooks(client, connection, generation);
      if (this.isUnloaded || generation !== this.wereadLoadGeneration) return;
      const currentConnection = this.data.wereadConnection;
      if (
        !currentConnection
        || currentConnection.connectionId !== connection.connectionId
        || currentConnection.accountExternalId !== connection.accountExternalId
      ) {
        this.setData(previousSyncState);
        return;
      }
      const sync = presentWeReadSync(booksResponse);
      const snapshotBooks = booksResponse.books.map(mapWeReadBook);
      const shelfOwnerChanged = !!shelfOwner
        && (shelfOwner.connectionId !== connection.connectionId
          || shelfOwner.accountExternalId !== connection.accountExternalId);
      const cachedBooks = shelfOwnerChanged ? [] : this.data.wereadBooks;
      const wereadBooks = booksResponse.status === "success"
        ? snapshotBooks
        : cachedBooks.length ? cachedBooks : snapshotBooks;
      this.wereadShelfOwner = {
        connectionId: connection.connectionId,
        accountExternalId: connection.accountExternalId,
      };
      const localBooks = this.data.localBooks.length
        ? this.data.localBooks
        : this.data.books.filter((book: BookSummary) => book.source !== "weread");
      const phase = localBooks.length || wereadBooks.length || this.data.phase === "ready" ? "ready" : this.data.phase;
      this.setData({
        wereadConnection: connection,
        wereadBooks,
        wereadAnnotations: shelfOwnerChanged ? {} : this.data.wereadAnnotations,
        wereadSyncStatus: sync.status,
        wereadSyncLabel: sync.label,
        wereadNotice: sync.message,
      });
      this.present({
        phase,
        books: localBooks,
        query: this.data.query,
        queryApplied: this.data.queryApplied,
        error: this.data.error,
      });
    } catch (error) {
      if (this.isUnloaded || generation !== this.wereadLoadGeneration) return;
      if (!activeTargetStillCurrent()) {
        this.setData(previousSyncState);
        return;
      }
      if (error instanceof StaleWeReadResponseError) {
        this.setData(previousSyncState);
        return;
      }
      const message = readableError(error);
      const preserved = preserveWeReadOnFailure(this.data.wereadBooks, message);
      this.setData({
        wereadSyncStatus: "failed",
        wereadSyncLabel: "同步失败",
        wereadNotice: preserved.notice,
      });
    }
  },
  async readWeReadBooks(
    client: WeReadClient,
    connection: WeReadConnectionProjection,
    generation: number,
  ): Promise<WeReadBooksSnapshotResponse> {
    let cursor: string | null = null;
    const books: WeReadBooksSnapshotResponse["books"][number][] = [];
    while (true) {
      const response = await client.getBooks({ cursor });
      if (this.isUnloaded || generation !== this.wereadLoadGeneration) return response;
      if (
        response.connectionId !== connection.connectionId
        || response.accountExternalId !== connection.accountExternalId
      ) {
        throw new StaleWeReadResponseError("微信读书书架连接已变更");
      }
      if (response.status !== "success") return response;
      books.push(...response.books);
      if (response.nextCursor === null) {
        return { ...response, books };
      }
      if (response.nextCursor === cursor) {
        throw new Error("微信读书返回了重复的分页游标");
      }
      cursor = response.nextCursor;
    }
  },
  present(state: {
    phase: "loading" | "ready" | "failed";
    books: BookSummary[];
    query: string;
    queryApplied?: boolean;
    error?: string;
  }) {
    const localBooks = state.books.filter((book) => book.source !== "weread");
    const filteredWeReadBooks = this.data.wereadBooks.filter((book: BookSummary) => {
      const query = state.query.trim().toLocaleLowerCase();
      return !query || [book.title, book.author ?? "", book.sourceLabel]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
    const books = mergeWeReadBooks(localBooks, filteredWeReadBooks);
    const presentation = presentLibrary({ ...state, books });
    const visibleBooks = presentation.kind === "content"
      ? presentation.books.map((book) => ({
        ...book,
        coverAsset: coverAssets[Math.abs(book.coverVariant) % coverAssets.length]!,
        progressLabel: "progressKnown" in book && book.progressKnown === false
          ? "未读取"
          : `${Math.round(book.progress * 100)}%`,
        progressWidth: `${Math.round(book.progress * 100)}%`,
        ...(book.source === "weread" ? { wereadExternalId: "wereadExternalId" in book ? book.wereadExternalId : book.id.slice("weread:".length) } : {}),
        annotationCount: this.data.wereadAnnotations[book.id]?.length ?? 0,
      }))
      : [];
    this.setData({
      ...state,
      localBooks,
      books,
      queryApplied: state.queryApplied ?? false,
      kind: presentation.kind,
      error: presentation.kind === "failed" ? presentation.message : "",
      visibleBooks,
    });
  },
  onSearch(event: MiniappEvent<{ value: string }>) {
    const query = event.detail.value;
    this.present({
      phase: this.data.phase,
      books: this.data.books,
      query,
      // Keep the cached shelf visible while the server applies the new query.
      queryApplied: true,
      error: this.data.error,
    });
    return this.loadBooks();
  },
  clearSearch() {
    this.present({ phase: "ready", books: this.data.books, query: "", queryApplied: false });
    void this.loadBooks();
  },
  retryBooks() {
    if (this.developmentState === "failed") this.developmentState = "normal";
    void this.loadBooks();
  },
  retryWeRead() {
    void this.loadWeRead();
  },
  toggleDrawer() { this.setData({ drawerOpen: !this.data.drawerOpen }); },
  closeDrawer() { this.setData({ drawerOpen: false }); },
  showImportBoundary() {
    const app = getApp<MiniappApp>();
    if (!app.globalData.developmentAdapter) {
      const picker = wx as unknown as LibraryFilePicker;
      if (picker.chooseMessageFile) {
        picker.chooseMessageFile({
          count: 1,
          type: "file",
          extension: ["epub", "txt", "pdf"],
          success: (result) => {
            const selected = result.tempFiles?.[0];
            const path = selected?.path ?? selected?.tempFilePath;
            if (!path) {
              this.showImportFailure("未能读取所选文件，当前书架与输入仍保留。");
              return;
            }
            void this.importSelectedBook({ path, name: selected?.name ?? path.split("/").at(-1) ?? "" });
          },
          fail: () => this.showImportFailure("文件未能加入，当前书架与输入仍保留。"),
        });
        return;
      }
      this.showImportFailure("当前客户端暂不支持选择文件，当前书架与输入仍保留。");
      return;
    }
    wx.showModal({
      title: "真实导入等待接入",
      content: "A 合入并冻结书架与导入契约后接入。当前运行壳不会伪造上传或服务端持久化。",
      showCancel: false,
    });
  },
  showImportFailure(message: string) {
    wx.showModal({ title: "导入未完成", content: message, showCancel: false });
  },
  async importSelectedBook(file: { path: string; name: string }) {
    const app = getApp<MiniappApp>();
    const previousBooks = this.data.books;
    try {
      const book = await app.globalData.client.importBook(file);
      if (this.isUnloaded) return;
      const books = [book, ...previousBooks.filter((item: BookSummary) => item.id !== book.id)];
      this.present({ phase: "ready", books, query: this.data.query, queryApplied: false });
      wx.showToast({ title: "已加入书架", icon: "success" });
    } catch (error) {
      if (this.isUnloaded) return;
      const recovered = preserveLibraryOnFailure(
        { books: previousBooks, query: this.data.query, queryApplied: this.data.queryApplied },
        readableError(error),
      );
      this.present(recovered);
      if ("notice" in recovered) this.setData({ notice: recovered.notice });
      this.showImportFailure(`${readableError(error)}，当前书架与输入仍保留。`);
    }
  },
  showWeReadBoundary() {
    wx.navigateTo({ url: "/pages/settings/index?service=weread" });
  },
  async openBook(event: MiniappEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const book = this.data.visibleBooks.find((item: VisibleBook) => item.id === id);
    if (book?.source === "weread") {
      await this.openWeReadAnnotations(book);
      return;
    }
    wx.navigateTo({ url: `/pages/reader/index?id=${encodeURIComponent(id)}` });
  },
  async openWeReadAnnotations(book: VisibleBook) {
    const generation = (this.wereadAnnotationGenerations?.[book.id] ?? 0) + 1;
    this.wereadAnnotationGenerations = { ...(this.wereadAnnotationGenerations ?? {}), [book.id]: generation };
    const connection = this.data.wereadConnection;
    const annotationTargetStillCurrent = () => {
      const current = this.data.wereadConnection;
      return !!connection
        && !!current
        && current.connectionId === connection.connectionId
        && current.accountExternalId === connection.accountExternalId;
    };
    this.setData({ wereadAnnotationLoadingId: book.id });
    try {
      const response = await this.resolveWeReadClient().getAnnotations({ bookId: book.id });
      if (
        this.isUnloaded
        || generation !== this.wereadAnnotationGenerations?.[book.id]
        || !connection
        || response.connectionId !== connection.connectionId
        || response.accountExternalId !== connection.accountExternalId
        || response.bookId !== book.id
        || !annotationTargetStillCurrent()
      ) {
        if (
          !this.isUnloaded
          && generation === this.wereadAnnotationGenerations?.[book.id]
          && this.data.wereadAnnotationLoadingId === book.id
        ) {
          this.setData({ wereadAnnotationLoadingId: "" });
        }
        return;
      }
      const annotations = annotationsFromSnapshot(response);
      const nextAnnotations = { ...this.data.wereadAnnotations, [book.id]: annotations };
      const sync = presentWeReadSync(response);
      this.setData({
        wereadAnnotations: nextAnnotations,
        wereadAnnotationLoadingId: "",
        wereadNotice: sync.message,
      });
      const content = annotations.length
        ? annotations.map((item) => [
          `「${item.quote}」`,
          item.thought ? `想法：${item.thought}` : "",
          item.location ? `位置：${item.location}` : "",
        ].filter(Boolean).join("\n")).join("\n\n")
        : "还没有同步的划线与想法。";
      wx.showModal({ title: `《${book.title}》的划线与想法`, content, showCancel: false });
    } catch (error) {
      if (this.isUnloaded || generation !== this.wereadAnnotationGenerations?.[book.id]) return;
      if (!annotationTargetStillCurrent()) {
        if (this.data.wereadAnnotationLoadingId === book.id) this.setData({ wereadAnnotationLoadingId: "" });
        return;
      }
      this.setData({
        wereadAnnotationLoadingId: "",
        wereadNotice: `${readableError(error)}，已保留当前划线与想法。`,
      });
      wx.showModal({
        title: "微信读书内容暂时无法载入",
        content: `${readableError(error)}，已保留当前划线与想法。`,
        showCancel: false,
      });
    }
  },
  resolveWeReadClient(): WeReadClient {
    const globalData = getApp<MiniappApp>().globalData as MiniappApp["globalData"] & {
      wereadClient?: unknown;
      weReadClient?: unknown;
      weread?: unknown;
    };
    return resolveWeReadClient(globalData.wereadClient ?? globalData.weReadClient ?? globalData.weread);
  },
});
