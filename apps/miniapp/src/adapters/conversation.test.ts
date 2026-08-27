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

function authenticated(token: string) {
  return {
    kind: "authenticated" as const,
    token,
    expiresAt: 1_900_000_000_000,
  };
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
      authProvider: () => authenticated("opaque-test-token-1234567890"),
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
          Authorization: "Bearer opaque-test-token-1234567890",
          accept: "application/json",
        },
      },
      {
        url: "https://api.example.test/api/v1/conversations",
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-test-token-1234567890",
          accept: "application/json",
          "content-type": "application/json",
        },
        body: {},
      },
      {
        url: "https://api.example.test/api/v1/conversations/conversation-a/messages",
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-test-token-1234567890",
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

  it("reads the current authenticated session for every request", async () => {
    let currentSession = authenticated("opaque-first-session-token-123456");
    const requests: ConversationHttpRequest[] = [];
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => currentSession,
      transport: async (request) => {
        requests.push(request);
        return response({ session: session() });
      },
    });

    await client.getSession("conversation-a");
    currentSession = authenticated("opaque-second-session-token-123456");
    await client.getSession("conversation-a");

    expect(requests.map((request) => request.headers.Authorization)).toEqual([
      "Bearer opaque-first-session-token-123456",
      "Bearer opaque-second-session-token-123456",
    ]);
  });

  it("fails closed after logout and clears the session on a 401", async () => {
    let currentSession: ReturnType<typeof authenticated> | { kind: "signed-out" } = authenticated(
      "opaque-current-session-token-123456",
    );
    const clearOnUnauthorized = vi.fn(() => {
      currentSession = { kind: "signed-out" };
    });
    const transport = vi.fn(async () => response({ code: "AUTH_REQUIRED" }, 401));
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => currentSession,
      onUnauthorized: clearOnUnauthorized,
      transport,
    });

    await expect(client.getSession("conversation-a")).rejects.toEqual(
      new ConversationApiError(401, "AUTH_REQUIRED", false),
    );
    expect(clearOnUnauthorized).toHaveBeenCalledOnce();
    await expect(client.getSession("conversation-a")).rejects.toEqual(
      new ConversationApiError(0, "CONVERSATION_API_UNAVAILABLE", false),
    );
    expect(transport).toHaveBeenCalledOnce();
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
      authProvider: () => authenticated("opaque-test-token-1234567890"),
      transport: async () => response(failed, 503),
    });

    await expect(client.sendText("conversation-a", { requestId: "request-a", text: "保留" }))
      .resolves.toEqual(failed);
  });

  it("creates a fresh session after a missing persisted session", async () => {
    const requests: ConversationHttpRequest[] = [];
    const client = createConversationApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => authenticated("opaque-test-token-1234567890"),
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
