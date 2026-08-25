import { describe, expect, it } from "vitest";
import type { ConversationSelectionAnswerResult, ConversationSelectionQuestion } from "./conversation-selection-state";
import { createConversationSelectionController } from "./conversation-selection-controller";

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

describe("conversation selection controller", () => {
  it("submits a single choice immediately without a second confirmation", async () => {
    const calls: Array<{ confirm: boolean }> = [];
    const single = question({ mode: "single" });
    const client = {
      async listQuestions() { return [single]; },
      async createQuestion() { return single; },
      async answerQuestion(_conversationId: string, _questionId: string, input: { confirm?: boolean }): Promise<ConversationSelectionAnswerResult> {
        calls.push({ confirm: input.confirm ?? false });
        return {
          status: "submitted",
          question: { ...single, version: 2, status: "submitted", selectedValues: ["summary"], answer: { values: ["summary"], freeText: null }, answerRequestId: "answer-single" },
        };
      },
    };
    const controller = createConversationSelectionController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "answer-single",
    });

    await controller.hydrate();
    await controller.selectOption("question-a", "summary");

    expect(calls).toEqual([{ confirm: true }]);
    expect(controller.getState().questions[0]?.status).toBe("submitted");
  });

  it("hydrates, persists a multi draft, then requires explicit confirmation", async () => {
    const calls: Array<{ confirm: boolean; values?: readonly string[] }> = [];
    let current = question();
    const client = {
      async listQuestions() {
        return [current];
      },
      async createQuestion() {
        return current;
      },
      async answerQuestion(_conversationId: string, _questionId: string, input: { confirm?: boolean; values?: readonly string[] }): Promise<ConversationSelectionAnswerResult> {
        calls.push({ confirm: input.confirm ?? false, values: input.values });
        current = {
          ...current,
          version: current.version + 1,
          selectedValues: [...(input.values ?? [])],
          status: input.confirm ? "submitted" : "pending",
          answer: input.confirm ? { values: [...(input.values ?? [])], freeText: null } : null,
          answerRequestId: input.confirm ? "answer-1" : null,
        };
        return { status: input.confirm ? "submitted" : "pending", question: current };
      },
    };
    const controller = createConversationSelectionController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "answer-1",
    });

    await controller.hydrate();
    await controller.selectOption("question-a", "summary");
    expect(controller.getState().questions[0]?.status).toBe("pending");
    expect(calls).toEqual([{ confirm: false, values: ["summary"] }]);

    await controller.confirm("question-a");
    expect(calls).toEqual([
      { confirm: false, values: ["summary"] },
      { confirm: true, values: ["summary"] },
    ]);
    expect(controller.getState().questions[0]?.status).toBe("submitted");
  });

  it("retains a free-input draft when persistence fails", async () => {
    const client = {
      async listQuestions() { return [question({ mode: "free", options: [] })]; },
      async createQuestion() { return question({ mode: "free", options: [] }); },
      async answerQuestion(): Promise<ConversationSelectionAnswerResult> {
        throw new Error("network unavailable");
      },
    };
    const controller = createConversationSelectionController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "answer-free",
    });

    await controller.hydrate();
    controller.setFreeText("question-a", "失败后仍然要保留");
    await controller.confirm("question-a");

    expect(controller.getState()).toMatchObject({ status: "error", errorCode: "SELECTION_REQUEST_FAILED" });
    expect(controller.getState().drafts["question-a"]).toEqual({ values: [], freeText: "失败后仍然要保留" });
  });

  it("does not let a stale hydrate replace a local selection draft", async () => {
    let resolveHydrate: ((questions: ConversationSelectionQuestion[]) => void) | undefined;
    let listCalls = 0;
    const client = {
      listQuestions() {
        listCalls += 1;
        if (listCalls === 1) return Promise.resolve([question({ mode: "free", options: [] })]);
        return new Promise<ConversationSelectionQuestion[]>((resolve) => { resolveHydrate = resolve; });
      },
      async createQuestion() { return question({ mode: "free", options: [] }); },
      async answerQuestion(): Promise<ConversationSelectionAnswerResult> {
        return { status: "pending", question: question({ version: 2, selectedValues: ["summary"] }) };
      },
    };
    const controller = createConversationSelectionController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "answer-local",
    });

    await controller.hydrate();
    const hydrate = controller.hydrate();
    controller.setFreeText("question-a", "本地输入");
    resolveHydrate?.([question({ version: 4, selectedValues: ["outline"] })]);
    await hydrate;

    expect(controller.getState().drafts["question-a"]).toEqual({ values: [], freeText: "本地输入" });
  });
});
