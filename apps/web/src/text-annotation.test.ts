import { describe, expect, it, vi } from "vitest";
import type { TextHighlight } from "@selfalone/contracts";
import {
  clearTextAnnotationSelection,
  createTextAnnotationApi,
  createTextAnnotationController,
  createTextAnnotationKeyboardBinding,
  detailFocusIndex,
  detailFocusableElements,
  requestTextAnnotationChatHandoff,
  type TextAnnotationRequestError,
} from "./text-annotation";
import { renderTextAnnotationLayer } from "./text-annotation-view";
import type { TextAnnotationSnapshot, TextAnnotationSelection } from "./text-annotation-state";
import type { TextReaderChatHandoff } from "./text-reader-chat-handoff";

const selection: TextAnnotationSelection = {
  source: {
    locator: { kind: "text", fileVersion: 2, sectionId: "txt:0", offset: 4 },
    endOffset: 8,
    quote: "灯塔亮了",
  },
  rect: { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
};

const readerSections = [{
  sectionId: "txt:0",
  fileVersion: 2,
  title: "雨停以后",
  order: 0,
  text: "0123灯塔亮了",
}];

const highlight: TextHighlight = {
  id: "highlight-1",
  bookId: "book-1",
  locator: { kind: "text", fileVersion: 2, sectionId: "txt:0", offset: 4 },
  endOffset: 8,
  quote: "灯塔亮了",
  thought: null,
  version: 2,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const annotationSnapshot: TextAnnotationSnapshot = {
  loading: false,
  error: "",
  fileVersion: 2,
  highlights: [],
  notes: [],
  selection,
  composer: null,
  pending: null,
  saveError: "",
};

describe("desktop text annotation API", () => {
  it("keeps only visible, non-negative, non-inert detail controls in the focus trap", () => {
    const makeElement = (input: {
      tabIndex: number;
      hidden?: boolean;
      inert?: boolean;
      ariaHidden?: boolean;
      visible?: boolean;
    }) => {
      const element = {
        tabIndex: input.tabIndex,
        hidden: Boolean(input.hidden),
        inert: Boolean(input.inert),
        getAttribute: (name: string) => name === "aria-hidden" && input.ariaHidden ? "true" : null,
        closest: () => input.hidden || input.inert || input.ariaHidden ? element : null,
        getClientRects: () => input.visible === false ? [] : [{}],
      } as unknown as HTMLElement;
      return element;
    };
    const visible = makeElement({ tabIndex: 0 });
    const negative = makeElement({ tabIndex: -1 });
    const hidden = makeElement({ tabIndex: 0, hidden: true });
    const inert = makeElement({ tabIndex: 0, inert: true });
    const ariaHidden = makeElement({ tabIndex: 0, ariaHidden: true });
    const invisible = makeElement({ tabIndex: 0, visible: false });
    const panel = {
      querySelectorAll: () => [visible, negative, hidden, inert, ariaHidden, invisible],
    } as unknown as HTMLElement;

    expect(detailFocusableElements(panel)).toEqual([visible]);
  });

  it("keeps forward and reverse tabbing inside the detail modal when focus has no listed index", () => {
    expect(detailFocusIndex({ focusableCount: 3, activeIndex: -1, shiftKey: false })).toBe(0);
    expect(detailFocusIndex({ focusableCount: 3, activeIndex: -1, shiftKey: true })).toBe(2);
  });

  it("clears both the browser range and model selection after a successful action", () => {
    let rangeClears = 0;
    let modelClears = 0;
    clearTextAnnotationSelection(
      { removeAllRanges: () => { rangeClears += 1; } },
      () => { modelClears += 1; },
    );
    expect(rangeClears).toBe(1);
    expect(modelClears).toBe(1);
  });

  it("fails closed when the shared chat handoff is not connected", () => {
    const html = renderTextAnnotationLayer(annotationSnapshot);
    expect(html).toContain('data-annotation-chat');
    expect(html).toContain("disabled");
    expect(html).not.toContain('href="#/conversation"');
    expect(requestTextAnnotationChatHandoff(undefined, selection)).toBe(false);
  });

  it("keeps a selection save retry beside the source when persistence fails", () => {
    const html = renderTextAnnotationLayer({
      ...annotationSnapshot,
      saveError: "划线没有保存，当前选区已保留；请重试。",
    });
    expect(html).toContain('data-annotation-retry');
    expect(html).toContain('role="alert"');
  });

  it("exposes the selected source to the future shared chat seam", () => {
    let received: TextReaderChatHandoff | null = null;
    expect(requestTextAnnotationChatHandoff((value) => { received = value; }, selection, {
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      sections: readerSections,
    })).toBe(true);
    expect(received).toEqual({
      quote: selection.source.quote,
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      location: {
        sectionId: "txt:0",
        fileVersion: 2,
        start: 4,
        end: 8,
        sectionTitle: "雨停以后",
        sectionOrder: 0,
      },
    });
    const html = renderTextAnnotationLayer(annotationSnapshot, { chatHandoffAvailable: true });
    expect(html).toContain('data-annotation-quote="灯塔亮了"');
    expect(html).not.toContain("disabled");
  });

  it("derives a stable reader location for the chat handoff", () => {
    let received: TextReaderChatHandoff | null = null;
    const context = {
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      sections: [{
        sectionId: "txt:0",
        fileVersion: 2,
        title: "雨停以后",
        order: 0,
        text: "0123灯塔亮了",
      }],
    } as unknown as Parameters<typeof requestTextAnnotationChatHandoff>[2];

    expect(requestTextAnnotationChatHandoff((value) => { received = value; }, selection, context)).toBe(true);
    expect(received).toMatchObject({
      quote: selection.source.quote,
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      location: {
        sectionId: "txt:0",
        fileVersion: 2,
        start: 4,
        end: 8,
        sectionTitle: "雨停以后",
        sectionOrder: 0,
      },
    });
  });

  it("hands the exact quote and reader book identity to shared chat", () => {
    let received: TextReaderChatHandoff | null = null;
    const request = requestTextAnnotationChatHandoff as unknown as (
      handoff: (value: TextReaderChatHandoff) => void,
      value: TextAnnotationSelection | null,
      context: {
        bookId: string;
        bookTitle: string;
        author: string | null;
        sections: typeof readerSections;
      },
    ) => boolean;

    expect(request((value) => { received = value; }, selection, {
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      sections: readerSections,
    })).toBe(true);
    expect(received).toEqual({
      quote: selection.source.quote,
      bookId: "book-1",
      bookTitle: "雨后山亭",
      author: "林野",
      location: {
        sectionId: "txt:0",
        fileVersion: 2,
        start: 4,
        end: 8,
        sectionTitle: "雨停以后",
        sectionOrder: 0,
      },
    });
  });

  it("removes every keyboard listener after repeated attach and detach", () => {
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const target = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as (event: KeyboardEvent) => void);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as (event: KeyboardEvent) => void);
      },
    };
    let escapeCount = 0;
    const first = createTextAnnotationKeyboardBinding(target, () => { escapeCount += 1; });
    first.attach();
    first.detach();
    const second = createTextAnnotationKeyboardBinding(target, () => { escapeCount += 1; });
    second.attach();
    second.detach();
    for (const listener of listeners) listener({ key: "Escape" } as KeyboardEvent);
    expect(listeners.size).toBe(0);
    expect(escapeCount).toBe(0);
  });

  it("uses the real annotations endpoints and account boundary", async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => new Response(
      JSON.stringify({ fileVersion: 2, highlights: [], notes: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const api = createTextAnnotationApi("book/one", fetcher, "account-a");
    await api.list();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/books/book%2Fone/annotations",
      expect.objectContaining({ headers: { "x-selfalone-account": "account-a" } }),
    );
  });

  it("sends a highlight with an exact source and exposes retained server drafts", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ status: "failed", errorCode: "HIGHLIGHT_SAVE_FAILED", retainedDraft: { quote: "灯塔亮了" } }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    const api = createTextAnnotationApi("book-1", fetcher, "account-a");
    const input = {
      idempotencyKey: "highlight-1",
      locator: { kind: "text" as const, fileVersion: 2, sectionId: "txt:0", offset: 4 },
      endOffset: 8,
      quote: "灯塔亮了",
      thought: null,
    };
    await expect(api.createHighlight(input)).rejects.toMatchObject({
      code: "HIGHLIGHT_SAVE_FAILED",
      retainedDraft: { quote: "灯塔亮了" },
    } satisfies Partial<TextAnnotationRequestError>);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/books/book-1/highlights",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });

  it("refreshes the detail state after a bound highlight delete action", async () => {
    let deleted = false;
    let listCalls = 0;
    const api = {
      list: async () => {
        listCalls += 1;
        return { fileVersion: 2, highlights: deleted ? [] : [highlight], notes: [] };
      },
      createHighlight: async () => { throw new Error("NOT_USED"); },
      updateHighlight: async () => { throw new Error("NOT_USED"); },
      deleteHighlight: async (id: string, input: { expectedVersion: number }) => {
        expect(id).toBe("highlight-1");
        expect(input.expectedVersion).toBe(2);
        deleted = true;
        return { status: "deleted" as const, id };
      },
      createNote: async () => { throw new Error("NOT_USED"); },
      updateNote: async () => { throw new Error("NOT_USED"); },
      deleteNote: async () => { throw new Error("NOT_USED"); },
    };
    const deleteButton = new EventTarget() as EventTarget & { dataset: { bookDetailDeleteHighlight: string } };
    deleteButton.dataset = { bookDetailDeleteHighlight: "highlight-1" };
    const root = {
      querySelectorAll: (selector: string) => selector === "[data-book-detail-delete-highlight]" ? [deleteButton] : [],
      querySelector: () => null,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", new EventTarget());
    vi.stubGlobal("window", { setTimeout });
    const renders: number[] = [];
    const controller = createTextAnnotationController({
      bookId: "book-1",
      api,
      getReaderContext: () => ({ root, sections: [], reading: null }),
      onRender: () => renders.push(listCalls),
    });
    controller.details.snapshot = {
      ...controller.details.snapshot,
      open: true,
      fileVersion: 2,
      highlights: [highlight],
      notes: [],
    };

    try {
      controller.bind(root);
      deleteButton.dispatchEvent(new Event("click"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(deleted).toBe(true);
      expect(listCalls).toBe(2);
      expect(renders).toEqual([2]);
      expect(controller.details.snapshot.highlights).toEqual([]);
    } finally {
      controller.destroy();
      vi.unstubAllGlobals();
    }
  });
});
