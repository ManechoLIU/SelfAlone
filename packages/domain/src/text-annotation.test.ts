import { describe, expect, it } from "vitest";
import {
  createTextHighlightDraft,
  createTextNoteDraft,
  type TextAnnotationSource,
} from "./text-annotation";

const section = {
  sectionId: "txt:00000000",
  fileVersion: 3,
  text: "序章\n灯塔亮了，海面开始退潮。",
};

const locator = {
  kind: "text" as const,
  fileVersion: 3,
  sectionId: "txt:00000000",
  offset: 3,
};

describe("text annotation domain rules", () => {
  it("creates a highlight only when the locator range exactly matches the source text", () => {
    expect(createTextHighlightDraft({
      section,
      locator,
      endOffset: 7,
      thought: "这句让我想起童年。",
    })).toEqual({
      locator,
      endOffset: 7,
      quote: "灯塔亮了",
      thought: "这句让我想起童年。",
    });
  });

  it("rejects a range copied from a different file version or quote", () => {
    expect(() => createTextHighlightDraft({
      section: { ...section, fileVersion: 4 },
      locator,
      endOffset: 7,
      quote: "灯塔亮了",
    })).toThrow("STALE_VERSION");
    expect(() => createTextHighlightDraft({
      section,
      locator,
      endOffset: 7,
      quote: "灯塔熄了",
    })).toThrow("INVALID_HIGHLIGHT_QUOTE");
    expect(() => createTextHighlightDraft({
      section,
      locator: { ...locator, offset: 9 },
      endOffset: 3,
    })).toThrow("INVALID_HIGHLIGHT_RANGE");
  });

  it("keeps manual notes titleless and validates an optional source citation", () => {
    const source: TextAnnotationSource = {
      locator,
      endOffset: 9,
      quote: "灯塔亮了",
    };
    expect(createTextNoteDraft({ body: "潮水退去后，路才显出来。", source })).toEqual({
      body: "潮水退去后，路才显出来。",
      source,
    });
    expect(createTextNoteDraft({ body: "  独立的一点记录  " })).toEqual({
      body: "独立的一点记录",
      source: null,
    });
    expect(() => createTextNoteDraft({ body: "   " })).toThrow("NOTE_BODY_REQUIRED");
  });
});
