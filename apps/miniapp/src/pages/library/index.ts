import type { MiniappApp } from "../../app";
import { parseDevelopmentState, type DevelopmentState } from "../../adapters/client";
import { preserveLibraryOnFailure, presentLibrary, type BookSummary, type LibraryPresentation } from "../../core/library-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";

type VisibleBook = BookSummary & { coverAsset: string; progressLabel: string };
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

Page<LibraryData>({
  data: {
    phase: "loading",
    books: [],
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
    const state = (this.developmentState ?? "normal") as DevelopmentState;
    if (state === "loading") {
      this.present({ phase: "loading", books: [], query: this.data.query, queryApplied: false });
      wx.stopPullDownRefresh();
      return;
    }
    if (!this.data.books.length) this.present({ phase: "loading", books: [], query: this.data.query, queryApplied: false });
    let recoveryBooks = this.data.books;
    try {
      const app = getApp<MiniappApp>();
      const client = app.globalData.client;
      if (state === "failed" && !recoveryBooks.length && app.globalData.developmentAdapter) {
        recoveryBooks = await client.listBooks({ query: "", state: "normal" });
      }
      const query = state === "filtered-empty" ? "无匹配书名" : this.data.query;
      const request = app.globalData.developmentAdapter ? { query, state } : { query };
      const books = await client.listBooks(request);
      this.present({ phase: "ready", books, query, queryApplied: true });
      this.setData({ notice: "" });
    } catch (error) {
      const recovered = preserveLibraryOnFailure(
        { books: recoveryBooks, query: this.data.query, queryApplied: this.data.queryApplied },
        readableError(error),
      );
      this.present(recovered);
      if ("notice" in recovered) this.setData({ notice: recovered.notice });
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  present(state: {
    phase: "loading" | "ready" | "failed";
    books: BookSummary[];
    query: string;
    queryApplied?: boolean;
    error?: string;
  }) {
    const presentation = presentLibrary(state);
    const visibleBooks = presentation.kind === "content"
      ? presentation.books.map((book) => ({
        ...book,
        coverAsset: coverAssets[Math.abs(book.coverVariant) % coverAssets.length]!,
        progressLabel: `${Math.round(book.progress * 100)}%`,
      }))
      : [];
    this.setData({
      ...state,
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
      queryApplied: false,
      error: this.data.error,
    });
  },
  clearSearch() {
    this.present({ phase: "ready", books: this.data.books, query: "", queryApplied: false });
    void this.loadBooks();
  },
  retryBooks() {
    if (this.developmentState === "failed") this.developmentState = "normal";
    void this.loadBooks();
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
    wx.showModal({
      title: "微信读书等待接入",
      content: "真实 API Key、同步与账户隔离等待 M2-F1 / F2，并停在外部授权门前。",
      showCancel: false,
    });
  },
  openBook(event: MiniappEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    wx.navigateTo({ url: `/pages/reader/index?id=${encodeURIComponent(id)}` });
  },
});
