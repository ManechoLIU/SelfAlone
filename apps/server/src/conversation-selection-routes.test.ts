import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  ConversationSelectionStoreError,
  type ConversationSelectionAnswerResult,
  type CreateSelectionQuestionInput,
} from "./conversation-selection-store";
import { registerConversationSelectionRoutes } from "./conversation-selection-routes";

const question = {
  id: "question-a",
  conversationId: "conversation-a",
  assistantMessageId: "message-assistant-a",
  version: 1,
  prompt: "保留哪种内容？",
  mode: "single" as const,
  requiresConfirmation: false,
  options: [{ value: "summary", label: "摘要" }],
  status: "pending" as const,
  selectedValues: [],
  freeText: null,
  answer: null,
  answerRequestId: null,
};

describe("conversation selection routes", () => {
  it("creates, lists, and answers questions through an account-scoped API", async () => {
    const app = Fastify({ logger: false });
    const calls: string[] = [];
    const runtime = {
      createQuestion: async (_accountId: string, _conversationId: string, input: CreateSelectionQuestionInput) => {
        calls.push(`create:${input.prompt}:${input.requiresConfirmation}:${input.assistantMessageId}`);
        return question;
      },
      listQuestions: async () => [question],
      getQuestion: async () => question,
      answerQuestion: async (): Promise<ConversationSelectionAnswerResult> => ({
        status: "submitted",
        question: { ...question, version: 2, status: "submitted", selectedValues: ["summary"], answer: { values: ["summary"], freeText: null }, answerRequestId: "answer-a" },
      }),
    };
    await registerConversationSelectionRoutes(app, runtime, () => "account-a");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/selection-questions",
      payload: { assistantMessageId: "message-assistant-a", prompt: "保留哪种内容？", mode: "single", requiresConfirmation: true, options: [{ value: "summary", label: "摘要" }] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ question });

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/conversation-a/selection-questions",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ questions: [question] });

    const answered = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/selection-questions/question-a/answer",
      payload: { requestId: "answer-a", expectedVersion: 1, values: ["summary"] },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ status: "submitted", question: { status: "submitted" } });
    expect(calls).toEqual(["create:保留哪种内容？:true:message-assistant-a"]);
    await app.close();
  });

  it("maps stale selection writes to a conflict without exposing internals", async () => {
    const app = Fastify({ logger: false });
    const runtime = {
      createQuestion: async () => question,
      listQuestions: async () => [],
      getQuestion: async () => null,
      answerQuestion: async () => {
        throw new ConversationSelectionStoreError("SELECTION_STALE");
      },
    };
    await registerConversationSelectionRoutes(app, runtime, () => "account-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/selection-questions/question-a/answer",
      payload: { requestId: "answer-a", expectedVersion: 1, values: ["summary"] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SELECTION_STALE" });
    await app.close();
  });
});
