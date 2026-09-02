import Fastify from "fastify";
import type { PptWorkspaceSnapshot } from "@selfalone/contracts";
import { describe, expect, it } from "vitest";
import {
  registerPptWorkspaceRoutes,
  type PptWorkspaceRouteRuntime,
} from "./ppt-workspace-routes";
import { PptWorkspaceStoreError } from "./ppt-workspace-store";

const workspace: PptWorkspaceSnapshot = {
  draft: {
    id: "draft-a",
    conversationId: "conversation-a",
    stage: "requirements",
    version: 1,
    requirements: {
      purpose: null,
      audience: null,
      pageRange: null,
      additionalRequirements: "",
    },
  },
  sources: [{
    bookId: "book-a",
    title: "第一本书",
    author: "甲作者",
    sourceLabel: "本地",
  }],
};

describe("PPT workspace routes", () => {
  it("creates, reads, saves requirements, and replaces the source for the authenticated account", async () => {
    const app = Fastify({ logger: false });
    const calls: unknown[] = [];
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent(input) {
        calls.push(["create", input]);
        return {
          status: input.requestId === "request-reused" ? "reused" : "created",
          workspace,
        };
      },
      async getWorkspace(accountId, draftId) {
        calls.push(["get", accountId, draftId]);
        return workspace;
      },
      async saveRequirements(input) {
        calls.push(["requirements", input]);
        return {
          ...workspace,
          draft: { ...workspace.draft, version: 2, requirements: input.requirements },
        };
      },
      async replaceSource(input) {
        calls.push(["source", input]);
        return workspace;
      },
    };
    await registerPptWorkspaceRoutes(app, runtime, () => "account-a");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/ppt-drafts",
      payload: { requestId: "request-a", bookId: "book-a" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ status: "created", workspace });

    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/ppt-drafts",
      payload: { requestId: "request-reused", bookId: "book-a" },
    });
    expect(reused.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/ppt-drafts/draft-a/workspace",
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ workspace });

    const required = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 1,
        purpose: " 读书会分享 ",
        audience: " 产品团队 ",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: " 保留普通人的选择 ",
      },
    });
    expect(required.statusCode).toBe(200);
    expect(required.json()).toMatchObject({ workspace: { draft: { version: 2 } } });

    const sourced = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/source",
      payload: { expectedVersion: 2, bookId: "book-b" },
    });
    expect(sourced.statusCode).toBe(200);
    expect(sourced.json()).toEqual({ workspace });

    expect(calls).toEqual([
      ["create", {
        accountId: "account-a",
        conversationId: "conversation-a",
        requestId: "request-a",
        bookId: "book-a",
      }],
      ["create", {
        accountId: "account-a",
        conversationId: "conversation-a",
        requestId: "request-reused",
        bookId: "book-a",
      }],
      ["get", "account-a", "draft-a"],
      ["requirements", {
        accountId: "account-a",
        draftId: "draft-a",
        expectedVersion: 1,
        requirements: {
          purpose: "读书会分享",
          audience: "产品团队",
          pageRange: { min: 8, max: 10 },
          additionalRequirements: "保留普通人的选择",
        },
      }],
      ["source", {
        accountId: "account-a",
        draftId: "draft-a",
        expectedVersion: 2,
        bookId: "book-b",
      }],
    ]);
    await app.close();
  });

  it("rejects malformed or extra fields without calling the runtime", async () => {
    const app = Fastify({ logger: false });
    let calls = 0;
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        calls += 1;
        return { status: "created", workspace };
      },
      async getWorkspace() {
        calls += 1;
        return workspace;
      },
      async saveRequirements() {
        calls += 1;
        return workspace;
      },
      async replaceSource() {
        calls += 1;
        return workspace;
      },
    };
    await registerPptWorkspaceRoutes(app, runtime, () => "account-a");

    const reversed = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 1,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 10, max: 8 },
        additionalRequirements: "",
      },
    });
    const overflowingPageRange = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 1,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 2_147_483_648 },
        additionalRequirements: "",
      },
    });
    const unsafe = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/source",
      payload: { expectedVersion: Number.MAX_SAFE_INTEGER + 1, bookId: "book-b" },
    });
    const extra = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/ppt-drafts",
      payload: { requestId: "request-a", bookId: "book-a", stage: "outline" },
    });

    expect([
      reversed.statusCode,
      overflowingPageRange.statusCode,
      unsafe.statusCode,
      extra.statusCode,
    ]).toEqual([400, 400, 400, 400]);
    expect(calls).toBe(0);
    await app.close();
  });

  it.each([
    ["PPT_WORKSPACE_NOT_FOUND", 404],
    ["PPT_WORKSPACE_STALE", 409],
    ["PPT_INTENT_CONFLICT", 409],
    ["PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION", 409],
    ["PPT_INTENT_NOT_SENT", 422],
  ] as const)("maps %s to HTTP %s without exposing internals", async (code, expectedStatus) => {
    const app = Fastify({ logger: false });
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        throw new PptWorkspaceStoreError(code);
      },
      async getWorkspace() {
        return null;
      },
      async saveRequirements() {
        return workspace;
      },
      async replaceSource() {
        return workspace;
      },
    };
    await registerPptWorkspaceRoutes(app, runtime, () => "account-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-a/ppt-drafts",
      payload: { requestId: "request-a", bookId: "book-a" },
    });
    expect(response.statusCode).toBe(expectedStatus);
    expect(response.json()).toEqual({ code });
    await app.close();
  });
});
