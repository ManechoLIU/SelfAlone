import { describe, expect, it, vi } from "vitest";
import {
  clearTextAnnotationSelection,
  createTextAnnotationApi,
  createTextAnnotationKeyboardBinding,
  requestTextAnnotationChatHandoff,
  type TextAnnotationRequestError,
} from "./text-annotation";
import { renderTextAnnotationLayer } from "./text-annotation-view";
import type { TextAnnotationSnapshot, TextAnnotationSelection } from "./text-annotation-state";

const selection: TextAnnotationSelection = {
  source: {
    locator: { kind: "text", fileVersion: 2, sectionId: "txt:0", offset: 4 },
    endOffset: 8,
    quote: "灯塔亮了",
  },
  rect: { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
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
    let received: TextAnnotationSelection | null = null;
    expect(requestTextAnnotationChatHandoff((value) => { received = value; }, selection)).toBe(true);
    expect(received).toEqual(selection);
    const html = renderTextAnnotationLayer(annotationSnapshot, { chatHandoffAvailable: true });
    expect(html).toContain('data-annotation-quote="灯塔亮了"');
    expect(html).not.toContain("disabled");
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
});
