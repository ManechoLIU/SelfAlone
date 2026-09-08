import { describe, expect, it, vi } from "vitest";
import { ClientBoundaryError, type PptOutlineParagraph } from "./client";
import type { LibraryHttpTransport } from "./library-http";
import { createPptWorkspaceHttpClient } from "./ppt-workspace-http";

const session = {
  kind: "authenticated" as const,
  token: "ppt-workspace-token-1234567890",
  expiresAt: Date.now() + 60_000,
};

function transport(request: LibraryHttpTransport["request"]): LibraryHttpTransport {
  return { request, readFile: vi.fn(async () => new Uint8Array([1]).buffer) };
}

function clientWith(request: LibraryHttpTransport["request"]) {
  return createPptWorkspaceHttpClient({
    baseUrl: "https://api.example.test/",
    authProvider: () => session,
    transport: transport(request),
  });
}

const workspacePayload = {
  draft: {
    id: "draft-1",
    conversationId: "conv-1",
    stage: "requirements",
    version: 1,
    requirements: {
      purpose: null,
      audience: null,
      pageRange: null,
      additionalRequirements: "",
    },
  },
  sources: [{ bookId: "book-1", title: "山窗读书札记", author: "林野", sourceLabel: "本地" }],
};

const outlinePayload: { version: number; pageCount: number; paragraphs: PptOutlineParagraph[]; publicSources: never[] } = {
  version: 3,
  pageCount: 2,
  paragraphs: [
    { id: "node-1", level: 1, text: "苦难中活着的意义" },
    { id: "node-2", level: 2, text: "余华与《活着》简介" },
    { id: "node-3", level: 3, text: "时代背景与作品的核心主题" },
    { id: "node-4", level: 1, text: "现实启示与行动召唤" },
  ],
  publicSources: [],
};

describe("PPT workspace HTTP client", () => {
  it("creates a draft from a sent intent and parses the 201 workspace snapshot", async () => {
    const request = vi.fn(async () => ({
      status: 201,
      data: { status: "created", workspace: workspacePayload },
    }));
    const client = clientWith(request);

    const result = await client.createDraft({
      conversationId: "conv-1",
      requestId: "req-1",
      bookId: "book-1",
    });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      url: "https://api.example.test/api/v1/conversations/conv-1/ppt-drafts",
      headers: {
        Authorization: "Bearer ppt-workspace-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: { requestId: "req-1", bookId: "book-1" },
    });
    expect(result.status).toBe("created");
    expect(result.workspace).toEqual(workspacePayload);
  });

  it("treats a 200 response as a reused draft", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: { status: "reused", workspace: workspacePayload },
    }));
    const client = clientWith(request);

    const result = await client.createDraft({
      conversationId: "conv-1",
      requestId: "req-1",
      bookId: "book-1",
    });

    expect(result.status).toBe("reused");
    expect(result.workspace.draft.id).toBe("draft-1");
  });

  it("maps an unsent intent and an intent conflict to stable boundary codes", async () => {
    const unsent = clientWith(vi.fn(async () => ({ status: 422, data: { code: "PPT_INTENT_NOT_SENT" } })));
    await expect(unsent.createDraft({ conversationId: "conv-1", requestId: "req-1", bookId: "book-1" }))
      .rejects.toMatchObject({ code: "PPT_INTENT_NOT_SENT" });

    const conflict = clientWith(vi.fn(async () => ({ status: 409, data: { code: "PPT_INTENT_CONFLICT" } })));
    await expect(conflict.createDraft({ conversationId: "conv-1", requestId: "req-1", bookId: "book-2" }))
      .rejects.toMatchObject({ code: "PPT_INTENT_CONFLICT" });
  });

  it("loads a workspace and reports a missing draft with the frozen code", async () => {
    const found = clientWith(vi.fn(async () => ({ status: 200, data: { workspace: workspacePayload } })));
    await expect(found.getWorkspace("draft-1")).resolves.toEqual(workspacePayload);

    const missing = clientWith(vi.fn(async () => ({ status: 404, data: { code: "PPT_WORKSPACE_NOT_FOUND" } })));
    await expect(missing.getWorkspace("draft-9"))
      .rejects.toMatchObject({ code: "PPT_WORKSPACE_NOT_FOUND" });
  });

  it("saves requirements with the frozen body shape and maps stale versions", async () => {
    const savedPayload = {
      ...workspacePayload,
      draft: {
        ...workspacePayload.draft,
        version: 2,
        requirements: {
          purpose: "读书分享",
          audience: "读书会成员",
          pageRange: { min: 6, max: 8 },
          additionalRequirements: "突出当代启示",
        },
      },
    };
    const request = vi.fn(async () => ({ status: 200, data: { workspace: savedPayload } }));
    const client = clientWith(request);

    const workspace = await client.saveRequirements("draft-1", {
      expectedVersion: 1,
      purpose: "读书分享",
      audience: "读书会成员",
      pageRange: { min: 6, max: 8 },
      additionalRequirements: "突出当代启示",
    });

    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      url: "https://api.example.test/api/v1/ppt-drafts/draft-1/requirements",
      headers: {
        Authorization: "Bearer ppt-workspace-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: {
        expectedVersion: 1,
        purpose: "读书分享",
        audience: "读书会成员",
        pageRange: { min: 6, max: 8 },
        additionalRequirements: "突出当代启示",
      },
    });
    expect(workspace.draft.version).toBe(2);

    const stale = clientWith(vi.fn(async () => ({ status: 409, data: { code: "PPT_WORKSPACE_STALE" } })));
    await expect(stale.saveRequirements("draft-1", {
      expectedVersion: 1,
      purpose: "读书分享",
      audience: "读书会成员",
      pageRange: { min: 6, max: 8 },
      additionalRequirements: "",
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_STALE" });
  });

  it("loads the outline snapshot without depending on public sources", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { outline: outlinePayload } }));
    const client = clientWith(request);

    const outline = await client.getOutline("draft-1");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      url: "https://api.example.test/api/v1/ppt-drafts/draft-1/outline",
      headers: {
        Authorization: "Bearer ppt-workspace-token-1234567890",
        accept: "application/json",
      },
    });
    expect(outline).toEqual({
      version: 3,
      pageCount: 2,
      paragraphs: outlinePayload.paragraphs,
    });
  });

  it("saves outline paragraphs with expectedVersion and maps orphan and stale errors", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { outline: { ...outlinePayload, version: 4 } } }));
    const client = clientWith(request);

    const outline = await client.saveOutline("draft-1", {
      expectedVersion: 3,
      paragraphs: outlinePayload.paragraphs,
    });

    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      url: "https://api.example.test/api/v1/ppt-drafts/draft-1/outline",
      headers: {
        Authorization: "Bearer ppt-workspace-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: { expectedVersion: 3, paragraphs: outlinePayload.paragraphs },
    });
    expect(outline.version).toBe(4);

    const orphan = clientWith(vi.fn(async () => ({ status: 400, data: { code: "PPT_OUTLINE_ORPHAN_CHILD" } })));
    await expect(orphan.saveOutline("draft-1", { expectedVersion: 3, paragraphs: outlinePayload.paragraphs }))
      .rejects.toMatchObject({ code: "PPT_OUTLINE_ORPHAN_CHILD" });

    const stale = clientWith(vi.fn(async () => ({ status: 409, data: { code: "PPT_WORKSPACE_STALE" } })));
    await expect(stale.saveOutline("draft-1", { expectedVersion: 3, paragraphs: outlinePayload.paragraphs }))
      .rejects.toMatchObject({ code: "PPT_WORKSPACE_STALE" });
  });

  it("generates the outline with expectedVersion and maps an unconfigured adapter", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { outline: outlinePayload } }));
    const client = clientWith(request);

    const outline = await client.generateOutline("draft-1", { expectedVersion: 2 });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      url: "https://api.example.test/api/v1/ppt-drafts/draft-1/outline/generate",
      headers: {
        Authorization: "Bearer ppt-workspace-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: { expectedVersion: 2 },
    });
    expect(outline.pageCount).toBe(2);

    const unavailable = clientWith(vi.fn(async () => ({ status: 503, data: { code: "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED" } })));
    await expect(unavailable.generateOutline("draft-1", { expectedVersion: 2 }))
      .rejects.toMatchObject({ code: "PPT_OUTLINE_UNAVAILABLE" });
  });

  it("rejects malformed snapshots instead of guessing", async () => {
    const brokenWorkspace = clientWith(vi.fn(async () => ({
      status: 200,
      data: { workspace: { draft: { id: "draft-1" } } },
    })));
    await expect(brokenWorkspace.getWorkspace("draft-1"))
      .rejects.toMatchObject({ code: "INVALID_PPT_RESPONSE" });

    const brokenOutline = clientWith(vi.fn(async () => ({
      status: 200,
      data: { outline: { version: "3", paragraphs: [] } },
    })));
    await expect(brokenOutline.getOutline("draft-1"))
      .rejects.toMatchObject({ code: "INVALID_PPT_RESPONSE" });
  });

  it("fails closed without an authenticated session", async () => {
    const client = createPptWorkspaceHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => null,
      transport: transport(vi.fn()),
    });

    await expect(client.getOutline("draft-1"))
      .rejects.toSatisfy((error) => error instanceof ClientBoundaryError
        && error.code === "CLIENT_ADAPTER_UNAVAILABLE");
  });
});
