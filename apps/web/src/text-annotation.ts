import type {
  CreateTextHighlightRequest,
  CreateTextNoteRequest,
  DeleteTextAnnotationRequest,
  DeletedTextAnnotationResponse,
  SavedTextHighlightResponse,
  SavedTextNoteResponse,
  TextAnnotationList,
  TextAnnotationSource,
  TextHighlight,
  TextLocator,
  TextNote,
  UpdateTextHighlightRequest,
  UpdateTextNoteRequest,
} from "@selfalone/contracts";
import "./text-annotation.css";
import "./book-detail.css";
import { bookDetailPptIntentHref, createBookDetailModel } from "./book-detail-state";
import { renderBookDetail } from "./book-detail-view";
import {
  createTextAnnotationSourceFromOffsets,
  createTextAnnotationModel,
  sameTextAnnotationSource,
  type AnnotationRectangle,
  type TextAnnotationApi,
  type TextAnnotationSelection,
} from "./text-annotation-state";
import { renderTextAnnotationLayer } from "./text-annotation-view";
import type { TextReaderChatHandoff } from "./text-reader-chat-handoff";

export type TextAnnotationRequestError = Error & {
  code: string;
  retainedDraft?: unknown;
};

export type TextAnnotationChatHandoff = (handoff: TextReaderChatHandoff) => void;

export type TextAnnotationChatHandoffContext = {
  bookId: string;
  bookTitle: string;
  author: string | null;
  sections: readonly TextAnnotationReaderSection[];
};

export type TextAnnotationReaderSection = {
  sectionId: string;
  fileVersion: number;
  title: string;
  order: number;
  text: string;
};

export function requestTextAnnotationChatHandoff(
  handoff: TextAnnotationChatHandoff | undefined,
  selection: TextAnnotationSelection | null,
  context?: TextAnnotationChatHandoffContext,
) {
  if (!handoff || !selection || !context) return false;
  const source = selection.source;
  const section = context.sections.find((candidate) => (
    candidate.sectionId === source.locator.sectionId
    && candidate.fileVersion === source.locator.fileVersion
  ));
  if (!section) return false;
  handoff({
    quote: source.quote,
    bookId: context.bookId,
    bookTitle: context.bookTitle,
    author: context.author?.trim() || null,
    location: {
      sectionId: source.locator.sectionId,
      fileVersion: source.locator.fileVersion,
      start: source.locator.offset,
      end: source.endOffset,
      sectionTitle: section.title,
      sectionOrder: section.order,
    },
  });
  return true;
}

export function clearTextAnnotationSelection(
  nativeSelection: Pick<Selection, "removeAllRanges"> | null,
  clearModelSelection: () => void,
) {
  nativeSelection?.removeAllRanges();
  clearModelSelection();
}

export function detailFocusIndex(input: {
  focusableCount: number;
  activeIndex: number;
  shiftKey: boolean;
}) {
  if (input.focusableCount <= 0) return null;
  if (input.activeIndex < 0) return input.shiftKey ? input.focusableCount - 1 : 0;
  if (input.shiftKey && input.activeIndex <= 0) return input.focusableCount - 1;
  if (!input.shiftKey && input.activeIndex >= input.focusableCount - 1) return 0;
  return null;
}

const detailFocusableSelector = "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]";

export function detailFocusableElements(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(detailFocusableSelector)].filter((element) => {
    if (element.tabIndex < 0) return false;
    if (element.closest("[hidden], [inert], [aria-hidden=\"true\"]")) return false;
    if (typeof window !== "undefined") {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return element.getClientRects().length > 0;
  });
}

export function createTextAnnotationKeyboardBinding(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  onEscape: (event: KeyboardEvent) => void,
) {
  const onKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Escape" || keyboardEvent.key === "Tab") onEscape(keyboardEvent);
  };
  return {
    attach() {
      target.addEventListener("keydown", onKeyDown);
    },
    detach() {
      target.removeEventListener("keydown", onKeyDown);
    },
  };
}

function requestError(code: string, retainedDraft?: unknown) {
  const error = new Error(code) as TextAnnotationRequestError;
  error.code = code;
  error.retainedDraft = retainedDraft;
  return error;
}

async function requestJson<T>(
  fetcher: (url: string, options?: RequestInit) => Promise<Response>,
  url: string,
  options: RequestInit | undefined,
): Promise<T> {
  const response = await fetcher(url, options);
  let payload: (T & { code?: string; errorCode?: string; retainedDraft?: unknown }) | null = null;
  try {
    payload = await response.json() as T & { code?: string; errorCode?: string; retainedDraft?: unknown };
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw requestError(payload?.errorCode ?? payload?.code ?? "REQUEST_FAILED", payload?.retainedDraft);
  }
  return payload as T;
}

function accountHeaders(accountId: string, includeJson = false) {
  return {
    ...(includeJson ? { "content-type": "application/json" } : {}),
    ...(accountId.trim() ? { "x-selfalone-account": accountId.trim() } : {}),
  };
}

export function createTextAnnotationApi(
  bookId: string,
  fetcher: (url: string, options?: RequestInit) => Promise<Response> = (url, options) => fetch(url, options),
  accountId = "",
): TextAnnotationApi {
  const root = `/api/v1/books/${encodeURIComponent(bookId)}`;
  const json = <T>(url: string, options?: RequestInit) => requestJson<T>(fetcher, url, options);
  return {
    list: () => json<TextAnnotationList>(`${root}/annotations`, { headers: accountHeaders(accountId) }),
    createHighlight: (input: CreateTextHighlightRequest) => json<SavedTextHighlightResponse>(`${root}/highlights`, {
      method: "POST",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
    updateHighlight: (highlightId: string, input: UpdateTextHighlightRequest) => json<SavedTextHighlightResponse>(`${root}/highlights/${encodeURIComponent(highlightId)}`, {
      method: "PATCH",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
    deleteHighlight: (highlightId: string, input: DeleteTextAnnotationRequest) => json<DeletedTextAnnotationResponse>(`${root}/highlights/${encodeURIComponent(highlightId)}`, {
      method: "DELETE",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
    createNote: (input: CreateTextNoteRequest) => json<SavedTextNoteResponse>(`${root}/notes`, {
      method: "POST",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
    updateNote: (noteId: string, input: UpdateTextNoteRequest) => json<SavedTextNoteResponse>(`${root}/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
    deleteNote: (noteId: string, input: DeleteTextAnnotationRequest) => json<DeletedTextAnnotationResponse>(`${root}/notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      headers: accountHeaders(accountId, true),
      body: JSON.stringify(input),
    }),
  };
}

function parentElement(node: Node | null) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
  return node.parentElement;
}

function readerParagraph(node: Node | null, root: HTMLElement) {
  let current = parentElement(node);
  while (current && current !== root) {
    if (current.matches?.("[data-reader-paragraph]")) return current;
    current = current.parentElement;
  }
  return null;
}

function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1;
  return [...node.childNodes].reduce((total, child) => total + textLength(child), 0);
}

function offsetAtBoundary(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null;
  const measure = (node: Node): number | null => {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) return Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
      return [...node.childNodes].slice(0, Math.max(0, offset)).reduce((total, child) => total + textLength(child), 0);
    }
    let total = 0;
    for (const child of [...node.childNodes]) {
      if (child === container || child.contains(container)) {
        const nested = measure(child);
        return nested === null ? null : total + nested;
      }
      total += textLength(child);
    }
    return null;
  };
  return measure(root);
}

function rectangleFromRange(range: Range): AnnotationRectangle {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

function rectangleFromDomRect(rect: DOMRect): AnnotationRectangle {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

export function selectionToTextAnnotation(
  input: {
    root: HTMLElement;
    sections: Array<{ sectionId: string; fileVersion: number; text: string }>;
    selection: Selection | null;
  },
): TextAnnotationSelection | null {
  const selection = input.selection;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  const startParagraph = readerParagraph(range.startContainer, input.root);
  const endParagraph = readerParagraph(range.endContainer, input.root);
  if (!startParagraph || !endParagraph) return null;
  const sectionId = startParagraph.dataset.sectionId;
  if (!sectionId || sectionId !== endParagraph.dataset.sectionId) return null;
  const section = input.sections.find((candidate) => candidate.sectionId === sectionId);
  if (!section) return null;
  const startLocal = offsetAtBoundary(startParagraph, range.startContainer, range.startOffset);
  const endLocal = offsetAtBoundary(endParagraph, range.endContainer, range.endOffset);
  const startBase = Number(startParagraph.dataset.offset);
  const endBase = Number(endParagraph.dataset.offset);
  if (!Number.isSafeInteger(startBase) || !Number.isSafeInteger(endBase) || startLocal === null || endLocal === null) return null;
  try {
    const sectionHeader = startParagraph.closest<HTMLElement>("section.text-reader-section")?.querySelector<HTMLElement>("header");
    const headerRect = sectionHeader?.getBoundingClientRect();
    return {
      source: createTextAnnotationSourceFromOffsets({
        section,
        startOffset: startBase + startLocal,
        endOffset: endBase + endLocal,
      }),
      rect: rectangleFromRange(range),
      avoidRects: headerRect && headerRect.width > 0 && headerRect.height > 0
        ? [rectangleFromDomRect(headerRect)]
        : [],
    };
  } catch {
    return null;
  }
}

export type { TextAnnotationList, TextAnnotationSource, TextHighlight, TextLocator, TextNote };
export type { TextAnnotationApi } from "./text-annotation-state";

export type TextAnnotationReaderContext = {
  root: HTMLElement;
  sections: Array<TextAnnotationReaderSection>;
  reading: { fileVersion: number; title: string; author: string | null } | null;
};

export function createTextAnnotationController(options: {
  bookId: string;
  api: TextAnnotationApi;
  getReaderContext: () => TextAnnotationReaderContext;
  onRender: () => void;
  onChatHandoff?: TextAnnotationChatHandoff;
  onDetailClose?: () => void;
}) {
  const model = createTextAnnotationModel(options.bookId, options.api);
  const details = createBookDetailModel(options.bookId, options.api);
  let selectionListenerAttached = false;
  let keyboardListenerAttached = false;
  let selectionActionPending = false;
  let selectionSaveInFlight = false;
  let currentRoot: HTMLElement | null = null;

  const queueFocus = (selector: string) => {
    const focus = () => currentRoot?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else window.setTimeout(focus, 0);
  };

  const trapDetailFocus = (event: KeyboardEvent) => {
    if (!currentRoot) return;
    const panel = currentRoot.querySelector<HTMLElement>("[data-book-detail-panel]");
    if (!panel) return;
    const focusable = detailFocusableElements(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (!panel.contains(active)) {
      event.preventDefault();
      const nextIndex = detailFocusIndex({
        focusableCount: focusable.length,
        activeIndex: -1,
        shiftKey: event.shiftKey,
      });
      focusable[nextIndex ?? 0]?.focus({ preventScroll: true });
      return;
    }
    const index = active ? focusable.indexOf(active) : -1;
    const nextIndex = detailFocusIndex({
      focusableCount: focusable.length,
      activeIndex: index,
      shiftKey: event.shiftKey,
    });
    if (nextIndex !== null) {
      event.preventDefault();
      focusable[nextIndex]?.focus({ preventScroll: true });
    }
  };

  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      if (details.snapshot.open) trapDetailFocus(event);
      return;
    }
    if (details.snapshot.open) {
      event.preventDefault();
      closeDetails();
    } else if (model.snapshot.composer) {
      event.preventDefault();
      model.snapshot = { ...model.snapshot, composer: null };
      rerender();
    } else if (model.snapshot.selection) {
      event.preventDefault();
      clearTextAnnotationSelection(window.getSelection(), () => model.setSelection(null));
      rerender();
    }
  };
  const keyboardBinding = createTextAnnotationKeyboardBinding(document, onEscape);

  const render = (root: HTMLElement) => {
    currentRoot = root;
    const layer = root.querySelector<HTMLElement>("[data-text-annotation-root]");
    if (layer) layer.innerHTML = renderTextAnnotationLayer(model.snapshot, {
      chatHandoffAvailable: Boolean(options.onChatHandoff && options.getReaderContext().reading),
    });
    const detailHost = root.querySelector<HTMLElement>("[data-book-detail-host]");
    if (detailHost) {
      detailHost.hidden = !details.snapshot.open;
      detailHost.setAttribute("aria-hidden", String(!details.snapshot.open));
      detailHost.innerHTML = details.snapshot.open ? renderBookDetail(details.snapshot) : "";
    }
    const main = root.querySelector<HTMLElement>(".text-reader-main");
    if (main) {
      main.setAttribute("tabindex", details.snapshot.open ? "-1" : "0");
      [...main.children].forEach((child) => {
        if (child !== detailHost) {
          if (details.snapshot.open) child.setAttribute("inert", "");
          else child.removeAttribute("inert");
        }
      });
    }
    const rail = root.querySelector<HTMLElement>(".text-reader-rail");
    if (rail) {
      if (details.snapshot.open) rail.setAttribute("inert", "");
      else rail.removeAttribute("inert");
    }
  };

  const rerender = (focusSelector?: string) => {
    if (!currentRoot) return;
    options.onRender();
    if (details.snapshot.open) queueFocus(focusSelector ?? "[data-book-detail-close]");
    else if (focusSelector) queueFocus(focusSelector);
  };

  const applySelection = () => {
    const context = options.getReaderContext();
    const next = selectionToTextAnnotation({
      root: context.root,
      sections: context.sections,
      selection: window.getSelection(),
    });
    const previous = model.snapshot.selection;
    if (next && previous && sameTextAnnotationSource(previous.source, next.source)) return;
    // Moving focus to the floating action surface clears the browser's native
    // range in some engines. Keep the precise model selection until the action
    // has been handled, so writing a thought or retrying a failed save cannot
    // lose the source text.
    if (!next && previous && (selectionActionPending || model.snapshot.composer || model.snapshot.pending)) return;
    if (!next && !previous) return;
    model.setSelection(next);
    rerender();
  };

  const detailReload = async () => {
    try {
      await details.load();
    } catch {
      // The detail model keeps an actionable failure state.
    }
    rerender();
  };

  const updateDetailBook = () => {
    const reading = options.getReaderContext().reading;
    if (!reading) return;
    details.snapshot = {
      ...details.snapshot,
      title: reading.title,
      author: reading.author?.trim() || "作者未知",
      pptHref: bookDetailPptIntentHref(options.bookId, reading.title),
    };
  };

  const openDetails = async () => {
    updateDetailBook();
    clearTextAnnotationSelection(window.getSelection(), () => model.setSelection(null));
    details.setOpen(true);
    rerender();
    await detailReload();
  };

  const closeDetails = () => {
    details.setOpen(false);
    rerender("[data-reader-book-detail]");
    options.onDetailClose?.();
  };

  const requestChatHandoff = () => {
    const context = options.getReaderContext();
    const reading = context.reading;
    if (!reading) return false;
    return requestTextAnnotationChatHandoff(options.onChatHandoff, model.snapshot.selection, {
      bookId: options.bookId,
      bookTitle: reading.title,
      author: reading.author,
      sections: context.sections,
    });
  };

  const refreshBoth = async () => {
    try {
      await model.load();
    } catch {
      // The reader remains usable when the annotation side channel is down.
    }
    try {
      await details.load();
    } catch {
      // The detail panel displays its own retained failure state.
    }
    rerender();
  };

  const bind = (root: HTMLElement) => {
    currentRoot = root;
    if (!selectionListenerAttached) {
      document.addEventListener("selectionchange", applySelection);
      selectionListenerAttached = true;
    }
    if (!keyboardListenerAttached) {
      keyboardBinding.attach();
      keyboardListenerAttached = true;
    }
    root.querySelectorAll<HTMLElement>('[data-annotation-selection-menu] button, [data-annotation-thought]')
      .forEach((button) => button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectionActionPending = true;
        window.setTimeout(() => {
          selectionActionPending = false;
        }, 0);
      }));
    const persistSelection = (save: () => Promise<unknown>) => {
      if (selectionSaveInFlight) return;
      selectionSaveInFlight = true;
      void save()
        .then(() => {
          clearTextAnnotationSelection(window.getSelection(), () => model.setSelection(null));
          rerender();
        })
        .catch(() => {
          rerender("[data-annotation-retry]");
        })
        .finally(() => {
          selectionSaveInFlight = false;
        });
    };
    root.querySelector<HTMLButtonElement>('[data-annotation-highlight]')?.addEventListener("click", () => {
      persistSelection(() => model.saveSelection());
    });
    root.querySelector<HTMLButtonElement>('[data-annotation-thought]')?.addEventListener("click", () => {
      model.beginThought();
      rerender();
      requestAnimationFrame(() => root.querySelector<HTMLTextAreaElement>("[data-annotation-thought-input]")?.focus());
    });
    root.querySelector<HTMLButtonElement>('[data-annotation-chat]')?.addEventListener("click", () => {
      requestChatHandoff();
    });
    root.querySelector<HTMLButtonElement>('[data-annotation-thought-cancel]')?.addEventListener("click", () => {
      model.snapshot = { ...model.snapshot, composer: null, saveError: "" };
      rerender();
    });
    root.querySelector<HTMLFormElement>('[data-annotation-thought-form]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = root.querySelector<HTMLTextAreaElement>("[data-annotation-thought-input]")?.value ?? "";
      model.setComposerBody(body);
      persistSelection(() => model.saveSelection());
    });
    root.querySelectorAll<HTMLButtonElement>('[data-annotation-retry]').forEach((button) => {
      button.addEventListener("click", () => {
        persistSelection(() => model.retrySave());
      });
    });
    root.querySelector<HTMLButtonElement>('[data-annotation-reload]')?.addEventListener("click", () => {
      void refreshBoth();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-reader-book-detail]').forEach((button) => {
      button.addEventListener("click", () => {
        void openDetails();
      });
    });
    root.querySelector<HTMLButtonElement>('[data-book-detail-close]')?.addEventListener("click", () => {
      closeDetails();
    });
    root.querySelector<HTMLButtonElement>('[data-book-detail-new-note]')?.addEventListener("click", () => {
      details.beginCreate(null);
      rerender("#book-detail-note-body");
    });
    root.querySelectorAll<HTMLButtonElement>('[data-book-detail-cancel]').forEach((button) => {
      button.addEventListener("click", () => {
        details.cancelDraft();
        rerender();
      });
    });
    root.querySelector<HTMLFormElement>('[data-book-detail-form]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      details.setDraftBody(root.querySelector<HTMLTextAreaElement>("#book-detail-note-body")?.value ?? "");
      void details.saveDraft().then(refreshBoth).catch(() => rerender("[data-book-detail-retry]"));
    });
    root.querySelector<HTMLButtonElement>('[data-book-detail-retry]')?.addEventListener("click", () => {
      void details.retrySave().then(refreshBoth).catch(() => rerender("[data-book-detail-retry]"));
    });
    root.querySelector<HTMLButtonElement>('[data-book-detail-reload]')?.addEventListener("click", () => {
      void detailReload();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-book-detail-edit-note]').forEach((button) => {
      button.addEventListener("click", () => {
        const note = details.snapshot.notes.find((item) => item.id === button.dataset.bookDetailEditNote);
        if (!note) return;
        details.beginEdit(note);
        rerender("#book-detail-note-body");
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-book-detail-delete-note]').forEach((button) => {
      button.addEventListener("click", () => {
        const note = details.snapshot.notes.find((item) => item.id === button.dataset.bookDetailDeleteNote);
        if (!note) return;
        void details.deleteNote(note).then(refreshBoth).catch(rerender);
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-book-detail-delete-highlight]').forEach((button) => {
      button.addEventListener("click", () => {
        const highlight = details.snapshot.highlights.find((item) => item.id === button.dataset.bookDetailDeleteHighlight);
        if (!highlight) return;
        void details.deleteHighlight(highlight).then(refreshBoth).catch(() => rerender());
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-book-detail-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.bookDetailTab;
        if (tab !== "highlights" && tab !== "notes" && tab !== "ppt") return;
        details.setActiveTab(tab);
        rerender(`[data-book-detail-tab="${tab}"]`);
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-book-detail-tab]")];
        const currentIndex = tabs.indexOf(button);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        const next = tabs[nextIndex];
        const tab = next?.dataset.bookDetailTab;
        if (next && (tab === "highlights" || tab === "notes" || tab === "ppt")) {
          details.setActiveTab(tab);
          rerender(`[data-book-detail-tab="${tab}"]`);
        }
      });
    });
  };

  return {
    model,
    details,
    render,
    bind,
    load: refreshBoth,
    destroy() {
      if (selectionListenerAttached) {
        document.removeEventListener("selectionchange", applySelection);
        selectionListenerAttached = false;
      }
      if (keyboardListenerAttached) {
        keyboardBinding.detach();
        keyboardListenerAttached = false;
      }
      currentRoot = null;
    },
    openDetails,
    closeDetails,
    requestChatHandoff,
  };
}

export type TextAnnotationController = ReturnType<typeof createTextAnnotationController>;
