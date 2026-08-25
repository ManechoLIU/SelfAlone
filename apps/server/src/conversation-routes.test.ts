import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { registerConversationRoutes } from "./conversation-routes";

describe("private conversation routes", () => {
  it("registers a send and refresh path without requiring app wiring", async () => {
    const app = Fastify({ logger: false });
    const runtime = {
      createSession: async () => ({
        id: "conversation-a",
        revision: 0,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      }),
      getSession: async () => ({
        id: "conversation-a",
        revision: 0,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      }),
      listSessions: async () => [],
      sendText: async () => ({
        status: "completed" as const,
        reply: "我先记下：你好",
        session: {
          id: "conversation-a",
          revision: 5,
          draft: null,
          context: [
            { id: "request-a:user", role: "user" as const, text: "你好" },
            {
              id: "request-a:assistant",
              role: "assistant" as const,
              text: "我先记下：你好",
              requestId: "request-a",
            },
          ],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        },
      }),
    };

    await registerConversationRoutes(app, runtime, () => "account-a");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/messages",
      payload: { requestId: "request-a", text: "你好" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "completed", reply: "我先记下：你好" });
    await app.close();
  });

  it("is reachable through the application composition seam", async () => {
    const runtime = {
      createSession: async () => ({
        id: "conversation-a",
        revision: 0,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      }),
      getSession: async () => ({
        id: "conversation-a",
        revision: 0,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      }),
      listSessions: async () => [],
      sendText: async () => ({
        status: "completed" as const,
        reply: "我先记下：你好",
        session: {
          id: "conversation-a",
          revision: 1,
          draft: null,
          context: [],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        },
      }),
    };
    const app = createApp({ readiness: async () => true, conversation: runtime });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/conversations",
      headers: { "x-selfalone-account": "account-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ conversations: [] });
    await app.close();
  });

  it("passes a recent-conversation search through with the authenticated account", async () => {
    const app = Fastify({ logger: false });
    const calls: Array<{ accountId: string; query: string }> = [];
    const runtime = {
      createSession: async () => {
        throw new Error("not used");
      },
      getSession: async () => null,
      listSessions: async (accountId: string, query = "") => {
        calls.push({ accountId, query });
        return [];
      },
      sendText: async () => {
        throw new Error("not used");
      },
    };

    await registerConversationRoutes(app, runtime, () => "account-a");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/conversations?query=%E9%95%BF%E5%AE%89",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ conversations: [] });
    expect(calls).toEqual([{ accountId: "account-a", query: "长安" }]);
    await app.close();
  });
});
