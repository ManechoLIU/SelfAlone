import { describe, expect, it } from "vitest";
import {
  applySelectionResult,
  applySelectionSnapshot,
  createConversationSelectionState,
  selectionDraftFor,
  setSelectionFreeText,
  toggleSelectionOption,
  type ConversationSelectionQuestion,
} from "./conversation-selection-state";

function question(overrides: Partial<ConversationSelectionQuestion> = {}): ConversationSelectionQuestion {
  return {
    id: "question-a",
    conversationId: "conversation-a",
    version: 1,
    prompt: "保留哪些内容？",
    mode: "multi",
    options: [
      { value: "summary", label: "摘要" },
      { value: "outline", label: "大纲" },
    ],
    status: "pending",
    selectedValues: [],
    freeText: null,
    answer: null,
    answerRequestId: null,
    ...overrides,
  };
}

describe("conversation selection state", () => {
  it("restores pending drafts and picks the latest pending question", () => {
    const state = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ id: "question-old", status: "submitted", selectedValues: ["summary"], version: 2 }),
      question({ id: "question-new", selectedValues: ["outline"], version: 3 }),
    ]);

    expect(state.activeQuestionId).toBe("question-new");
    expect(selectionDraftFor(state, "question-new")).toEqual({ values: ["outline"], freeText: "" });
    expect(state.status).toBe("idle");
  });

  it("updates only pending drafts and preserves a submitted history item", () => {
    const state = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ id: "question-old", status: "submitted", selectedValues: ["summary"], version: 2 }),
      question({ id: "question-new" }),
    ]);
    const selected = toggleSelectionOption(state, "question-new", "summary");
    const stateWithFree = {
      ...selected,
      questions: [...selected.questions, question({ id: "question-free", mode: "free", options: [] })],
      drafts: { ...selected.drafts, "question-free": { values: [], freeText: "" } },
    };
    const typed = setSelectionFreeText(
      stateWithFree,
      "question-free",
      "补充说明",
    );

    expect(selectionDraftFor(typed, "question-new")).toEqual({ values: ["summary"], freeText: "" });
    expect(selectionDraftFor(typed, "question-free")).toEqual({ values: [], freeText: "补充说明" });
    expect(selectionDraftFor(typed, "question-old")).toEqual({ values: ["summary"], freeText: "" });
    expect(toggleSelectionOption(typed, "question-old", "outline")).toBe(typed);
  });

  it("removes the local draft after a submitted result and retains it after an error", () => {
    const state = setSelectionFreeText(
      applySelectionSnapshot(createConversationSelectionState("conversation-a"), [question({ mode: "free", options: [] })]),
      "question-a",
      "需要保留",
    );
    const failed = { ...state, status: "error" as const, errorCode: "SELECTION_REQUEST_FAILED" };
    expect(selectionDraftFor(failed, "question-a").freeText).toBe("需要保留");

    const submitted = applySelectionResult(state, {
      status: "submitted",
      question: question({ mode: "free", options: [], status: "submitted", version: 2, freeText: "需要保留", answer: { values: [], freeText: "需要保留" }, answerRequestId: "answer-a" }),
    });
    expect(submitted.questions[0]?.status).toBe("submitted");
    expect(selectionDraftFor(submitted, "question-a")).toEqual({ values: [], freeText: "" });
  });
});
