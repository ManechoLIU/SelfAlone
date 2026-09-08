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

  it("omits the account header in the current default construction and the frozen route contract rejects it with 401 ACCOUNT_REQUIRED", async () => {
    // The frozen route resolves its owner only from x-selfalone-account
    // (apps/server/src/ppt-workspace-routes.ts + account-owner.ts, pinned by
    // apps/server/src/ppt-workspace-routes.test.ts "maps ACCOUNT_REQUIRED …").
    const frozenRouteFetch: typeof globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.get("x-selfalone-account")?.trim()) {
        return new Response(JSON.stringify({ code: "ACCOUNT_REQUIRED" }), { status: 401 });
      }
      return new Response(JSON.stringify({ status: "created", workspace }), { status: 201 });
    };
    const defaultClient = createPptWorkspaceClient({ fetch: frozenRouteFetch });
    await expect(defaultClient.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(401, "ACCOUNT_REQUIRED"));

    const accountScoped = createPptWorkspaceClient({
      fetch: frozenRouteFetch,
      headers: { "x-selfalone-account": "account-a" },
    });
    await expect(accountScoped.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .resolves.toMatchObject({ status: "created" });
  });

  it("saves requirements through the frozen PUT with the current expectedVersion", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    const client = createPptWorkspaceClient({
      headers: { "x-selfalone-account": "account-a" },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({
          workspace: { ...workspace, draft: { ...workspace.draft, version: 2 } },
        }), { status: 200 });
      },
    });

    await expect(client.saveRequirements("draft/1", {
      expectedVersion: 1,
      purpose: "读书分享",
      audience: "同事",
      pageRange: { min: 8, max: 10 },
      additionalRequirements: "简洁",
    })).resolves.toMatchObject({ draft: { id: "draft-1", version: 2 } });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/ppt-drafts/draft%2F1/requirements");
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].headers.get("x-selfalone-account")).toBe("account-a");
    expect(requests[0].body).toEqual({
      expectedVersion: 1,
      purpose: "读书分享",
      audience: "同事",
      pageRange: { min: 8, max: 10 },
      additionalRequirements: "简洁",
    });
  });

  it("preserves a stale requirements save as a typed conflict error", async () => {
    const client = createPptWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_WORKSPACE_STALE" }), { status: 409 }),
    });
    await expect(client.saveRequirements("draft-1", {
      expectedVersion: 1,
      purpose: "读书分享",
      audience: "同事",
      pageRange: { min: 8, max: 10 },
      additionalRequirements: "",
    })).rejects.toEqual(new PptWorkspaceClientError(409, "PPT_WORKSPACE_STALE"));
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
