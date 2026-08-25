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

  it("loads searchable recent conversations and creates a real new session for the account", async () => {
    const requests: Array<{ url: string; method: string; account: string | null }> = [];
    const client = createConversationChatClient({
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          account: headers.get("x-selfalone-account"),
        });
        return new Response(JSON.stringify({
          conversations: [{ id: "conversation-search-hit" }],
          session: { id: "conversation-created" },
        }), { status: init?.method === "POST" ? 201 : 200 });
      },
      headers: { "x-selfalone-account": "account-a" },
    });

    await expect(client.listSessions({ query: "长安" })).resolves.toEqual([
      { id: "conversation-search-hit" },
    ]);
    await expect(client.createSession()).resolves.toEqual({ id: "conversation-created" });

    expect(requests).toEqual([
      {
        url: "/api/v1/conversations?query=%E9%95%BF%E5%AE%89",
        method: "GET",
        account: "account-a",
      },
      { url: "/api/v1/conversations", method: "POST", account: "account-a" },
    ]);
  });

  it("gets an unclaimed trial quota and makes repeated claims idempotent for one account", async () => {
    const requests: Array<{ url: string; method: string; account: string | null }> = [];
    const client = createConversationChatClient({
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          account: headers.get("x-selfalone-account"),
        });
        const url = String(input);
        if (url === "/api/v1/account/trial-quota") {
          return new Response(JSON.stringify({ status: "unclaimed" }), { status: 200 });
        }
        if (url === "/api/v1/account/trial-quota/claim") {
          return new Response(JSON.stringify({ status: "claimed" }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: "UNEXPECTED_REQUEST" }), { status: 404 });
      },
      headers: { "x-selfalone-account": "account-a" },
    });

    await expect(client.getTrialQuota()).resolves.toEqual({ status: "unclaimed" });
    const firstClaim = await client.claimTrialQuota();
    const secondClaim = await client.claimTrialQuota();

    expect(firstClaim).toEqual({ status: "claimed" });
    expect(secondClaim).toEqual(firstClaim);
    expect(requests).toEqual([
      { url: "/api/v1/account/trial-quota", method: "GET", account: "account-a" },
      { url: "/api/v1/account/trial-quota/claim", method: "POST", account: "account-a" },
      { url: "/api/v1/account/trial-quota/claim", method: "POST", account: "account-a" },
    ]);
  });
});
