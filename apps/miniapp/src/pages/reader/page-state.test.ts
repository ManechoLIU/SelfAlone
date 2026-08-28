import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BookDetail } from "../../adapters/client";
import { AnnotationsApiError } from "../../core/annotations-api";
import readerWxml from "./index.wxml?raw";
import readerWxss from "./index.wxss?raw";
import {
  READER_SWIPE_HINT_DISMISS_MS,
  READER_SWIPE_HINT_REDUCED_DISMISS_MS,
  advanceReaderSwipeHint,
  backgroundSaveFailure,
  clearReaderFilter,
  dismissReaderSwipeHint,
  introDensityForHeight,
  pptConversationUrl,
  readerSwipeHintNeedsReset,
  readerSwipeZone,
  preserveReaderFailureContext,
  readerRetryState,
  resetReaderSwipeHint,
  restoreReaderRetryContext,
  restoreReaderBackground,
} from "./page-state";
import * as readerPageState from "./page-state";

type ReaderPageHarness = {
  data: Record<string, any>;
  bookId: string;
  developmentState: string;
  latestPositionVersion?: number;
  isUnloaded?: boolean;
  setData(patch: Record<string, any>, callback?: () => void): void;
  loadBook(options?: { preserveShell?: boolean }): Promise<void>;
  chooseTheme(event: { currentTarget: { dataset: { theme: string } } }): void;
  openSheet(event: { currentTarget: { dataset: { kind: string } } }): void;
  closeSheet(): void;
  measureIntroHeight(): void;
  measureReaderGeometry(): void;
  [key: string]: any;
};

let readerPageDefinition: ReaderPageHarness;
let readerClient: {
  getBook: ReturnType<typeof vi.fn>;
  savePosition: ReturnType<typeof vi.fn>;
};
let annotationsClient: {
  getAnnotations: ReturnType<typeof vi.fn>;
  createNote: ReturnType<typeof vi.fn>;
  updateNote: ReturnType<typeof vi.fn>;
  deleteNote: ReturnType<typeof vi.fn>;
};

function createReaderPage(): ReaderPageHarness {
  return {
    ...readerPageDefinition,
    data: JSON.parse(JSON.stringify(readerPageDefinition.data)) as Record<string, any>,
    setData(this: ReaderPageHarness, patch: Record<string, any>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
    measureIntroHeight() {},
    measureReaderGeometry() {},
  };
}

function readerDetailWithBackground(background: "light" | "dark"): BookDetail {
  return {
    book: {
      id: "reader-page-test-book",
      title: "页面测试书籍",
      author: "测试作者",
      source: "local",
      sourceLabel: "已导入",
      format: "txt",
      progress: 0.42,
      coverVariant: 0,
    },
    introduction: "用于页面状态回归的介绍。",
    sections: [{
      id: "test-section",
      index: 0,
      title: "第一节",
      body: "正文内容。".repeat(120),
      locator: "section:0",
    }],
    position: {
      sectionId: "test-section",
      offset: 0,
      progress: 0.42,
      background,
      version: 3,
    },
    highlights: [],
    notes: [],
    works: [],
  };
}

beforeAll(async () => {
  readerClient = {
    getBook: vi.fn(),
    savePosition: vi.fn(async (_bookId: string, input: Record<string, unknown>) => ({
      ...input,
      progress: input.progress,
      version: Number(input.expectedVersion ?? 0) + 1,
    })),
  };
  annotationsClient = {
    getAnnotations: vi.fn(async () => ({ fileVersion: 1, highlights: [], notes: [] })),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  };
  vi.stubGlobal("Page", (definition: ReaderPageHarness) => { readerPageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({
    globalData: {
      client: readerClient,
      annotationsClient,
      developmentAdapter: true,
      pptIntentStore: { selectBook: vi.fn() },
    },
  }));
  vi.stubGlobal("wx", {});
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type ReaderSheetStateForTest = "closed" | "initial" | "dragging" | "fullscreen" | "collapsed";
type ReaderContentTabForTest = "highlights" | "notes" | "ppt";

const sheetState = readerPageState as typeof readerPageState & {
  readerSheetDragStart: (state: ReaderSheetStateForTest) => ReaderSheetStateForTest;
  readerSheetAfterDrag: (origin: Exclude<ReaderSheetStateForTest, "closed" | "dragging">, deltaY: number, threshold?: number) => ReaderSheetStateForTest;
  readerSheetGestureOwner: (state: ReaderSheetStateForTest, direction: "up" | "down", contentScrollTop: number) => "sheet" | "content";
  createReaderContentContext: () => {
    activeTab: ReaderContentTabForTest;
    scrollTop: Record<ReaderContentTabForTest, number>;
    drafts: Record<ReaderContentTabForTest, string>;
  };
  rememberReaderContentContext: (context: {
    activeTab: ReaderContentTabForTest;
    scrollTop: Record<ReaderContentTabForTest, number>;
    drafts: Record<ReaderContentTabForTest, string>;
  }, update: {
    activeTab?: ReaderContentTabForTest;
    scrollTop?: Partial<Record<ReaderContentTabForTest, number>>;
    drafts?: Partial<Record<ReaderContentTabForTest, string>>;
  }) => {
    activeTab: ReaderContentTabForTest;
    scrollTop: Record<ReaderContentTabForTest, number>;
    drafts: Record<ReaderContentTabForTest, string>;
  };
  normalizeReaderBackground: (value: unknown) => "light" | "dark";
};

describe("reader page state", () => {
  it("assigns the three intro density bands at their inclusive boundaries", () => {
    expect(introDensityForHeight(600)).toBe("short");
    expect(introDensityForHeight(601)).toBe("regular");
    expect(introDensityForHeight(760)).toBe("regular");
    expect(introDensityForHeight(761)).toBe("tall");
  });

  it("fades only after the reading body becomes active and restores at the intro top", () => {
    const visible = resetReaderSwipeHint("book-a");
    expect(advanceReaderSwipeHint(visible, "intro-active").state).toBe("visible");
    const fading = advanceReaderSwipeHint(visible, "body");
    expect(fading.state).toBe("dismissing");
    expect(dismissReaderSwipeHint(fading).state).toBe("hidden");
    expect(advanceReaderSwipeHint({ ...visible, state: "hidden" }, "intro-active").state).toBe("hidden");
    expect(advanceReaderSwipeHint({ ...visible, state: "hidden" }, "intro-top").state).toBe("visible");
    expect(advanceReaderSwipeHint({ ...visible, state: "dismissing" }, "intro-top").state).toBe("visible");
  });

  it("uses the intro and body boundary as hysteresis without a screenshot-tuned threshold", () => {
    expect(readerSwipeZone(0, 844)).toBe("intro-top");
    expect(readerSwipeZone(0.75, 844)).toBe("intro-top");
    expect(readerSwipeZone(843, 844)).toBe("intro-active");
    expect(readerSwipeZone(844, 844)).toBe("body");
  });

  it("resets only for a new book and exposes the normal/reduced dismissal durations", () => {
    const first = resetReaderSwipeHint("book-a");
    expect(first).toEqual({ bookId: "book-a", state: "visible" });
    expect(resetReaderSwipeHint("book-b")).toEqual({ bookId: "book-b", state: "visible" });
    expect(READER_SWIPE_HINT_DISMISS_MS).toBe(180);
    expect(READER_SWIPE_HINT_REDUCED_DISMISS_MS).toBe(140);
  });

  it("resets after leaving and re-entering even when the same book opens", () => {
    expect(readerSwipeHintNeedsReset("book-a", "book-a", false)).toBe(false);
    expect(readerSwipeHintNeedsReset("book-a", "book-a", true)).toBe(true);
    expect(readerSwipeHintNeedsReset("book-a", "book-b", false)).toBe(true);
  });

  it("keeps long intro content in natural flow without clipping or a second body scroll", () => {
    expect(readerWxml).toContain('class="reader-page reader--{{theme}} {{keyboardOpen ? \'is-keyboard-open\' : \'\'}}" style="{{viewportStyle}}"');
    expect(readerWxml).toContain('class="reader-intro reader-intro--{{introDensity}} {{phase === \'failed\' ? \'is-failed\' : \'\'}}"');
    expect(readerWxml).not.toContain("继续阅读");
    expect(readerWxss).toContain(".reader-intro--short");
    expect(readerWxss).toContain(".reader-intro--regular");
    expect(readerWxss).toContain(".reader-intro--tall");
    expect(readerWxss).toContain("width: 96px");
    expect(readerWxss).toContain(".reader-intro--tall .intro-title { margin-top: 28px; max-width: 12em; font-size: 28px; line-height: 36px; }");
    expect(readerWxss).toContain(".reader-intro--regular .intro-title { margin-top: 22px; max-width: 12em; font-size: 26px; line-height: 34px; }");
    expect(readerWxss).toContain(".reader-intro--short .intro-title { margin-top: 12px; max-width: 12em; font-size: 22px; line-height: 28px; }");
    expect(readerWxss).toContain(".reader-intro--regular .intro-section-title { margin-top: 16px; }");
    expect(readerWxss).toContain(".reader-intro--regular .intro-copy { margin-top: 8px; font-size: 16px; line-height: 28px; }");
    expect(readerWxss).toContain(".reader-intro--regular .intro-progress { margin-top: 4px; }");
    expect(readerWxss).toContain(".reader-intro--regular .intro-swipe { margin-top: 0; }");
    expect(readerWxss).toContain("color: #5f6f69");
    expect(readerWxss).toContain("gap: 6px");
    expect(readerWxss).toContain("width: 20px; height: 20px; opacity: .68");
    expect(readerWxss).toContain("animation: reader-swipe-hint 1600ms ease-in-out infinite");
    expect(readerWxss).toContain("translateY(3px)");
    expect(readerWxss).toContain("translateY(-5px)");
    expect(readerWxss).toContain("animation: reader-swipe-dismiss-reduced 140ms ease-out forwards");
    expect(readerWxml).toContain('bindanimationend="onSwipeHintAnimationEnd"');
    const introRule = readerWxss.match(/\.reader-intro \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(introRule.replaceAll("min-height", "")).not.toMatch(/\bheight\s*:/);
    expect(readerWxss).not.toContain("scroll-snap");
    expect(readerWxss).toContain("height: var(--viewport-height, 100vh)");
    expect(readerWxss).toContain("min-height: var(--viewport-height, 100vh)");
    expect(readerWxss).toContain("var(--safe-top, env(safe-area-inset-top))");
    expect(readerWxss).toContain("var(--safe-bottom, env(safe-area-inset-bottom))");
    const readerScroll = readerWxml.match(/<scroll-view class="reader-scroll"[\s\S]*?<\/scroll-view>/)?.[0] ?? "";
    expect((readerScroll.match(/<scroll-view/g) ?? []).length).toBe(1);
    expect(readerScroll).toContain("{{detail.book.title}}");
    expect(readerScroll).toContain("{{detail.introduction}}");
  });

  it("keeps long control titles readable at narrow widths without ellipsis", () => {
    const controlsTitleRule = readerWxss.match(/\.reader-controls__title\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(readerWxml).toContain('<view class="reader-controls__title">{{detail.book.title}}</view>');
    expect(controlsTitleRule).toContain("min-width: 0");
    expect(controlsTitleRule).toContain("overflow: visible");
    expect(controlsTitleRule).toContain("overflow-wrap: anywhere");
    expect(controlsTitleRule).toContain("text-overflow: clip");
    expect(controlsTitleRule).toContain("white-space: normal");
    expect(controlsTitleRule).not.toContain("overflow: hidden");
    expect(controlsTitleRule).not.toContain("text-overflow: ellipsis");
    expect(controlsTitleRule).not.toContain("white-space: nowrap");
  });

  it("restores the saved light or dark background and defaults to light", () => {
    expect(restoreReaderBackground(null)).toBe("light");
    expect(restoreReaderBackground({ background: "dark" })).toBe("dark");
  });

  it("keeps the selected background visible when saving fails", () => {
    expect(backgroundSaveFailure("dark", "网络不可用")).toEqual({
      theme: "dark",
      saveError: "网络不可用，阅读背景未保存，当前选择仍保留",
    });
  });

  it("clears the development-only reader filter before reloading", () => {
    expect(clearReaderFilter("filtered-empty")).toBe("normal");
    expect(clearReaderFilter("failed")).toBe("failed");
  });

  it("preserves the known book, background and recoverable position while a retry is pending", () => {
    const context = {
      bookId: "dev-local-ink",
      bookTitle: "山窗读书札记",
      bookAuthor: "开发适配器",
      sourceLabel: "本地",
      theme: "dark" as const,
      currentIndex: 7,
      progressLabel: "36%",
      hasLoadedContent: true,
    };

    expect(preserveReaderFailureContext(context, "正文暂时无法加载")).toEqual({
      phase: "failed",
      error: "正文暂时无法加载",
      retrying: false,
      context,
    });
    expect(readerRetryState("failed", context)).toEqual({
      phase: "failed",
      error: "",
      retrying: true,
      context,
    });
    expect(restoreReaderRetryContext(context, "dev-local-ink", 12, {
      currentIndex: 0,
      theme: "light",
      progressLabel: "0%",
    })).toEqual({
      currentIndex: 7,
      theme: "dark",
      progressLabel: "36%",
      scrollIntoView: "reader-block-7",
    });
  });

  it("keeps failure and retry inside the stable reader shell", () => {
    expect(readerWxml).toContain('class="reader-failure-context-header"');
    expect(readerWxml).toContain("{{detail.book.title}}");
    expect(readerWxml).toContain("{{phase === 'failed' ? 'is-failed' : ''}}");
    expect(readerWxml).toContain('wx:if="{{phase === \'failed\'}}" class="reader-inline-failure"');
    expect(readerWxml).toContain('class="reader-inline-failure__action" catchtap="retryBook"');
    expect(readerWxml).toContain('catchtap="retryBook"');
    expect(readerWxml).toContain("{{detail.book.title}}");
    expect(readerWxml).toContain("已读 {{progressLabel}}");
    expect(readerWxml).not.toContain('wx:elif="{{phase === \'failed\'}}" class="reader-state"');
    expect(readerWxss).toContain(".reader-intro.is-failed");
  });

  it("routes a book PPT intent through the current conversation before the workspace", () => {
    expect(pptConversationUrl()).toBe("/pages/conversation/index?intent=ppt");
  });

  it("drives the content sheet through initial, dragging, fullscreen, collapsed and closed", () => {
    expect(typeof sheetState.readerSheetDragStart).toBe("function");
    expect(typeof sheetState.readerSheetAfterDrag).toBe("function");
    expect(sheetState.readerSheetDragStart("initial")).toBe("dragging");
    expect(sheetState.readerSheetAfterDrag("initial", -120)).toBe("fullscreen");
    expect(sheetState.readerSheetDragStart("fullscreen")).toBe("dragging");
    expect(sheetState.readerSheetAfterDrag("fullscreen", 120)).toBe("collapsed");
    expect(sheetState.readerSheetDragStart("collapsed")).toBe("dragging");
    expect(sheetState.readerSheetAfterDrag("collapsed", 120)).toBe("closed");
  });

  it("hands the edge gesture to the sheet before fullscreen and to content after fullscreen", () => {
    expect(typeof sheetState.readerSheetGestureOwner).toBe("function");
    expect(sheetState.readerSheetGestureOwner("initial", "up", 0)).toBe("sheet");
    expect(sheetState.readerSheetGestureOwner("fullscreen", "up", 0)).toBe("content");
    expect(sheetState.readerSheetGestureOwner("fullscreen", "up", 120)).toBe("content");
    expect(sheetState.readerSheetGestureOwner("fullscreen", "down", 0)).toBe("sheet");
  });

  it("keeps the selected tab, every tab scroll position and drafts across sheet reopen", () => {
    expect(typeof sheetState.createReaderContentContext).toBe("function");
    expect(typeof sheetState.rememberReaderContentContext).toBe("function");
    let context = sheetState.createReaderContentContext();
    context = sheetState.rememberReaderContentContext(context, { activeTab: "notes" });
    context = sheetState.rememberReaderContentContext(context, { scrollTop: { highlights: 84, notes: 216, ppt: 32 } });
    context = sheetState.rememberReaderContentContext(context, { drafts: { notes: "尚未提交的想法" } });
    expect(context).toEqual({
      activeTab: "notes",
      scrollTop: { highlights: 84, notes: 216, ppt: 32 },
      drafts: { highlights: "", notes: "尚未提交的想法", ppt: "" },
    });
  });

  it("accepts only light or dark background choices and keeps the selected theme on save failure", () => {
    expect(typeof sheetState.normalizeReaderBackground).toBe("function");
    expect(sheetState.normalizeReaderBackground("dark")).toBe("dark");
    expect(sheetState.normalizeReaderBackground("reader-celadon")).toBe("light");
    expect(backgroundSaveFailure("dark", "网络不可用").theme).toBe("dark");
  });

  it("does not let a stale load response overwrite a newly selected light theme or reading position", async () => {
    const page = createReaderPage();
    const staleDarkDetail = readerDetailWithBackground("dark");
    staleDarkDetail.sections[0]!.body = "正文内容。".repeat(1500);
    const presentation = page.bookPresentation(staleDarkDetail);
    page.bookId = staleDarkDetail.book.id;
    page.developmentState = "normal";
    page.data = {
      ...page.data,
      phase: "ready",
      detail: staleDarkDetail,
      blocks: presentation.blocks,
      sectionBlockIndexes: presentation.sectionBlockIndexes,
      currentIndex: 7,
      theme: "dark",
      sheetKind: "",
      sheetState: "closed",
      sheetOrigin: "closed",
    };

    let resolveReload!: (detail: BookDetail) => void;
    readerClient.getBook.mockImplementationOnce(() => new Promise<BookDetail>((resolve) => {
      resolveReload = resolve;
    }));

    const reload = page.loadBook({ preserveShell: true });
    page.chooseTheme({ currentTarget: { dataset: { theme: "light" } } });
    page.openSheet({ currentTarget: { dataset: { kind: "content" } } });
    page.closeSheet();
    page.openSheet({ currentTarget: { dataset: { kind: "content" } } });
    expect(page.data.theme).toBe("light");

    resolveReload(staleDarkDetail);
    await reload;

    expect(page.data).toMatchObject({
      theme: "light",
      currentIndex: 7,
      sheetKind: "content",
      sheetState: "initial",
    });
  });

  it("renders compact paper previews with explicit selection feedback for light and dark", () => {
    expect(readerWxml).toContain("theme-paper-preview theme-paper-preview--light");
    expect(readerWxml).toContain("theme-paper-preview theme-paper-preview--dark");
    expect(readerWxml).toContain('aria-pressed="{{theme === \'light\'}}"');
    expect(readerWxml).toContain('aria-pressed="{{theme === \'dark\'}}"');
    expect(readerWxss).toContain(".theme-choice.is-selected");
    expect(readerWxss).toContain(".theme-choice:active");
    expect(readerWxss).toContain(".theme-choice:focus");
    expect(readerWxss).toContain(".theme-choice[disabled]");
  });

  it("does not expose internal adapter, stage, viewport, keyboard or service diagnostics in normal reader copy", () => {
    const visibleReaderCopy = readerWxml
      .replace(/<[^>]*>/g, " ")
      .replace(/\{\{[\s\S]*?\}\}/g, " ");
    expect(visibleReaderCopy).not.toMatch(/开发适配器|\bF[2345]\b|\bH3\b|viewport|safe[- ]area|keyboard|本地开发|模拟|测试|服务端|模型接入/iu);
  });

  it("renders an interruptible sheet gesture surface and reduced-motion contract", () => {
    expect(readerWxml).toContain("reader-sheet--{{sheetState}} reader-sheet--origin-{{sheetOrigin}}");
    expect(readerWxml).toContain('bindtouchstart="onSheetTouchStart"');
    expect(readerWxml).toContain('bindtouchmove="onSheetTouchMove"');
    expect(readerWxml).toContain('bindtouchend="onSheetTouchEnd"');
    expect(readerWxml).toContain('scroll-top="{{contentScrollTops[contentTab]}}"');
    expect(readerWxml).toContain('value="{{contentDrafts.notes}}"');
    expect(readerWxss).toContain(".reader-sheet--initial");
    expect(readerWxss).toContain(".reader-sheet--dragging");
    expect(readerWxss).toContain(".reader-sheet--fullscreen");
    expect(readerWxss).toContain(".reader-sheet--collapsed");
    expect(readerWxss).toContain(".reader-sheet--dragging.reader-sheet--origin-fullscreen");
    expect(readerWxss).toContain("prefers-reduced-motion: reduce");
    expect(readerWxss).toContain("140ms");
  });

  it("lets fullscreen content sheet own the toolbar area while initial keeps nav available", () => {
    const ruleFor = (selector: string) => {
      const rules = [...readerWxss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      return rules.find(([, head]) => head.split(",").some((item) => item.trim() === selector))?.[2] ?? "";
    };
    const valueFor = (body: string, property: string) =>
      body.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`))?.[1]?.trim() ?? "";
    const toolbarHeight = readerWxss.match(/--reader-bottom-nav-height:\s*([^;]+);/)?.[1]?.trim() ?? "";
    const toolbarBottom = "var(--reader-bottom-nav-height)";

    expect(toolbarHeight).toBe("calc(88px + var(--safe-bottom, env(safe-area-inset-bottom)))");
    expect(valueFor(ruleFor(".reader-controls__bottom"), "height")).toBe(toolbarBottom);
    expect(valueFor(ruleFor(".reader-sheet--initial"), "bottom")).toBe(toolbarBottom);
    expect(valueFor(ruleFor(".reader-sheet--collapsed"), "bottom")).toBe(toolbarBottom);
    expect(valueFor(ruleFor(".reader-sheet--fullscreen"), "bottom")).toBe("0");
    expect(valueFor(ruleFor(".reader-sheet--dragging.reader-sheet--origin-fullscreen"), "bottom")).toBe("0");
    expect(valueFor(ruleFor(".sheet-layer--initial .sheet-mask"), "bottom")).toBe(toolbarBottom);
    expect(valueFor(ruleFor(".sheet-layer--fullscreen .sheet-mask"), "bottom")).toBe("0");
    expect(valueFor(ruleFor(".sheet-layer--dragging .sheet-mask"), "bottom")).toBe(toolbarBottom);
    expect(valueFor(ruleFor(".sheet-layer--dragging.sheet-layer--origin-fullscreen .sheet-mask"), "bottom")).toBe("0");
    expect(valueFor(ruleFor(".sheet-layer--initial"), "pointer-events")).toBe("none");
    expect(valueFor(ruleFor(".sheet-layer--fullscreen"), "pointer-events")).toBe("auto");
    expect(valueFor(ruleFor(".sheet-layer--dragging"), "pointer-events")).toBe("auto");
    expect(valueFor(ruleFor(".sheet-layer--dragging.sheet-layer--origin-initial"), "pointer-events")).toBe("none");
    expect(valueFor(ruleFor(".sheet-layer--dragging.sheet-layer--origin-fullscreen"), "pointer-events")).toBe("auto");
  });

  it("exposes the explicit content sheet hierarchy and row-local note error slot", () => {
    expect(readerWxml).toContain('class="reader-sheet reader-sheet--{{sheetState}} reader-sheet--origin-{{sheetOrigin}} reader-sheet--theme-{{theme}}"');
    expect(readerWxml).toContain('class="sheet-header"');
    expect(readerWxml).toContain('class="sheet-title">书籍内容</view>');
    expect(readerWxml).toContain('class="sheet-sort-label"');
    expect(readerWxml).toContain('class="content-tabs content-tabs--segmented" role="tablist"');
    expect(readerWxml).toContain('role="tab" aria-selected="{{contentTab === \'notes\'}}"');
    expect(readerWxml).toContain('class="content-viewport"');
    expect(readerWxml).toContain('scroll-into-view="{{contentScrollIntoView}}"');
    expect(readerWxml).toContain('class="content-notes-toolbar"');
    expect(readerWxml).toContain('bindtap="openNoteComposer"');
    expect(readerWxml).toContain('wx:if="{{noteEditorState !== \'closed\'}}" class="note-editor-layer note-editor-layer--{{noteEditorState}}"');
    expect(readerWxml).toContain('class="note-editor-surface"');
    expect(readerWxml).toContain('class="note-editor-input" data-tab="notes" value="{{contentDrafts.notes}}"');
    expect(readerWxml).toContain('bindtap="saveNote"');
    expect(readerWxml).toContain('role="alert">{{noteSaveError}}</view>');
    expect(readerWxml).toContain('bindtap="closeNoteComposer"');
    expect(readerWxml).toContain('class="note-list"');
    expect(readerWxml).toContain('class="note-row"');
    expect(readerWxml).toContain('wx:if="{{item.quote}}"');
    expect(readerWxml).toContain('class="note-more"');
    expect(readerWxml).toContain('class="note-row-error" role="alert"');
    expect(readerWxml).toContain('id="note-error-{{item.id}}"');
    expect(readerWxml).toContain('bindtap="retryDeleteNote"');
    expect(readerWxml).not.toContain('noteDeleteError}}' + '</view><button');
    expect(readerWxml).toContain('class="sheet-handle__bar"');
    expect(readerWxss).not.toContain('.sheet-handle::after');
    expect(readerWxml).not.toContain('class="content-draft__input" value="{{contentDrafts.notes}}" bindinput="onContentDraftInput"');
    expect(readerWxss).toContain(".content-tabs--segmented");
    expect(readerWxss).toContain(".content-notes-toolbar");
    expect(readerWxss).toContain(".content-viewport");
    expect(readerWxss).toContain(".note-row");
    expect(readerWxss).toContain(".note-more");
    expect(readerWxss).toContain(".note-row-error");
    expect(readerWxss).toContain(".note-editor-surface");
    expect(readerWxss).toContain(".note-editor-input");
    expect(readerWxss).toContain(".note-editor-actions");
  });

  it("keeps a failed delete inline and retries the same note without losing its row", async () => {
    const page = createReaderPage();
    const detail = readerDetailWithBackground("light");
    const note = {
      id: "note-delete-failure",
      bookId: detail.book.id,
      body: "保留在列表里的笔记",
      source: null,
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
    page.data = {
      ...page.data,
      developmentAdapter: false,
      detail: { ...detail, notes: [{ id: note.id, body: note.body, meta: "读书笔记" }] },
      noteHydrationState: "ready",
    };
    page.noteRecords = new Map([[note.id, note]]);
    page.readerLoadRequestId = 1;

    let resolveDelete!: (result: { status: "failed" | "deleted"; id: string }) => void;
    annotationsClient.deleteNote.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    page.openNoteActions({ currentTarget: { dataset: { noteId: note.id } } });
    const pendingDelete = page.deleteNote({ currentTarget: { dataset: { noteId: note.id } } });
    expect(page.data.noteDeletingId).toBe(note.id);
    expect(page.data.detail.notes).toEqual([{ id: note.id, body: note.body, meta: "读书笔记" }]);

    resolveDelete({ status: "failed", id: note.id });
    await pendingDelete;
    expect(page.data).toMatchObject({
      noteDeletingId: "",
      noteActionId: note.id,
    });
    expect(page.data.noteDeleteError).toContain("删除暂时失败");
    expect(page.data.contentScrollIntoView).toBe("note-error-note-delete-failure");
    expect(page.data.detail.notes).toEqual([{ id: note.id, body: note.body, meta: "读书笔记" }]);

    annotationsClient.deleteNote.mockResolvedValueOnce({ status: "deleted", id: note.id });
    await page.retryDeleteNote();
    expect(page.data.noteDeleteError).toBe("");
    expect(page.data.noteActionId).toBe("");
    expect(page.data.detail.notes).toEqual([]);
  });

  it("hydrates development notes through the annotations client port", async () => {
    const page = createReaderPage();
    const detail = readerDetailWithBackground("light");
    const notes = [
      {
        id: "dev-note-1",
        bookId: detail.book.id,
        body: "第一条开发笔记",
        source: null,
        version: 1,
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-01T00:00:00.000Z",
      },
      {
        id: "dev-note-2",
        bookId: detail.book.id,
        body: "第二条开发笔记",
        source: null,
        version: 1,
        createdAt: "2030-01-01T00:01:00.000Z",
        updatedAt: "2030-01-01T00:01:00.000Z",
      },
    ];
    page.data = {
      ...page.data,
      developmentAdapter: true,
      detail: { ...detail, notes: [] },
      noteHydrationState: "idle",
    };
    page.readerLoadRequestId = 1;
    annotationsClient.getAnnotations.mockResolvedValueOnce({ fileVersion: 1, highlights: [], notes });

    await page.hydrateNotes(detail, 1);

    expect(annotationsClient.getAnnotations).toHaveBeenCalledWith(detail.book.id);
    expect(page.data.noteHydrationState).toBe("ready");
    expect(page.data.detail.notes).toEqual([
      { id: "dev-note-1", body: "第一条开发笔记", meta: "读书笔记" },
      { id: "dev-note-2", body: "第二条开发笔记", meta: "读书笔记" },
    ]);
  });

  it("reveals an unavailable delete failure at the same note row", async () => {
    const page = createReaderPage();
    const detail = readerDetailWithBackground("light");
    const noteId = "note-unavailable-delete";
    page.data = {
      ...page.data,
      developmentAdapter: true,
      detail: { ...detail, notes: [{ id: noteId, body: "仍保留的笔记", meta: "读书笔记" }] },
      noteHydrationState: "ready",
    };
    page.noteRecords = new Map();

    page.openNoteActions({ currentTarget: { dataset: { noteId } } });
    await page.deleteNote({ currentTarget: { dataset: { noteId } } });

    expect(page.data).toMatchObject({
      noteActionId: noteId,
      noteDeleteError: "笔记删除暂不可用，内容已保留；请稍后重试。",
      contentScrollIntoView: `note-error-${noteId}`,
    });
    expect(page.data.detail.notes).toEqual([{ id: noteId, body: "仍保留的笔记", meta: "读书笔记" }]);
  });

  it("keeps the note draft through API save failure, retry, close and reopen", async () => {
    const page = createReaderPage();
    readerClient.savePosition.mockClear();
    page.data = {
      ...page.data,
      developmentAdapter: false,
      detail: readerDetailWithBackground("light"),
      noteHydrationState: "ready",
    };
    annotationsClient.createNote.mockResolvedValue({
      status: "failed",
      errorCode: "NOTE_SAVE_FAILED",
      retainedDraft: { body: "保留这段草稿" },
    });

    page.openNoteComposer();
    expect(page.data.noteEditorState).toBe("editing");
    page.onContentDraftInput({ detail: { value: "保留这段草稿" }, currentTarget: { dataset: { tab: "notes" } } });
    await page.saveNote();

    expect(page.data).toMatchObject({
      noteEditorState: "failed",
      contentDrafts: { notes: "保留这段草稿" },
    });
    expect(page.data.noteSaveError).toContain("保存暂时失败");
    expect(page.data.noteSaveError).not.toContain("接口尚未接入");
    expect(annotationsClient.createNote).toHaveBeenCalledWith(
      "reader-page-test-book",
      expect.objectContaining({ body: "保留这段草稿", idempotencyKey: expect.any(String) }),
    );
    const firstIdempotencyKey = annotationsClient.createNote.mock.calls[0]?.[1].idempotencyKey;
    expect(readerClient.savePosition).not.toHaveBeenCalled();

    await page.saveNote();
    expect(page.data.noteEditorState).toBe("failed");
    expect(page.data.contentDrafts.notes).toBe("保留这段草稿");
    expect(annotationsClient.createNote.mock.calls[1]?.[1].idempotencyKey).toBe(firstIdempotencyKey);

    page.closeNoteComposer();
    expect(page.data).toMatchObject({ noteEditorState: "closed", contentDrafts: { notes: "保留这段草稿" } });
    page.openNoteComposer();
    expect(page.data).toMatchObject({ noteEditorState: "editing", contentDrafts: { notes: "保留这段草稿" } });
  });

  it("hydrates notes and sends expected versions for update and delete", async () => {
    const page = createReaderPage();
    const detail = readerDetailWithBackground("light");
    const note = {
      id: "note-1",
      bookId: detail.book.id,
      body: "原始笔记",
      source: null,
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
    page.data = { ...page.data, developmentAdapter: false, detail, noteHydrationState: "loading" };
    page.readerLoadRequestId = 1;
    annotationsClient.getAnnotations.mockResolvedValueOnce({ fileVersion: 1, highlights: [], notes: [note] });

    await page.hydrateNotes(detail, 1);

    expect(page.data.noteHydrationState).toBe("ready");
    expect(page.data.detail.notes).toEqual([{ id: "note-1", body: "原始笔记", meta: "读书笔记" }]);

    annotationsClient.updateNote.mockResolvedValueOnce({ status: "saved", note: { ...note, body: "改过的笔记", version: 2 } });
    page.openNoteEditor({ currentTarget: { dataset: { noteId: note.id } } });
    page.onContentDraftInput({ detail: { value: "改过的笔记" }, currentTarget: { dataset: { tab: "notes" } } });
    await page.saveNote();

    expect(annotationsClient.updateNote).toHaveBeenCalledWith(detail.book.id, note.id, {
      expectedVersion: 1,
      body: "改过的笔记",
      source: null,
    });
    expect(page.data.detail.notes[0]).toMatchObject({ id: note.id, body: "改过的笔记" });

    annotationsClient.deleteNote.mockResolvedValueOnce({ status: "deleted", id: note.id });
    page.openNoteActions({ currentTarget: { dataset: { noteId: note.id } } });
    await page.deleteNote({ currentTarget: { dataset: { noteId: note.id } } });

    expect(annotationsClient.deleteNote).toHaveBeenCalledWith(detail.book.id, note.id, { expectedVersion: 2 });
    expect(page.data.detail.notes).toEqual([]);
  });

  it("refreshes the note version after a conflict while retaining the draft for retry", async () => {
    const page = createReaderPage();
    const detail = readerDetailWithBackground("light");
    const note = {
      id: "note-conflict",
      bookId: detail.book.id,
      body: "并发前的笔记",
      source: null,
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
    const latestNote = { ...note, body: "另一页已更新", version: 2 };
    page.data = { ...page.data, developmentAdapter: false, detail, noteHydrationState: "ready" };
    page.readerLoadRequestId = 2;
    page.noteRecords = new Map([[note.id, note]]);
    annotationsClient.updateNote.mockRejectedValueOnce(new AnnotationsApiError(409, "STALE_VERSION", false));
    annotationsClient.getAnnotations.mockResolvedValueOnce({ fileVersion: 1, highlights: [], notes: [latestNote] });

    page.openNoteEditor({ currentTarget: { dataset: { noteId: note.id } } });
    page.onContentDraftInput({ detail: { value: "我的并发修改" }, currentTarget: { dataset: { tab: "notes" } } });
    await page.saveNote();

    expect(page.data.noteEditorState).toBe("failed");
    expect(page.data.contentDrafts.notes).toBe("我的并发修改");
    expect(page.data.noteSaveError).toContain("版本已更新");
    expect(page.noteRecords.get(note.id).version).toBe(2);

    annotationsClient.updateNote.mockResolvedValueOnce({ status: "saved", note: { ...latestNote, body: "我的并发修改", version: 3 } });
    await page.saveNote();

    expect(annotationsClient.updateNote).toHaveBeenLastCalledWith(detail.book.id, note.id, {
      expectedVersion: 2,
      body: "我的并发修改",
      source: null,
    });
    expect(page.data.noteEditorState).toBe("closed");
  });
});
