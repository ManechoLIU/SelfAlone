import { describe, expect, it } from "vitest";
import type {
  TextAnnotationList,
  TextHighlight,
  TextNote,
  TextAnnotationSource,
} from "@selfalone/contracts";
import {
  createTextAnnotationModel,
  createTextAnnotationSourceFromOffsets,
  selectionToolbarPosition,
  textAnnotationViewState,
  type TextAnnotationApi,
  type TextAnnotationSelection,
} from "./text-annotation-state";

const source: TextAnnotationSource = {
  locator: { kind: "text", fileVersion: 2, sectionId: "txt:00000000", offset: 4 },
  endOffset: 8,
  quote: "灯塔亮了",
};

const highlight: TextHighlight = {
  id: "highlight-1",
  bookId: "book-1",
  ...source,
  thought: null,
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const note: TextNote = {
  id: "note-1",
  bookId: "book-1",
  body: "这句要留给下次回看。",
  source,
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function annotations(overrides: Partial<TextAnnotationApi> = {}): TextAnnotationApi {
  const list: TextAnnotationList = { fileVersion: 2, highlights: [highlight], notes: [note] };
  return {
    list: async () => list,
    createHighlight: async () => ({ status: "saved", highlight }),
    updateHighlight: async () => ({ status: "saved", highlight }),
    deleteHighlight: async () => ({ status: "deleted", id: highlight.id }),
    createNote: async () => ({ status: "saved", note }),
    updateNote: async () => ({ status: "saved", note }),
    deleteNote: async () => ({ status: "deleted", id: note.id }),
    ...overrides,
  };
}

describe("desktop text annotation state", () => {
  it("derives a precise source quote from one real section range", () => {
    expect(createTextAnnotationSourceFromOffsets({
      section: { sectionId: "txt:00000000", fileVersion: 2, text: "序章\n灯塔亮了，海面开始退潮。" },
      startOffset: 3,
      endOffset: 7,
    })).toEqual({
      locator: { kind: "text", fileVersion: 2, sectionId: "txt:00000000", offset: 3 },
      endOffset: 7,
      quote: "灯塔亮了",
    });
  });

  it("keeps the selection tool outside the selected rectangle", () => {
    expect(selectionToolbarPosition(
      { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
      { width: 900, height: 680 },
    )).toEqual({ left: 420, top: 124, placement: "above" });
    expect(selectionToolbarPosition(
      { top: 8, bottom: 34, left: 10, right: 110, width: 100, height: 26 },
      { width: 320, height: 240 },
    )).toMatchObject({ top: 46, placement: "below" });
    expect(selectionToolbarPosition(
      { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
      { width: 900, height: 680 },
      [{ top: 110, bottom: 160, left: 360, right: 720, width: 360, height: 50 }],
    )).toMatchObject({ top: 236, placement: "below" });
  });

  it("distinguishes loading, failure, empty and normal annotation states", () => {
    expect(textAnnotationViewState({ loading: true, error: "", fileVersion: null, highlights: [], notes: [] })).toBe("loading");
    expect(textAnnotationViewState({ loading: false, error: "断开", fileVersion: null, highlights: [], notes: [] })).toBe("failure");
    expect(textAnnotationViewState({ loading: false, error: "", fileVersion: 2, highlights: [], notes: [] })).toBe("empty");
    expect(textAnnotationViewState({ loading: false, error: "", fileVersion: 2, highlights: [highlight], notes: [] })).toBe("normal");
  });

  it("loads current annotations and retains a failed highlight draft for retry", async () => {
    let failed = true;
    const api = annotations({
      createHighlight: async (input) => {
        if (failed) throw new Error("HIGHLIGHT_SAVE_FAILED");
        return { status: "saved", highlight: { ...highlight, ...input } };
      },
    });
    const model = createTextAnnotationModel("book-1", api);
    await model.load();
    expect(model.snapshot).toMatchObject({ fileVersion: 2, highlights: [highlight], notes: [note] });

    const selection: TextAnnotationSelection = {
      source,
      rect: { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
    };
    model.setSelection(selection);
    await expect(model.saveSelection()).rejects.toThrow("HIGHLIGHT_SAVE_FAILED");
    expect(model.snapshot).toMatchObject({
      selection,
      pending: { kind: "highlight", source },
      saveError: "划线没有保存，当前选区已保留；请重试。",
    });
    failed = false;
    await model.retrySave();
    expect(model.snapshot).toMatchObject({ pending: null, saveError: "" });
  });

  it("deduplicates repeated saves while one highlight request is pending", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const model = createTextAnnotationModel("book-1", annotations({
      createHighlight: async (input) => {
        calls += 1;
        await gate;
        return { status: "saved", highlight: { ...highlight, ...input } };
      },
    }));
    model.setSelection({
      source,
      rect: { top: 180, bottom: 224, left: 420, right: 580, width: 160, height: 44 },
    });
    const first = model.saveSelection();
    const second = model.saveSelection();
    expect(calls).toBe(1);
    release?.();
    await Promise.all([first, second]);
    expect(model.snapshot.pending).toBeNull();
  });
});
