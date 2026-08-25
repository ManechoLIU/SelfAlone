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
    requiresConfirmation: false,
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
      accountId: "account-a",
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
      accountId: "account-a",
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
      accountId: "account-a",
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

  it("replays a pending selection after a lost response, then rotates the request id", async () => {
    const calls: Array<{ requestId: string; expectedVersion: number; confirm: boolean }> = [];
    let current = question({ mode: "single", requiresConfirmation: true });
    let attempt = 0;
    const client = {
      async listQuestions() { return [current]; },
      async createQuestion() { return current; },
      async answerQuestion(_conversationId: string, _questionId: string, input: { requestId: string; expectedVersion: number; confirm?: boolean; values?: readonly string[] }): Promise<ConversationSelectionAnswerResult> {
        calls.push({ requestId: input.requestId, expectedVersion: input.expectedVersion, confirm: input.confirm ?? false });
        if (attempt++ > 0 && input.requestId === "request-1") {
          return { status: "pending", question: current };
        }
        current = {
          ...current,
          version: current.version + 1,
          selectedValues: [...(input.values ?? [])],
          status: input.confirm ? "submitted" : "pending",
          answer: input.confirm ? { values: [...(input.values ?? [])], freeText: null } : null,
          answerRequestId: input.confirm ? input.requestId : null,
        };
        if (attempt === 1) throw new Error("response lost after server commit");
        return { status: input.confirm ? "submitted" : "pending", question: current };
      },
    };
    let ids = 0;
    const controller = createConversationSelectionController({
      accountId: "account-a",
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => `request-${++ids}`,
    });

    await controller.hydrate();
    await controller.selectOption("question-a", "summary");
    await controller.selectOption("question-a", "summary");
    await controller.confirm("question-a");

    expect(calls).toEqual([
      { requestId: "request-1", expectedVersion: 1, confirm: false },
      { requestId: "request-1", expectedVersion: 1, confirm: false },
      { requestId: "request-2", expectedVersion: 2, confirm: true },
    ]);
    expect(controller.getState().questions[0]?.status).toBe("submitted");
  });

  it("hydrates an account and conversation scoped free-input draft from the injected cache", async () => {
    const cache = new Map<string, { values: readonly string[]; freeText: string }>();
    const draftCache = {
      load: (accountId: string, conversationId: string, questionId: string) => cache.get(`${accountId}/${conversationId}/${questionId}`) ?? null,
      save: (accountId: string, conversationId: string, questionId: string, draft: { values: readonly string[]; freeText: string }) => {
        cache.set(`${accountId}/${conversationId}/${questionId}`, draft);
      },
      clear: (accountId: string, conversationId: string, questionId: string) => {
        cache.delete(`${accountId}/${conversationId}/${questionId}`);
      },
    };
    const client = {
      async listQuestions() { return [question({ mode: "free", options: [] })]; },
      async createQuestion() { return question({ mode: "free", options: [] }); },
      async answerQuestion(): Promise<ConversationSelectionAnswerResult> {
        throw new Error("not used");
      },
    };
    const original = createConversationSelectionController({ accountId: "account-a", conversationId: "conversation-a", client, draftCache });
    await original.hydrate();
    original.setFreeText("question-a", "刷新后仍保留");

    const restored = createConversationSelectionController({ accountId: "account-a", conversationId: "conversation-a", client, draftCache });
    await restored.hydrate();
    expect(restored.getState().drafts["question-a"]).toEqual({ values: [], freeText: "刷新后仍保留" });

    const otherAccount = createConversationSelectionController({ accountId: "account-b", conversationId: "conversation-a", client, draftCache });
    await otherAccount.hydrate();
    expect(otherAccount.getState().drafts["question-a"]).toEqual({ values: [], freeText: "" });

    const otherConversation = createConversationSelectionController({ accountId: "account-a", conversationId: "conversation-b", client, draftCache });
    await otherConversation.hydrate();
    expect(otherConversation.getState().drafts["question-a"]).toEqual({ values: [], freeText: "" });
  });

  it("clears the scoped draft cache after submission and stale hydration", async () => {
    const cache = new Map<string, { values: readonly string[]; freeText: string }>();
    const draftCache = {
      load: (accountId: string, conversationId: string, questionId: string) => cache.get(`${accountId}/${conversationId}/${questionId}`) ?? null,
      save: (accountId: string, conversationId: string, questionId: string, draft: { values: readonly string[]; freeText: string }) => {
        cache.set(`${accountId}/${conversationId}/${questionId}`, draft);
      },
      clear: (accountId: string, conversationId: string, questionId: string) => {
        cache.delete(`${accountId}/${conversationId}/${questionId}`);
      },
    };
    let current = question({ mode: "free", options: [] });
    const client = {
      async listQuestions() { return [current]; },
      async createQuestion() { return current; },
      async answerQuestion(): Promise<ConversationSelectionAnswerResult> {
        current = question({ mode: "free", options: [], status: "submitted", version: 2, freeText: "提交", answer: { values: [], freeText: "提交" } });
        return { status: "submitted", question: current };
      },
    };
    const controller = createConversationSelectionController({ accountId: "account-a", conversationId: "conversation-a", client, draftCache });
    await controller.hydrate();
    controller.setFreeText("question-a", "提交");
    await controller.confirm("question-a");
    expect(cache.size).toBe(0);

    cache.set("account-a/conversation-a/question-a", { values: [], freeText: "过期" });
    current = question({ mode: "free", options: [], status: "stale", version: 3, freeText: "过期" });
    await controller.hydrate();
    expect(cache.size).toBe(0);
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
      accountId: "account-a",
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
