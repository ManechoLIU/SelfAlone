import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createConversationChatState } from "./conversation-chat-state";
import { renderConversationChatView } from "./conversation-chat-view";
import {
  applySelectionSnapshot,
  createConversationSelectionState,
  type ConversationSelectionQuestion,
} from "./conversation-selection-state";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

const question: ConversationSelectionQuestion = {
  id: "question-a",
  conversationId: "conversation-a",
  assistantMessageId: "assistant-a",
  version: 1,
  prompt: "选择要保留的内容",
  mode: "single",
  requiresConfirmation: false,
  options: [{ value: "summary", label: "摘要" }],
  status: "pending",
  selectedValues: [],
  freeText: null,
  answer: null,
  answerRequestId: null,
};

describe("conversation selection shared seam", () => {
  it("slots each question below its assistant message instead of a sibling stream", () => {
    const selectionState = applySelectionSnapshot(
      createConversationSelectionState("conversation-a"),
      [question],
    );
    const rendered = renderConversationChatView({
      state: {
        ...createConversationChatState("conversation-a"),
        messages: [{ id: "assistant-a", role: "assistant", text: "请告诉我你的选择。" }],
      },
      selectionState,
    } as never);

    const assistantStart = rendered.main.indexOf('data-message-id="assistant-a"');
    const selectionStart = rendered.main.indexOf('data-selection-question="question-a"');
    const assistantEnd = rendered.main.indexOf("</article>", assistantStart);
    expect(assistantStart).toBeGreaterThanOrEqual(0);
    expect(selectionStart).toBeGreaterThan(assistantStart);
    expect(selectionStart).toBeLessThan(assistantEnd);
    expect(rendered.main).not.toMatch(/<\/article>\s*<section[^>]*conversation-selection/);
  });

  it("creates an account and conversation scoped draft cache and disposes old selection hydration", () => {
    expect(mainSource).toContain("createConversationSelectionClient");
    expect(mainSource).toContain("createConversationSelectionController");
    expect(mainSource).toContain("conversation-selection-draft");
    expect(mainSource).toContain("accountId");
    expect(mainSource).toContain("conversationId");
    expect(mainSource).toContain("questionId");
    expect(mainSource).toContain("conversationSelectionCleanup");
    expect(mainSource).toContain("destroyConversationSelection");
  });
});

