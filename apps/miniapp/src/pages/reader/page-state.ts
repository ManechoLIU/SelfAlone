import type { DevelopmentState, ReadingBackground } from "../../adapters/client";

export type ReaderIntroDensity = "short" | "regular" | "tall";
export type ReaderSwipeHintState = "visible" | "dismissing" | "hidden";
export type ReaderSwipeHint = { bookId: string; state: ReaderSwipeHintState };
export type ReaderFailureContext = {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  sourceLabel: string;
  theme: ReadingBackground;
  currentIndex: number;
  progressLabel: string;
  hasLoadedContent: boolean;
};

export type ReaderSheetState = "closed" | "initial" | "dragging" | "fullscreen" | "collapsed";
export type ReaderContentTab = "highlights" | "notes" | "ppt";
export type ReaderContentContext = {
  activeTab: ReaderContentTab;
  scrollTop: Record<ReaderContentTab, number>;
  drafts: Record<ReaderContentTab, string>;
};

const READER_CONTENT_TABS: ReaderContentTab[] = ["highlights", "notes", "ppt"];
const READER_SHEET_DRAG_EPSILON = 24;

function isReaderContentTab(value: unknown): value is ReaderContentTab {
  return typeof value === "string" && READER_CONTENT_TABS.includes(value as ReaderContentTab);
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function readerSheetDragStart(state: ReaderSheetState): ReaderSheetState {
  return state === "closed" ? "closed" : "dragging";
}

export function readerSheetAfterDrag(
  origin: Exclude<ReaderSheetState, "closed" | "dragging">,
  deltaY: number,
  threshold = READER_SHEET_DRAG_EPSILON,
): ReaderSheetState {
  const delta = Number.isFinite(deltaY) ? deltaY : 0;
  const distance = Math.max(READER_SHEET_DRAG_EPSILON, nonNegativeNumber(threshold));
  if (Math.abs(delta) < distance) return origin;
  if (delta < 0) return origin === "initial" || origin === "collapsed" ? "fullscreen" : origin;
  return origin === "fullscreen" ? "collapsed" : "closed";
}

export function readerSheetGestureOwner(
  state: ReaderSheetState,
  direction: "up" | "down",
  contentScrollTop: number,
): "sheet" | "content" {
  const atTop = nonNegativeNumber(contentScrollTop) <= 1;
  if (state === "closed") return "content";
  if (direction === "up") {
    return (state === "initial" || state === "collapsed") && atTop ? "sheet" : "content";
  }
  return state === "fullscreen" && !atTop ? "content" : "sheet";
}

export function createReaderContentContext(): ReaderContentContext {
  return {
    activeTab: "highlights",
    scrollTop: { highlights: 0, notes: 0, ppt: 0 },
    drafts: { highlights: "", notes: "", ppt: "" },
  };
}

export function rememberReaderContentContext(
  context: ReaderContentContext,
  update: {
    activeTab?: ReaderContentTab;
    scrollTop?: Partial<Record<ReaderContentTab, number>>;
    drafts?: Partial<Record<ReaderContentTab, string>>;
  },
): ReaderContentContext {
  const nextScrollTop = { ...context.scrollTop };
  const nextDrafts = { ...context.drafts };
  for (const tab of READER_CONTENT_TABS) {
    const scrollTop = update.scrollTop?.[tab];
    if (scrollTop !== undefined) nextScrollTop[tab] = nonNegativeNumber(scrollTop);
    const draft = update.drafts?.[tab];
    if (draft !== undefined) nextDrafts[tab] = typeof draft === "string" ? draft : "";
  }
  return {
    activeTab: isReaderContentTab(update.activeTab) ? update.activeTab : context.activeTab,
    scrollTop: nextScrollTop,
    drafts: nextDrafts,
  };
}

export function pptConversationUrl() {
  return "/pages/conversation/index?intent=ppt";
}
export type ReaderSwipeZone = "intro-top" | "intro-active" | "body";

const READER_SCROLL_ROUNDING_EPSILON = 1;
export const READER_SWIPE_HINT_DISMISS_MS = 180;
export const READER_SWIPE_HINT_REDUCED_DISMISS_MS = 140;

export function introDensityForHeight(height: number): ReaderIntroDensity {
  const viewportHeight = Number.isFinite(height) ? height : 0;
  if (viewportHeight <= 600) return "short";
  if (viewportHeight <= 760) return "regular";
  return "tall";
}

export function resetReaderSwipeHint(bookId: string): ReaderSwipeHint {
  return { bookId, state: "visible" };
}

export function readerSwipeHintNeedsReset(currentBookId: string | undefined, nextBookId: string, resetOnUnload: boolean): boolean {
  return resetOnUnload || currentBookId !== nextBookId;
}

export function advanceReaderSwipeHint(
  hint: ReaderSwipeHint,
  zone: ReaderSwipeZone,
): ReaderSwipeHint {
  if (zone === "intro-top") return hint.state === "visible" ? hint : { ...hint, state: "visible" };
  if (zone === "body" && hint.state === "visible") return { ...hint, state: "dismissing" };
  return hint;
}

export function readerSwipeZone(scrollTop: number, introHeight: number): ReaderSwipeZone {
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const bodyTop = Number.isFinite(introHeight) ? Math.max(0, introHeight) : 0;
  if (top <= READER_SCROLL_ROUNDING_EPSILON) return "intro-top";
  return top >= bodyTop ? "body" : "intro-active";
}

export function dismissReaderSwipeHint(hint: ReaderSwipeHint): ReaderSwipeHint {
  return hint.state === "dismissing" ? { ...hint, state: "hidden" } : hint;
}

export function normalizeReaderBackground(value: unknown): ReadingBackground {
  return value === "dark" ? "dark" : "light";
}

export function restoreReaderBackground(position: { background?: unknown } | null): ReadingBackground {
  return normalizeReaderBackground(position?.background);
}

export function backgroundSaveFailure(theme: ReadingBackground, message: string) {
  return {
    theme,
    saveError: `${message}，阅读背景未保存，当前选择仍保留`,
  };
}

export function preserveReaderFailureContext(context: ReaderFailureContext | null, error: string) {
  return {
    phase: "failed" as const,
    error,
    retrying: false,
    context,
  };
}

export function readerRetryState(
  phase: "loading" | "ready" | "empty" | "filtered-empty" | "failed",
  context: ReaderFailureContext | null,
) {
  return {
    phase: phase === "failed" ? "failed" as const : phase,
    error: "",
    retrying: true,
    context,
  };
}

export function restoreReaderRetryContext(
  context: ReaderFailureContext | null,
  bookId: string,
  blockCount: number,
  fallback: Pick<ReaderFailureContext, "currentIndex" | "theme" | "progressLabel">,
) {
  const canRestore = context?.bookId === bookId && blockCount > 0;
  const currentIndex = canRestore
    ? Math.min(Math.max(0, context.currentIndex), blockCount - 1)
    : Math.min(Math.max(0, fallback.currentIndex), Math.max(0, blockCount - 1));
  return {
    currentIndex,
    theme: canRestore ? context.theme : fallback.theme,
    progressLabel: canRestore ? context.progressLabel : fallback.progressLabel,
    scrollIntoView: canRestore ? `reader-block-${currentIndex}` : "",
  };
}

export function clearReaderFilter(state: DevelopmentState | undefined): DevelopmentState {
  return state === "filtered-empty" ? "normal" : state ?? "normal";
}
