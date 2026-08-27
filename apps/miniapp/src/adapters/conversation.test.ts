import { describe, expect, it, vi } from "vitest";
import {
  ConversationApiError,
  createConversationApiClient,
  type ConversationApiSession,
  type ConversationHttpRequest,
  type ConversationHttpResponse,
} from "./conversation";

function session(id = "conversation-a"): ConversationApiSession {
  return {
    id,
    revision: 0,
    draft: null,
    context: [],
    activeRun: null,
    tasks: [],
    works: [],
    deleted: false,
  };
}

function response(body: unknown, status = 200): ConversationHttpResponse {
  return { status, body };
}

describe("miniapp conversation API adapter", () => {
  it("uses the stable hydrate/create/send JSON routes and injected auth headers", async () => {
    const requests: ConversationHttpRequest[] = [];
    const transport = vi.fn(async (request: ConversationHttpRequest) => {
      requests.push(request);
      if (request.method === "GET") return response({ session: session("conversation-a") });
      if (request.url.endsWith("/conversations") && request.method === "POST") {
        return response({ session: session("conversation-created") }, 201);
      }
      return response({
        status: "completed",
        session: session("conversation-a"),
        reply: "收到",
      });
    });
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test/",
      authHeaders: { "x-m2-session": "opaque-test-token" },
      transport,
    });

    await client.hydrateOrCreateSession("conversation-a");
    await client.createSession();
    await client.sendText("conversation-a", { requestId: "request-a", text: "你好" });

    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/conversations/conversation-a",
        method: "GET",
        headers: {
          "x-m2-session": "opaque-test-token",
          accept: "application/json",
        },
      },
      {
        url: "https://api.example.test/api/v1/conversations",
        method: "POST",
        headers: {
          "x-m2-session": "opaque-test-token",
          accept: "application/json",
          "content-type": "application/json",
        },
        body: {},
      },
      {
        url: "https://api.example.test/api/v1/conversations/conversation-a/messages",
        method: "POST",
        headers: {
          "x-m2-session": "opaque-test-token",
          accept: "application/json",
          "content-type": "application/json",
        },
        body: { requestId: "request-a", text: "你好" },
      },
    ]);
  });

  it("fails closed before transport when the base URL or auth seam is missing", async () => {
    const transport = vi.fn(async () => response({ session: session() }));
    const client = createConversationApiClient({ transport });

    await expect(client.createSession()).rejects.toEqual(
      new ConversationApiError(0, "CONVERSATION_API_UNAVAILABLE", false),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns the server failed result so the page can retain its draft", async () => {
    const failed = {
      status: "failed" as const,
      session: { ...session(), revision: 1, draft: { text: "保留", attachments: [] } },
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "保留", attachments: [] },
    };
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test",
      authHeaders: { "x-m2-session": "opaque-test-token" },
      transport: async () => response(failed, 503),
    });

    await expect(client.sendText("conversation-a", { requestId: "request-a", text: "保留" }))
      .resolves.toEqual(failed);
  });

  it("creates a fresh session after a missing persisted session", async () => {
    const requests: ConversationHttpRequest[] = [];
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test",
      authHeaders: { "x-m2-session": "opaque-test-token" },
      transport: async (request) => {
        requests.push(request);
        return request.method === "GET"
          ? response({ code: "CONVERSATION_NOT_FOUND" }, 404)
          : response({ session: session("conversation-new") }, 201);
      },
    });

    await expect(client.hydrateOrCreateSession("conversation-old")).resolves.toMatchObject({
      id: "conversation-new",
    });
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: "https://api.example.test/api/v1/conversations/conversation-old" },
      { method: "POST", url: "https://api.example.test/api/v1/conversations" },
    ]);
  });
});
