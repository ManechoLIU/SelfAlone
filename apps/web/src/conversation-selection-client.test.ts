import { describe, expect, it } from "vitest";
import { createConversationSelectionClient, ConversationSelectionClientError } from "./conversation-selection-client";

describe("conversation selection client", () => {
  it("uses the private selection routes for history, creation, and answer", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const client = createConversationSelectionClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if ((init?.method ?? "GET") === "POST" && String(input).endsWith("selection-questions")) {
          return new Response(JSON.stringify({ question: { id: "question-a" } }), { status: 201 });
        }
        if (String(input).endsWith("/answer")) {
          return new Response(JSON.stringify({ status: "submitted", question: { id: "question-a" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ questions: [{ id: "question-a" }] }), { status: 200 });
      },
    });

    await client.listQuestions("conversation-a");
    await client.createQuestion("conversation-a", { prompt: "问题", mode: "single", options: [] });
    await client.answerQuestion("conversation-a", "question-a", {
      requestId: "answer-a",
      expectedVersion: 1,
      values: ["summary"],
    });

    expect(calls).toEqual([
      { url: "/api/v1/conversations/conversation-a/selection-questions", method: "GET" },
      { url: "/api/v1/conversations/conversation-a/selection-questions", method: "POST", body: { prompt: "问题", mode: "single", options: [] } },
      { url: "/api/v1/conversations/conversation-a/selection-questions/question-a/answer", method: "POST", body: { requestId: "answer-a", expectedVersion: 1, values: ["summary"], confirm: false } },
    ]);
  });

  it("surfaces a stable public code for failed selection persistence", async () => {
    const client = createConversationSelectionClient({
      fetch: async () => new Response(JSON.stringify({ code: "SELECTION_STALE" }), { status: 409 }),
    });

    await expect(client.answerQuestion("conversation-a", "question-a", {
      requestId: "answer-a",
      expectedVersion: 1,
      values: ["summary"],
    })).rejects.toBeInstanceOf(ConversationSelectionClientError);
  });
});
