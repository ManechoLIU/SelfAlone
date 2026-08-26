import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applySelectionSnapshot,
  createConversationSelectionState,
  type ConversationSelectionQuestion,
  type ConversationSelectionState,
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
    requiresConfirmation: false,
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

  it("renders confirmation for a high-impact single choice after selection", () => {
    const state = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ requiresConfirmation: true, selectedValues: ["summary"] }),
    ]);
    const rendered = renderConversationSelectionView({ state });

    expect(rendered.main).toContain('aria-pressed="true"');
    expect(rendered.main).toContain('data-selection-confirm="question-a"');
    expect(rendered.main).toContain("确认选择");
  });

  it("keeps a same-question focus target when an option disappears after rerender", () => {
    const state = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ status: "submitted", selectedValues: ["summary"], version: 2 }),
    ]);
    const rendered = renderConversationSelectionView({ state });

    expect(rendered.main).toContain('class="conversation-selection-question is-readonly"');
    expect(rendered.main).toContain('class="conversation-selection-readonly" role="status" tabindex="-1"');
  });

  it("keeps the private responsive and focus contract local to selection", () => {
    expect(selectionCss).toContain("min-height: 44px");
    expect(selectionCss).toContain("focus-visible");
    expect(selectionCss).toContain("@media (max-width: 1024px)");
    expect(selectionCss).toContain("@media (max-width: 768px)");
    expect(selectionCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("disables empty multi and free confirmation until the draft is valid", () => {
    const empty = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ id: "question-multi", mode: "multi" }),
      question({ id: "question-free", mode: "free", options: [] }),
    ]);
    const emptyRendered = renderConversationSelectionView({ state: empty });
    expect(emptyRendered.main).toMatch(/data-selection-confirm="question-multi"[^>]*disabled/);
    expect(emptyRendered.main).toMatch(/data-selection-confirm="question-free"[^>]*disabled/);
    expect(emptyRendered.main).toContain('aria-label="确认当前选择"');

    const valid = applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
      question({ id: "question-multi", mode: "multi", selectedValues: ["summary"] }),
      question({ id: "question-free", mode: "free", options: [], freeText: "补充说明" }),
    ]);
    const validRendered = renderConversationSelectionView({ state: valid });
    expect(validRendered.main).toContain('data-selection-confirm="question-multi"');
    expect(validRendered.main).not.toMatch(/data-selection-confirm="question-multi"[^>]*disabled/);
    expect(validRendered.main).toContain('data-selection-confirm="question-free"');
    expect(validRendered.main).not.toMatch(/data-selection-confirm="question-free"[^>]*disabled/);
  });

  it("renders an executable recovery action separately from a generic error", () => {
    const state = {
      ...applySelectionSnapshot(createConversationSelectionState("conversation-a"), [
        question({ mode: "multi", selectedValues: ["summary"] }),
      ]),
      status: "error" as const,
      errorCode: "SELECTION_REQUEST_FAILED",
      recoveryQuestionId: "question-a",
    } as ConversationSelectionState & { recoveryQuestionId: string };
    const rendered = renderConversationSelectionView({ state });

    expect(rendered.main).toContain("这次保存结果尚未确认，当前输入仍保留");
    expect(rendered.main).toContain('data-selection-retry="question-a"');
    expect(rendered.main).toContain('aria-label="重试保存当前选择"');
    expect(rendered.main).not.toContain("选择保存失败，当前输入仍保留，请重试");

    const generic = renderConversationSelectionView({
      state: { ...state, recoveryQuestionId: undefined } as ConversationSelectionState,
    });
    expect(generic.main).toContain("选择保存失败，当前输入仍保留，请重试");
    expect(generic.main).not.toContain("data-selection-retry");
  });
});
