import type { MiniappApp } from "../../app";
import type { BookDetail, DevelopmentState, ReadingBackground } from "../../adapters/client";
import { parseDevelopmentState } from "../../adapters/client";
import {
  buildReaderBlocks,
  createReaderPositionSaver,
  readerBlockFromScroll,
  readerSectionBlockIndexes,
  readViewportHeight,
  restoreReaderBlock,
  toReadingPosition,
  type ReaderBlock,
  type ReaderBlockGeometry,
} from "../../core/reader-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";
import {
  READER_SWIPE_HINT_DISMISS_MS,
  advanceReaderSwipeHint,
  backgroundSaveFailure,
  clearReaderFilter,
  createReaderContentContext,
  dismissReaderSwipeHint,
  introDensityForHeight,
  normalizeReaderBackground,
  pptConversationUrl,
  preserveReaderFailureContext,
  readerSheetAfterDrag,
  readerSheetDragStart,
  readerSheetGestureOwner,
  readerRetryState,
  readerSwipeHintNeedsReset,
  readerSwipeZone,
  rememberReaderContentContext,
  resetReaderSwipeHint,
  restoreReaderBackground,
  restoreReaderRetryContext,
  type ReaderContentContext,
  type ReaderContentTab,
  type ReaderIntroDensity,
  type ReaderFailureContext,
  type ReaderSheetState,
  type ReaderSwipeHintState,
} from "./page-state";

type ReaderData = {
  phase: "loading" | "ready" | "empty" | "filtered-empty" | "failed";
  error: string;
  retrying: boolean;
  failureContext: ReaderFailureContext | null;
  detail: BookDetail | null;
  blocks: Array<ReaderBlock & { showTitle: boolean; sectionNumber: number }>;
  sectionBlockIndexes: Array<number | null>;
  blockGeometry: ReaderBlockGeometry[];
  currentIndex: number;
  viewportHeight: number;
  introHeight: number;
  introDensity: ReaderIntroDensity;
  introSwipeState: ReaderSwipeHintState;
  controlsVisible: boolean;
  sheetKind: "" | "catalog" | "content" | "settings";
  sheetState: ReaderSheetState;
  sheetOrigin: ReaderSheetState;
  sheetStyle: string;
  contentTab: "highlights" | "notes" | "ppt";
  contentScrollTops: Record<ReaderContentTab, number>;
  contentDrafts: Record<ReaderContentTab, string>;
  noteEditorState: ReaderNoteEditorState;
  noteSaveError: string;
  panelState: DevelopmentState;
  theme: ReadingBackground;
  progressLabel: string;
  saveError: string;
  scrollIntoView: string;
  developmentAdapter: boolean;
  coverAsset: string;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
};

type ReaderNoteEditorState = "closed" | "editing" | "failed";

const covers = [
  "/assets/book-covers/local-default-celadon-ink-v1.png",
  "/assets/book-covers/local-default-amber-lamp-v1.png",
  "/assets/book-covers/local-default-indigo-sea-v1.png",
];

const initialContentContext = createReaderContentContext();

const readerFixtureCopy = {
  introduction: "一段适合慢慢阅读、随手记录的内容。",
  sectionBody: "正文沿着自然的阅读流展开。阅读区域不会强制分页；字号、行距和窗口宽度变化时，段落会自然重排。",
  sectionContinuation: "介绍内容与章节正文处于同一条滚动流中，阅读位置会随阅读进度保留。",
  sectionControls: "轻点正文可以呼出阅读操作层，目录、书籍内容、阅读背景和制作 PPT 都可从这里进入。",
  highlightQuote: "把阅读中的发现留给自己。",
  highlightBody: "保留重要片段，随时回来继续整理。",
  highlightMeta: "来自本书",
  noteMeta: "读书笔记",
} as const;

function readerDetailForDisplay(detail: BookDetail): BookDetail {
  if (!detail.book.id.startsWith("dev-")) return detail;
  const cleanSectionBody = (body: string) => body
    .replace(/这段文字只用于验证小程序正文的自然连续纵向滚动。它不是线上书籍内容，也不会写入服务端。阅读区域不设置固定页高，不启用整页吸附；字号、行距和窗口宽度变化时，段落会自然重排。/g, readerFixtureCopy.sectionBody)
    .replace(/当读者继续向上滑动，介绍内容与章节正文处于同一条滚动流中。定位块只帮助记录全书位置，不参与视觉分页。滚动停止后，开发适配器仅在当前运行内存中记录最近位置。/g, readerFixtureCopy.sectionContinuation)
    .replace(/轻点正文非交互区域可以呼出阅读操作层，继续滚动会再次隐藏。目录、书籍内容、阅读设置和制作 PPT 保持清晰返回路径，并为底部安全区留出空间。/g, readerFixtureCopy.sectionControls);
  const cleanText = (value: string | undefined, fallback: string) => value && /开发适配器|本地开发|开发样本|服务端|本次运行|当前运行|不会写入|只用于验证|验证小程序|底部安全区|模拟|测试|模型接入|viewport|safe[- ]area|keyboard|\bF[2345]\b|\bH3\b/i.test(value)
    ? fallback
    : value;
  return {
    ...detail,
    book: {
      ...detail.book,
      author: cleanText(detail.book.author, "作者未知") ?? "作者未知",
      sourceLabel: detail.book.sourceLabel === "本地" ? "已导入" : detail.book.sourceLabel,
    },
    introduction: cleanText(detail.introduction, readerFixtureCopy.introduction) ?? readerFixtureCopy.introduction,
    sections: detail.sections.map((section) => ({ ...section, body: cleanSectionBody(section.body) })),
    highlights: detail.highlights.map((item) => ({
      ...item,
      quote: cleanText(item.quote, readerFixtureCopy.highlightQuote),
      body: cleanText(item.body, readerFixtureCopy.highlightBody) ?? readerFixtureCopy.highlightBody,
      meta: cleanText(item.meta, readerFixtureCopy.highlightMeta) ?? readerFixtureCopy.highlightMeta,
    })),
    notes: detail.notes.map((item) => ({
      ...item,
      quote: cleanText(item.quote, readerFixtureCopy.highlightQuote),
      body: cleanText(item.body, readerFixtureCopy.highlightBody) ?? readerFixtureCopy.highlightBody,
      meta: cleanText(item.meta, readerFixtureCopy.noteMeta) ?? readerFixtureCopy.noteMeta,
    })),
    works: detail.works.map((item) => ({
      ...item,
      title: cleanText(item.title, "阅读作品") ?? "阅读作品",
      meta: cleanText(item.meta, "稍后可查看") ?? "稍后可查看",
    })),
  };
}

function readerErrorForDisplay(error: unknown): string {
  const message = readableError(error);
  return /开发适配器|服务端|当前主线|模拟|测试|模型接入|\bF[2345]\b|\bH3\b/i.test(message)
    ? "内容暂时无法载入，请稍后重试。"
    : message;
}

Page<ReaderData>({
  data: {
    phase: "loading",
    error: "",
    retrying: false,
    failureContext: null,
    detail: null,
    blocks: [],
    sectionBlockIndexes: [],
    blockGeometry: [],
    currentIndex: 0,
    viewportHeight: 667,
    introHeight: 667,
    introDensity: "regular",
    introSwipeState: "visible",
    controlsVisible: false,
    sheetKind: "",
    sheetState: "closed",
    sheetOrigin: "closed",
    sheetStyle: "",
    contentTab: "highlights",
    contentScrollTops: initialContentContext.scrollTop,
    contentDrafts: initialContentContext.drafts,
    noteEditorState: "closed",
    noteSaveError: "",
    panelState: "normal",
    theme: "light",
    progressLabel: "0%",
    saveError: "",
    scrollIntoView: "",
    developmentAdapter: false,
    coverAsset: covers[0]!,
    keyboardOpen: false,
    viewportStyle: "",
    viewportMetrics: "",
  },
  onLoad(options: { id?: string; state?: string; panelState?: string }) {
    const app = getApp<MiniappApp>();
    this.isUnloaded = false;
    const nextBookId = options.id ? decodeURIComponent(options.id) : "";
    const isNewBook = readerSwipeHintNeedsReset(this.bookId, nextBookId, this.swipeHintResetOnUnload === true);
    this.bookId = nextBookId;
    this.swipeHintResetOnUnload = false;
    if (isNewBook) {
      this.cancelSwipeHintDismissal();
      this.swipeHintGeneration = (this.swipeHintGeneration ?? 0) + 1;
    }
    this.developmentState = parseDevelopmentState(options.state, app.globalData.developmentAdapter);
    this.positionSaver = createReaderPositionSaver((index) => this.savePosition(index));
    const viewportHeight = readViewportHeight(wx);
    this.setData({
      viewportHeight,
      introHeight: viewportHeight,
      introDensity: introDensityForHeight(viewportHeight),
      introSwipeState: isNewBook ? resetReaderSwipeHint(nextBookId).state : this.data.introSwipeState,
      panelState: parseDevelopmentState(options.panelState, app.globalData.developmentAdapter),
      developmentAdapter: app.globalData.developmentAdapter,
    });
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (this.isUnloaded) return;
      this.setData({
        ...viewportPresentation(geometry),
        viewportHeight: geometry.availableHeight,
        introDensity: introDensityForHeight(geometry.availableHeight),
      }, () => {
        if (this.data.phase === "ready") this.measureIntroHeight();
      });
    });
    if (!this.bookId) {
      this.setData({ phase: "failed", error: "缺少书籍信息" });
      return;
    }
    void this.loadBook();
  },
  onReady() { this.measureIntroHeight(); },
  onShow() {
    this.isUnloaded = false;
    if (!this.swipeHintResetOnReturn) return;
    this.swipeHintResetOnReturn = false;
    this.cancelSwipeHintDismissal();
    this.setData({ introSwipeState: resetReaderSwipeHint(this.bookId ?? "").state });
  },
  onHide() {
    this.swipeHintResetOnReturn = true;
    void this.positionSaver?.flush();
  },
  onUnload() {
    this.isUnloaded = true;
    this.swipeHintResetOnUnload = true;
    this.cancelSwipeHintDismissal();
    this.swipeHintGeneration = (this.swipeHintGeneration ?? 0) + 1;
    this.releaseViewport?.();
    void this.positionSaver?.flush();
  },
  async loadBook(options?: { preserveShell?: boolean }) {
    const state = (this.developmentState ?? "normal") as DevelopmentState;
    if (state === "loading") {
      this.setData({ phase: "loading", error: "" });
      return;
    }
    const requestId = (this.readerLoadRequestId ?? 0) + 1;
    this.readerLoadRequestId = requestId;
    const requestRevision = this.readerStateRevision ?? 0;
    const existingDetail = this.data.detail;
    const retryContext = this.data.failureContext;
    if (options?.preserveShell && existingDetail) this.setData({ error: "" });
    else this.setData({ phase: "loading", error: "", retrying: false, failureContext: null });
    let recoveryDetail = existingDetail;
    try {
      const client = getApp<MiniappApp>().globalData.client;
      if (state === "failed" && !recoveryDetail && this.data.developmentAdapter) {
        recoveryDetail = await client.getBook(this.bookId, "normal");
      }
      const detail = readerDetailForDisplay(await client.getBook(this.bookId, state));
      if (requestId !== this.readerLoadRequestId) return;
      const { blocks, currentIndex: restoredIndex, sectionBlockIndexes } = this.bookPresentation(detail);
      if (!blocks.length) {
        this.setData({
          phase: state === "filtered-empty" ? "filtered-empty" : "empty",
          error: "",
          retrying: false,
          failureContext: null,
          detail,
          blocks: [],
          sectionBlockIndexes: [],
          blockGeometry: [],
        });
        return;
      }
      this.latestPositionVersion = detail.position?.version ?? 0;
      const recovered = restoreReaderRetryContext(retryContext, detail.book.id, blocks.length, {
        currentIndex: restoredIndex,
        theme: restoreReaderBackground(detail.position),
        progressLabel: `${Math.round((detail.position?.progress ?? 0) * 100)}%`,
      });
      const preserveLocalReaderState = (this.readerStateRevision ?? 0) !== requestRevision;
      const currentIndex = preserveLocalReaderState ? this.data.currentIndex : recovered.currentIndex;
      const theme = preserveLocalReaderState ? this.data.theme : recovered.theme;
      this.setData({
        phase: "ready",
        error: "",
        retrying: false,
        failureContext: null,
        detail,
        blocks,
        sectionBlockIndexes,
        blockGeometry: [],
        currentIndex,
        theme,
        progressLabel: recovered.progressLabel,
        scrollIntoView: preserveLocalReaderState ? this.data.scrollIntoView : recovered.scrollIntoView,
        coverAsset: covers[Math.abs(detail.book.coverVariant) % covers.length]!,
      }, () => {
        this.measureIntroHeight();
        this.measureReaderGeometry();
      });
    } catch (error) {
      if (requestId !== this.readerLoadRequestId) return;
      const message = readerErrorForDisplay(error);
      if (!existingDetail && recoveryDetail) {
        recoveryDetail = readerDetailForDisplay(recoveryDetail);
        const { blocks, currentIndex, sectionBlockIndexes } = this.bookPresentation(recoveryDetail);
        const theme = restoreReaderBackground(recoveryDetail.position);
        const progressLabel = `${Math.round((recoveryDetail.position?.progress ?? 0) * 100)}%`;
        this.latestPositionVersion = recoveryDetail.position?.version ?? 0;
        const context: ReaderFailureContext = {
          bookId: recoveryDetail.book.id,
          bookTitle: recoveryDetail.book.title,
          bookAuthor: recoveryDetail.book.author ?? "作者未知",
          sourceLabel: recoveryDetail.book.sourceLabel,
          theme,
          currentIndex,
          progressLabel,
          hasLoadedContent: blocks.length > 0,
        };
        this.setData({
          ...preserveReaderFailureContext(context, message),
          detail: recoveryDetail,
          blocks,
          sectionBlockIndexes,
          blockGeometry: [],
          currentIndex,
          theme,
          progressLabel,
          coverAsset: covers[Math.abs(recoveryDetail.book.coverVariant) % covers.length]!,
        });
        return;
      }
      const context = existingDetail ? {
        bookId: existingDetail.book.id,
        bookTitle: existingDetail.book.title,
        bookAuthor: existingDetail.book.author ?? "作者未知",
        sourceLabel: existingDetail.book.sourceLabel,
        theme: this.data.theme,
        currentIndex: this.data.currentIndex,
        progressLabel: this.data.progressLabel,
        hasLoadedContent: this.data.blocks.length > 0,
      } : null;
      this.setData(preserveReaderFailureContext(context, message));
    }
  },
  bookPresentation(detail: BookDetail) {
    const rawBlocks = buildReaderBlocks(detail.sections);
    const blocks = rawBlocks.map((block, index) => ({
      ...block,
      showTitle: index === 0 || rawBlocks[index - 1]?.sectionId !== block.sectionId,
      sectionNumber: detail.sections.findIndex((section) => section.id === block.sectionId) + 1,
    }));
    return {
      blocks,
      currentIndex: restoreReaderBlock(blocks, detail.position),
      sectionBlockIndexes: readerSectionBlockIndexes(blocks, detail.sections),
    };
  },
  retryBook() {
    const context = this.data.failureContext;
    this.setData(readerRetryState(this.data.phase, context), () => {
      if (this.developmentState === "failed") this.developmentState = "normal";
      void this.loadBook({ preserveShell: Boolean(this.data.detail) });
    });
  },
  measureIntroHeight() {
    if (this.data.phase !== "ready") return;
    wx.createSelectorQuery().select(".reader-intro").boundingClientRect((rect) => {
      if (!rect || rect.height <= 0 || this.isUnloaded) return;
      this.setData({ introHeight: rect.height }, () => this.measureReaderGeometry(this.lastScrollTop ?? 0));
    }).exec();
  },
  measureReaderGeometry(scrollTop?: number) {
    if (this.data.phase !== "ready" || !this.data.blocks.length) return;
    const measuredScrollTop = scrollTop ?? this.lastScrollTop ?? 0;
    const request = (this.geometryRequest ?? 0) + 1;
    this.geometryRequest = request;
    let scrollRect: MiniappClientRect | null = null;
    let blockRects: MiniappClientRect[] | null = null;
    const commit = () => {
      if (this.isUnloaded || request !== this.geometryRequest || !scrollRect || !blockRects) return;
      if (blockRects.length !== this.data.blocks.length) return;
      const introHeight = Math.max(0, Number.isFinite(this.data.introHeight) ? this.data.introHeight : 0);
      const geometry = blockRects.map((rect) => ({
        offsetTop: Math.max(introHeight, rect.top - scrollRect!.top + measuredScrollTop),
        height: Math.max(1, rect.height),
      }));
      this.setData({ blockGeometry: geometry });
    };
    const query = wx.createSelectorQuery();
    query.select(".reader-scroll").boundingClientRect((rect) => {
      scrollRect = rect;
      commit();
    });
    query.selectAll(".reader-block").boundingClientRect((rects) => {
      blockRects = rects;
      commit();
    });
    query.exec();
  },
  onScroll(event: MiniappEvent<{ scrollTop: number; scrollHeight: number }>) {
    const scrollTop = Number.isFinite(event.detail.scrollTop) ? Math.max(0, event.detail.scrollTop) : 0;
    this.lastScrollTop = scrollTop;
    const swipeHint = advanceReaderSwipeHint(
      { bookId: this.bookId ?? "", state: this.data.introSwipeState },
      readerSwipeZone(scrollTop, this.data.introHeight),
    );
    if (swipeHint.state !== this.data.introSwipeState) {
      this.setData({ introSwipeState: swipeHint.state });
      if (swipeHint.state === "dismissing") this.scheduleSwipeHintDismissal();
      else if (swipeHint.state === "visible") this.cancelSwipeHintDismissal();
    }
    this.measureReaderGeometry(scrollTop);
    const geometry = this.data.blockGeometry;
    const currentIndex = geometry.length === this.data.blocks.length
      ? readerBlockFromScroll(geometry, {
        scrollTop,
        scrollHeight: event.detail.scrollHeight,
        viewportHeight: this.data.viewportHeight,
      })
      : this.data.currentIndex;
    if (currentIndex !== this.data.currentIndex) {
      this.readerStateRevision = (this.readerStateRevision ?? 0) + 1;
      this.setData({ currentIndex, saveError: "" });
    }
    if (geometry.length === this.data.blocks.length && scrollTop > this.data.viewportHeight * .72) this.positionSaver.schedule(currentIndex);
    if (this.data.controlsVisible) this.setData({ controlsVisible: false });
  },
  scheduleSwipeHintDismissal() {
    this.cancelSwipeHintDismissal();
    const generation = (this.swipeHintGeneration ?? 0) + 1;
    this.swipeHintGeneration = generation;
    this.swipeHintDismissTimer = setTimeout(() => {
      if (this.isUnloaded || generation !== this.swipeHintGeneration) return;
      this.completeSwipeHintDismissal();
    }, READER_SWIPE_HINT_DISMISS_MS);
  },
  cancelSwipeHintDismissal() {
    if (this.swipeHintDismissTimer) clearTimeout(this.swipeHintDismissTimer);
    this.swipeHintDismissTimer = undefined;
  },
  completeSwipeHintDismissal() {
    this.cancelSwipeHintDismissal();
    const hint = dismissReaderSwipeHint({ bookId: this.bookId ?? "", state: this.data.introSwipeState });
    if (hint.state !== this.data.introSwipeState) this.setData({ introSwipeState: hint.state });
  },
  onSwipeHintAnimationEnd() {
    this.completeSwipeHintDismissal();
  },
  toggleControls() {
    if (this.data.sheetKind) return;
    this.setData({ controlsVisible: !this.data.controlsVisible });
  },
  noop() {},
  goBack() { wx.navigateBack(); },
  showMore() {
    wx.showModal({ title: "更多阅读操作", content: "专注阅读与正文标记功能正在准备中。", showCancel: false });
  },
  openSheet(event: MiniappEvent) {
    const kind = String(event.currentTarget.dataset.kind) as ReaderData["sheetKind"];
    if (kind !== "catalog" && kind !== "content" && kind !== "settings") return;
    this.sheetDragOrigin = "initial";
    this.sheetTouchStartY = undefined;
    this.sheetTouchLastY = undefined;
    this.sheetGestureOwner = undefined;
    const next = this.contentContext();
    this.setData({
      sheetKind: kind,
      sheetState: "initial",
      sheetOrigin: "initial",
      sheetStyle: "",
      controlsVisible: true,
      contentTab: next.activeTab,
      contentScrollTops: next.scrollTop,
      contentDrafts: next.drafts,
    });
  },
  closeSheet() {
    this.sheetDragOrigin = undefined;
    this.sheetTouchStartY = undefined;
    this.sheetTouchLastY = undefined;
    this.sheetGestureOwner = undefined;
    this.setData({
      sheetKind: "",
      sheetState: "closed",
      sheetOrigin: "closed",
      sheetStyle: "",
    });
  },
  readTouchY(event: MiniappEvent): number | null {
    const touchEvent = event as unknown as {
      touches?: Array<{ clientY?: number; pageY?: number; y?: number }>;
      changedTouches?: Array<{ clientY?: number; pageY?: number; y?: number }>;
    };
    const touch = touchEvent.touches?.[0] ?? touchEvent.changedTouches?.[0];
    const y = touch?.clientY ?? touch?.pageY ?? touch?.y;
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  },
  onSheetTouchStart(event: MiniappEvent) {
    if (!this.data.sheetKind || this.data.sheetState === "closed") return;
    const y = this.readTouchY(event);
    if (y === null) return;
    const origin = this.data.sheetState === "dragging"
      ? this.sheetDragOrigin ?? "initial"
      : this.data.sheetState;
    if (origin === "closed" || origin === "dragging") return;
    this.sheetDragOrigin = origin;
    this.sheetTouchStartY = y;
    this.sheetTouchLastY = y;
    this.sheetGestureOwner = undefined;
    this.setData({ sheetState: readerSheetDragStart(origin), sheetOrigin: origin, sheetStyle: "" });
  },
  onSheetTouchMove(event: MiniappEvent) {
    if (this.sheetTouchStartY === undefined || !this.sheetDragOrigin) return;
    const y = this.readTouchY(event);
    if (y === null) return;
    this.sheetTouchLastY = y;
    const deltaY = y - this.sheetTouchStartY;
    const direction = deltaY < 0 ? "up" : "down";
    const contentScrollTop = this.data.contentScrollTops[this.data.contentTab] ?? 0;
    const owner = readerSheetGestureOwner(this.sheetDragOrigin, direction, contentScrollTop);
    this.sheetGestureOwner = owner;
    if (owner === "content") {
      this.setData({ sheetState: this.sheetDragOrigin, sheetOrigin: this.sheetDragOrigin, sheetStyle: "" });
      return;
    }
    const offset = this.sheetDragOrigin === "fullscreen"
      ? Math.max(0, deltaY)
      : Math.max(-Math.max(0, this.data.viewportHeight), Math.min(180, deltaY));
    this.setData({ sheetState: "dragging", sheetOrigin: this.sheetDragOrigin, sheetStyle: `--reader-sheet-drag-offset: ${Math.round(offset)}px;` });
  },
  onSheetTouchEnd(event: MiniappEvent) {
    if (this.sheetTouchStartY === undefined || !this.sheetDragOrigin) return;
    const y = this.readTouchY(event) ?? this.sheetTouchLastY ?? this.sheetTouchStartY;
    const deltaY = y - this.sheetTouchStartY;
    const origin = this.sheetDragOrigin;
    const owner = this.sheetGestureOwner;
    this.sheetTouchStartY = undefined;
    this.sheetTouchLastY = undefined;
    this.sheetDragOrigin = undefined;
    this.sheetGestureOwner = undefined;
    if (owner === "content") {
      this.setData({ sheetState: origin, sheetOrigin: origin, sheetStyle: "" });
      return;
    }
    const nextState = readerSheetAfterDrag(origin, deltaY);
    if (nextState === "closed") {
      this.closeSheet();
      return;
    }
    this.setData({ sheetState: nextState, sheetOrigin: nextState, sheetStyle: "" });
  },
  contentContext(): ReaderContentContext {
    return this.readerContentContext ?? createReaderContentContext();
  },
  onContentScroll(event: MiniappEvent<{ scrollTop?: number }>) {
    const scrollTop = Number.isFinite(event.detail.scrollTop) ? Math.max(0, event.detail.scrollTop ?? 0) : 0;
    const eventTab = String(event.currentTarget.dataset.tab);
    const tab: ReaderContentTab = eventTab === "notes" || eventTab === "ppt" ? eventTab : "highlights";
    const next = rememberReaderContentContext(this.contentContext(), { scrollTop: { [tab]: scrollTop } });
    this.readerContentContext = next;
    this.setData({ contentScrollTops: next.scrollTop });
  },
  onContentDraftInput(event: MiniappEvent<{ value?: string }>) {
    const value = typeof event.detail.value === "string" ? event.detail.value : "";
    const next = rememberReaderContentContext(this.contentContext(), { drafts: { notes: value } });
    this.readerContentContext = next;
    this.setData({
      contentDrafts: next.drafts,
      noteEditorState: this.data.noteEditorState === "failed" ? "editing" : this.data.noteEditorState,
      noteSaveError: "",
    });
  },
  openNoteComposer() {
    this.setData({ noteEditorState: "editing", noteSaveError: "" });
  },
  closeNoteComposer() {
    this.setData({ noteEditorState: "closed", noteSaveError: "" });
  },
  saveNote() {
    if (!this.data.contentDrafts.notes.trim()) {
      this.setData({ noteEditorState: "editing", noteSaveError: "先写下想法，再尝试保存。" });
      return;
    }
    this.setData({
      noteEditorState: "failed",
      noteSaveError: "笔记保存接口尚未接入，内容已保留；请稍后重试。",
    });
  },
  jumpToSection(event: MiniappEvent) {
    const blockIndex = Number(event.currentTarget.dataset.blockIndex);
    const target = String(event.currentTarget.dataset.target ?? "");
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= this.data.blocks.length || !target) {
      wx.showToast({ title: "本章暂无可跳转正文", icon: "none" });
      return;
    }
    this.setData({
      sheetKind: "",
      sheetState: "closed",
      sheetOrigin: "closed",
      sheetStyle: "",
      controlsVisible: false,
      currentIndex: blockIndex,
      scrollIntoView: target,
    });
    this.readerStateRevision = (this.readerStateRevision ?? 0) + 1;
    this.positionSaver?.schedule(blockIndex);
  },
  switchTab(event: MiniappEvent) {
    const tab = String(event.currentTarget.dataset.tab) as ReaderData["contentTab"];
    if (tab !== "highlights" && tab !== "notes" && tab !== "ppt") return;
    const next = rememberReaderContentContext(this.contentContext(), { activeTab: tab });
    this.readerContentContext = next;
    this.setData({ contentTab: next.activeTab, contentScrollTops: next.scrollTop, contentDrafts: next.drafts });
  },
  retryPanel() { this.setData({ panelState: "normal" }); },
  chooseTheme(event: MiniappEvent) {
    const theme = normalizeReaderBackground(event.currentTarget.dataset.theme);
    this.readerStateRevision = (this.readerStateRevision ?? 0) + 1;
    this.setData({ theme, saveError: "" });
    void this.savePosition(this.data.currentIndex, theme, "background");
  },
  clearFilter() {
    this.developmentState = clearReaderFilter(this.developmentState);
    void this.loadBook();
  },
  openPpt() {
    const detail = this.data.detail;
    if (!detail) return;
    const intent = getApp<MiniappApp>().globalData.pptIntentStore.selectBook({
      id: detail.book.id,
      title: detail.book.title,
    });
    if (!intent) {
      wx.showModal({
        title: "PPT 制作暂不可用",
        content: "请先在当前会话中准备好书籍内容，再继续制作。",
        showCancel: false,
      });
      return;
    }
    wx.navigateTo({ url: pptConversationUrl() });
  },
  showDownloadBoundary() {
    wx.showModal({
      title: "下载功能暂不可用",
      content: "作品准备好后，可从这里下载并继续编辑。",
      showCancel: false,
    });
  },
  openConversation() { wx.reLaunch({ url: "/pages/conversation/index" }); },
  retryPosition() { void this.positionSaver?.flush(this.data.currentIndex); },
  async savePosition(index: number, background?: ReadingBackground, failureKind: "position" | "background" = "position") {
    const detail = this.data.detail;
    if (!detail || !this.data.blocks.length) return;
    const selectedBackground = background ?? this.data.theme;
    try {
      const position = await getApp<MiniappApp>().globalData.client.savePosition(
        detail.book.id,
        toReadingPosition(this.data.blocks, index, this.latestPositionVersion ?? 0, selectedBackground),
      );
      this.latestPositionVersion = position.version;
      if (!this.isUnloaded) this.setData({ progressLabel: `${Math.round(position.progress * 100)}%`, saveError: "" });
    } catch (error) {
      if (!this.isUnloaded) {
        const message = readerErrorForDisplay(error);
        this.setData(failureKind === "background"
          ? backgroundSaveFailure(selectedBackground, message)
          : { saveError: `${message}，阅读位置尚未保存` });
      }
    }
  },
});
