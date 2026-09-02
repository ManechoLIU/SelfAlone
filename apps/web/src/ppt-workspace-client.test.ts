import { describe, expect, it } from "vitest";
import { createPptWorkspaceClient, PptWorkspaceClientError } from "./ppt-workspace-client";

const workspace = {
  draft: {
    id: "draft-1",
    conversationId: "conversation-1",
    stage: "requirements",
    version: 1,
    requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" },
  },
  sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
};

describe("PPT workspace client", () => {
  it("creates or reuses the workspace only through the sent-intent endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createPptWorkspaceClient({
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ status: "created", workspace }), { status: 201 });
      },
    });

    await expect(client.createOrReuse("conversation/1", { requestId: "request-1", bookId: "book/1" })).resolves.toMatchObject({
      status: "created",
    });
    expect(requests).toEqual([{
      url: "/api/v1/conversations/conversation%2F1/ppt-drafts",
      method: "POST",
      body: { requestId: "request-1", bookId: "book/1" },
    }]);
  });

  it("preserves a server failure as a typed client error", async () => {
    const client = createPptWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_INTENT_NOT_SENT" }), { status: 409 }),
    });
    await expect(client.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(409, "PPT_INTENT_NOT_SENT"));
  });

  it("maps HTTP 200 to reuse even if a stale body claims creation", async () => {
    const client = createPptWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ status: "created", workspace }), { status: 200 }),
    });
    await expect(client.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .resolves.toMatchObject({ status: "reused", workspace });
  });

  it("maps HTTP 201 to creation even if a stale body claims reuse", async () => {
    const client = createPptWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ status: "reused", workspace }), { status: 201 }),
    });
    await expect(client.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .resolves.toMatchObject({ status: "created", workspace });
  });

  it("uses a typed safe error for a non-JSON server failure", async () => {
    const client = createPptWorkspaceClient({ fetch: async () => new Response("gateway down", { status: 502 }) });
    await expect(client.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(502, "PPT_WORKSPACE_REQUEST_FAILED"));
  });

  it("rejects unsupported successes and malformed successful payloads as typed errors", async () => {
    const unsupported = createPptWorkspaceClient({ fetch: async () => new Response(null, { status: 204 }) });
    const malformed = createPptWorkspaceClient({ fetch: async () => new Response("not json", { status: 201 }) });
    const missingWorkspace = createPptWorkspaceClient({ fetch: async () => new Response(JSON.stringify({ status: "created" }), { status: 201 }) });

    await expect(unsupported.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(204, "PPT_WORKSPACE_RESPONSE_INVALID"));
    await expect(malformed.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(201, "PPT_WORKSPACE_RESPONSE_INVALID"));
    await expect(missingWorkspace.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(201, "PPT_WORKSPACE_RESPONSE_INVALID"));
  });
});
