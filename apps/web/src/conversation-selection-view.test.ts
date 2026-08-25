import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applySelectionSnapshot,
  createConversationSelectionState,
  type ConversationSelectionQuestion,
} from "./conversation-selection-state";
import { renderConversationSelectionView } from "./conversation-selection-view";

const selectionCss = readFileSync(new URL("./conversation-selection.css", import.meta.url), "utf8");

function question(overrides: Partial<ConversationSelectionQuestion> = {}): ConversationSelectionQuestion {
  return {
    id: "question-a",
    conversationId: "conversation-a",
    version: 1,
    prompt: "保留哪种内容？",
    mode: "single",
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

describe("conversation selection view", () => {
  it("renders pending options with accessible state and submitted history as read-only", () => {
    const state = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question(),
      question({ id: "question-old", status: "submitted", selectedValues: ["outline"], version: 2 }),
    ]);
    const rendered = renderConversationSelectionView({ state });

    expect(rendered.main).toContain('data-conversation-selection="conversation-a"');
    expect(rendered.main).toContain('data-selection-question="question-a"');
    expect(rendered.main).toContain('data-selection-option="summary"');
    expect(rendered.main).toContain('aria-pressed="false"');
    expect(rendered.main).toContain('data-selection-question="question-old"');
    expect(rendered.main).toContain("已选择：大纲");
    expect(rendered.main).not.toMatch(/data-selection-question="question-old"[\s\S]*data-selection-option/);
  });

  it("renders multi confirmation, free input, stale history, and retained failure copy", () => {
    const state = {
      ...applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
        question({ mode: "multi", selectedValues: ["summary"] }),
        question({ id: "question-free", mode: "free", options: [], freeText: "补充观点" }),
        question({ id: "question-stale", status: "stale", selectedValues: ["outline"], version: 3 }),
      ]),
      status: "error" as const,
      errorCode: "SELECTION_REQUEST_FAILED",
    };
    const rendered = renderConversationSelectionView({ state });

    expect(rendered.main).toContain("确认选择");
    expect(rendered.main).toContain('data-selection-free-input="question-free"');
    expect(rendered.main).toContain("已失效");
    expect(rendered.main).toContain("选择保存失败，当前输入仍保留，请重试");
    expect(rendered.main).not.toContain("SELECTION_REQUEST_FAILED");
  });

  it("keeps the private responsive and focus contract local to selection", () => {
    expect(selectionCss).toContain("min-height: 44px");
    expect(selectionCss).toContain("focus-visible");
    expect(selectionCss).toContain("@media (max-width: 1024px)");
    expect(selectionCss).toContain("@media (max-width: 768px)");
    expect(selectionCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
