import { describe, expect, it } from "vitest";
import {
  applySelectionAnswer,
  createSelectionQuestion,
  type ConversationSelectionQuestion,
} from "./conversation-selection";

function question(
  mode: ConversationSelectionQuestion["mode"],
  requiresConfirmation = false,
): ConversationSelectionQuestion {
  return createSelectionQuestion({
    id: `question-${mode}`,
    conversationId: "conversation-a",
    prompt: "这次要保留什么？",
    mode,
    options: mode === "free"
      ? []
      : [
          { value: "summary", label: "摘要" },
          { value: "outline", label: "大纲" },
        ],
    ...(requiresConfirmation ? { requiresConfirmation: true } : {}),
  });
}

describe("conversation selection core", () => {
  it("submits a low-risk single choice immediately", () => {
    const result = applySelectionAnswer(question("single"), {
      values: ["summary"],
    });

    expect(result.status).toBe("submitted");
    expect(result.question).toMatchObject({
      status: "submitted",
      selectedValues: ["summary"],
      freeText: null,
    });
  });

  it("keeps a high-impact single choice pending until explicit confirmation", () => {
    const pending = applySelectionAnswer(question("single", true), {
      values: ["summary"],
      confirm: false,
    });

    expect(pending.status).toBe("pending");
    expect(pending.question).toMatchObject({
      status: "pending",
      selectedValues: ["summary"],
    });

    const submitted = applySelectionAnswer(pending.question, {
      values: ["summary"],
      confirm: true,
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.question.status).toBe("submitted");
  });

  it("keeps a multi choice pending until explicit confirmation", () => {
    const pending = applySelectionAnswer(question("multi"), {
      values: ["summary", "outline"],
    });

    expect(pending.status).toBe("pending");
    expect(pending.question).toMatchObject({
      status: "pending",
      selectedValues: ["summary", "outline"],
    });

    const submitted = applySelectionAnswer(pending.question, {
      values: ["summary", "outline"],
      confirm: true,
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.question.status).toBe("submitted");
  });

  it("keeps free input pending until explicit confirmation", () => {
    const pending = applySelectionAnswer(question("free"), {
      freeText: "保留我的观点",
    });

    expect(pending.status).toBe("pending");
    expect(pending.question.freeText).toBe("保留我的观点");

    const submitted = applySelectionAnswer(pending.question, {
      freeText: "保留我的观点",
      confirm: true,
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.question.freeText).toBe("保留我的观点");
  });

  it("rejects a submitted question as read-only", () => {
    const submitted = applySelectionAnswer(question("single"), { values: ["summary"] });

    expect(() => applySelectionAnswer(submitted.question, { values: ["outline"] }))
      .toThrow("SELECTION_STALE");
    expect(submitted.question.selectedValues).toEqual(["summary"]);
  });
});
