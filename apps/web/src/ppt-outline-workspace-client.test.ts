import { describe, expect, it } from "vitest";
import { createPptOutlineWorkspaceClient, PptOutlineClientError } from "./ppt-outline-workspace-client";

const outline = {
  version: 3,
  pageCount: 2,
  paragraphs: [
    { id: "page-1", level: 1, text: "第一页" },
    { id: "point-1", level: 2, text: "要点" },
    { id: "detail-1", level: 3, text: "说明" },
    { id: "page-2", level: 1, text: "第二页" },
  ],
  publicSources: [
    {
      url: "https://publisher.example.invalid/catalog/book",
      title: "出版社公开目录",
      publishedAt: "2024-01-01T00:00:00.000Z",
      fetchedAt: "2026-09-06T00:00:00.000Z",
      usageScope: "outline:draft-1",
    },
  ],
};

describe("PPT outline workspace client", () => {
  it("generates the outline through the frozen POST with the requirements expectedVersion", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    const client = createPptOutlineWorkspaceClient({
      headers: { "x-selfalone-account": "account-a" },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ outline }), { status: 200 });
      },
    });

    await expect(client.generateOutline("draft/1", { expectedVersion: 2 })).resolves.toEqual(outline);
    expect(requests).toEqual([{
      url: "/api/v1/ppt-drafts/draft%2F1/outline/generate",
      method: "POST",
      headers: requests[0].headers,
      body: { expectedVersion: 2 },
    }]);
    expect(requests[0].headers.get("x-selfalone-account")).toBe("account-a");
  });

  it("recovers the account-scoped outline through GET and maps 404 to no outline", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers }> = [];
    const client = createPptOutlineWorkspaceClient({
      headers: { "x-selfalone-account": "account-a" },
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
        if (requests.length === 1) return new Response(JSON.stringify({ outline }), { status: 200 });
        return new Response(JSON.stringify({ code: "PPT_WORKSPACE_NOT_FOUND" }), { status: 404 });
      },
    });

    await expect(client.getOutline("draft-1")).resolves.toEqual(outline);
    await expect(client.getOutline("draft-1")).resolves.toBeNull();
    expect(requests[0].url).toBe("/api/v1/ppt-drafts/draft-1/outline");
    expect(requests[0].method).toBe("GET");
    expect(requests[0].headers.get("x-selfalone-account")).toBe("account-a");
  });

  it("saves paragraphs through the frozen PUT and adopts the returned version", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createPptOutlineWorkspaceClient({
      headers: { "x-selfalone-account": "account-a" },
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ outline: { ...outline, version: 4 } }), { status: 200 });
      },
    });

    const paragraphs = [
      { id: "page-1", level: 1 as const, text: "第一页" },
      { id: "point-1", level: 2 as const, text: "要点" },
    ];
    const saved = await client.saveOutline("draft-1", { expectedVersion: 3, paragraphs });
    expect(saved.version).toBe(4);
    expect(requests).toEqual([{
      url: "/api/v1/ppt-drafts/draft-1/outline",
      method: "PUT",
      body: { expectedVersion: 3, paragraphs },
    }]);
  });

  it("preserves stale, orphan, and adapter failures as typed client errors", async () => {
    const stale = createPptOutlineWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_WORKSPACE_STALE" }), { status: 409 }),
    });
    await expect(stale.saveOutline("draft-1", { expectedVersion: 3, paragraphs: [] }))
      .rejects.toEqual(new PptOutlineClientError(409, "PPT_WORKSPACE_STALE"));

    const orphan = createPptOutlineWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_OUTLINE_ORPHAN_CHILD" }), { status: 400 }),
    });
    await expect(orphan.saveOutline("draft-1", {
      expectedVersion: 3,
      paragraphs: [{ id: "point-1", level: 2, text: "孤儿要点" }],
    })).rejects.toEqual(new PptOutlineClientError(400, "PPT_OUTLINE_ORPHAN_CHILD"));

    const unconfigured = createPptOutlineWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED" }), { status: 503 }),
    });
    await expect(unconfigured.generateOutline("draft-1", { expectedVersion: 2 }))
      .rejects.toEqual(new PptOutlineClientError(503, "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED"));
  });

  it("rejects malformed successful payloads and non-JSON failures as typed safe errors", async () => {
    const malformed = createPptOutlineWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ outline: { version: "3" } }), { status: 200 }),
    });
    await expect(malformed.getOutline("draft-1"))
      .rejects.toEqual(new PptOutlineClientError(200, "PPT_OUTLINE_RESPONSE_INVALID"));

    const gatewayDown = createPptOutlineWorkspaceClient({
      fetch: async () => new Response("gateway down", { status: 502 }),
    });
    await expect(gatewayDown.getOutline("draft-1"))
      .rejects.toEqual(new PptOutlineClientError(502, "PPT_OUTLINE_REQUEST_FAILED"));
  });

  it("keeps a non-404 GET failure a typed error instead of an empty outline", async () => {
    const client = createPptOutlineWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "ACCOUNT_REQUIRED" }), { status: 401 }),
    });
    await expect(client.getOutline("draft-1"))
      .rejects.toEqual(new PptOutlineClientError(401, "ACCOUNT_REQUIRED"));
  });
});
