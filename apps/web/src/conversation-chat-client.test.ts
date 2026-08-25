import { describe, expect, it } from "vitest";
import { createConversationChatClient } from "./conversation-chat-client";

describe("conversation chat client", () => {
  it("uses the private conversation routes for refresh and send", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = createConversationChatClient({
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET" });
        return new Response(JSON.stringify({ session: { id: "conversation-a" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      headers: { "x-selfalone-account": "account-a" },
    });

    await client.getSession("conversation-a");
    await client.sendText("conversation-a", { requestId: "request-a", text: "你好" });

    expect(requests).toEqual([
      { url: "/api/v1/conversations/conversation-a", method: "GET" },
      { url: "/api/v1/conversations/conversation-a/messages", method: "POST" },
    ]);
  });

  it("lists existing conversations and creates the first persisted session", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = createConversationChatClient({
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET" });
        if (String(input) === "/api/v1/conversations" && init?.method !== "POST") {
          return new Response(JSON.stringify({ conversations: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({
          session: {
            id: "conversation-created",
            revision: 0,
            draft: null,
            context: [],
            activeRun: null,
            tasks: [],
            works: [],
            deleted: false,
          },
        }), { status: 201 });
      },
    });

    expect(await client.listSessions()).toEqual([]);
    expect((await client.createSession()).id).toBe("conversation-created");
    expect(requests).toEqual([
      { url: "/api/v1/conversations", method: "GET" },
      { url: "/api/v1/conversations", method: "POST" },
    ]);
  });
});
