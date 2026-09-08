import Fastify from "fastify";
import type { PptWorkspaceSnapshot } from "@selfalone/contracts";
import { describe, expect, it } from "vitest";
import { resolveAccountOwner } from "./account-owner";
import { PptOutlineRuntimeError } from "./ppt-outline-runtime";
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

  it("maps ACCOUNT_REQUIRED and ACCOUNT_FORBIDDEN instead of collapsing them to 500", async () => {
    let runtimeCalls = 0;
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        runtimeCalls += 1;
        return { status: "created", workspace };
      },
      async getWorkspace() {
        runtimeCalls += 1;
        return workspace;
      },
      async saveRequirements() {
        runtimeCalls += 1;
        return workspace;
      },
      async replaceSource() {
        runtimeCalls += 1;
        return workspace;
      },
    };

    const missingApp = Fastify({ logger: false });
    await registerPptWorkspaceRoutes(missingApp, runtime, () => {
      throw new Error("ACCOUNT_REQUIRED");
    });
    const missing = await missingApp.inject({
      method: "GET",
      url: "/api/v1/ppt-drafts/draft-a/workspace",
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ code: "ACCOUNT_REQUIRED" });
    await missingApp.close();

    const forbiddenApp = Fastify({ logger: false });
    await registerPptWorkspaceRoutes(forbiddenApp, runtime, () => {
      throw new Error("ACCOUNT_FORBIDDEN");
    });
    const forbidden = await forbiddenApp.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 1,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: "ACCOUNT_FORBIDDEN" });
    expect(runtimeCalls).toBe(0);
    await forbiddenApp.close();
  });

  it("rejects incrementable versions at PostgreSQL int max while allowing that page count", async () => {
    const app = Fastify({ logger: false });
    const calls: unknown[] = [];
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        return { status: "created", workspace };
      },
      async getWorkspace() {
        return workspace;
      },
      async saveRequirements(input) {
        calls.push(["requirements", input.expectedVersion, input.requirements.pageRange]);
        return workspace;
      },
      async replaceSource(input) {
        calls.push(["source", input.expectedVersion]);
        if (input.expectedVersion === 2_147_483_647) {
          throw new PptWorkspaceStoreError("PPT_WORKSPACE_STALE");
        }
        return workspace;
      },
    };
    await registerPptWorkspaceRoutes(app, runtime, () => "account-a");

    const overflowingVersion = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 2_147_483_647,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    });
    const overflowingSourceVersion = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/source",
      payload: { expectedVersion: 2_147_483_647, bookId: "book-b" },
    });
    const maxPageCount = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 1,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 1, max: 2_147_483_647 },
        additionalRequirements: "",
      },
    });
    const maxIncrementableVersion = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/requirements",
      payload: {
        expectedVersion: 2_147_483_646,
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    });

    expect(overflowingVersion.statusCode).toBe(400);
    expect(overflowingSourceVersion.statusCode).toBe(409);
    expect(maxPageCount.statusCode).toBe(200);
    expect(maxIncrementableVersion.statusCode).toBe(200);
    expect(calls).toEqual([
      ["source", 2_147_483_647],
      ["requirements", 1, { min: 1, max: 2_147_483_647 }],
      ["requirements", 2_147_483_646, { min: 8, max: 10 }],
    ]);
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

  it("reads, writes, and generates outline only for the authenticated account", async () => {
    const outline = {
      version: 3,
      pageCount: 2,
      paragraphs: [
        { id: "page-1", level: 1 as const, text: "第一章" },
        { id: "page-2", level: 1 as const, text: "第二章" },
      ],
      publicSources: [{
        url: "https://publisher.example.invalid/catalog/book",
        title: "出版社公开目录",
        publishedAt: "2024-01-01T00:00:00.000Z",
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline:draft-a",
      }],
    };
    const calls: unknown[] = [];
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        return { status: "created", workspace };
      },
      async getWorkspace() {
        return workspace;
      },
      async saveRequirements() {
        return workspace;
      },
      async replaceSource() {
        return workspace;
      },
      async getOutline(accountId, draftId) {
        calls.push(["getOutline", accountId, draftId]);
        if (accountId !== "account-a") return null;
        return outline;
      },
      async saveOutline(input) {
        calls.push(["saveOutline", input]);
        if (input.accountId !== "account-a") {
          throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
        }
        return outline;
      },
      async generateOutline(input) {
        calls.push(["generateOutline", input]);
        if (input.accountId !== "account-a") {
          throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
        }
        return outline;
      },
    };
    const app = Fastify({ logger: false });
    await registerPptWorkspaceRoutes(app, runtime, resolveAccountOwner);

    const ownedRead = await app.inject({
      method: "GET",
      url: "/api/v1/ppt-drafts/draft-a/outline",
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(ownedRead.statusCode).toBe(200);
    expect(ownedRead.json()).toEqual({ outline });

    const foreignRead = await app.inject({
      method: "GET",
      url: "/api/v1/ppt-drafts/draft-a/outline",
      headers: { "x-selfalone-account": "account-b" },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json()).toEqual({ code: "PPT_WORKSPACE_NOT_FOUND" });

    const ownedWrite = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/outline",
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        expectedVersion: 2,
        paragraphs: outline.paragraphs,
      },
    });
    expect(ownedWrite.statusCode).toBe(200);

    const foreignWrite = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/outline",
      headers: { "x-selfalone-account": "account-b" },
      payload: {
        expectedVersion: 2,
        paragraphs: outline.paragraphs,
      },
    });
    expect(foreignWrite.statusCode).toBe(404);

    const generated = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-drafts/draft-a/outline/generate",
      headers: { "x-selfalone-account": "account-a" },
      payload: { expectedVersion: 2 },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toEqual({ outline });

    expect(calls).toEqual([
      ["getOutline", "account-a", "draft-a"],
      ["getOutline", "account-b", "draft-a"],
      ["saveOutline", {
        accountId: "account-a",
        draftId: "draft-a",
        expectedVersion: 2,
        paragraphs: outline.paragraphs,
      }],
      ["saveOutline", {
        accountId: "account-b",
        draftId: "draft-a",
        expectedVersion: 2,
        paragraphs: outline.paragraphs,
      }],
      ["generateOutline", {
        accountId: "account-a",
        draftId: "draft-a",
        expectedVersion: 2,
      }],
    ]);
    await app.close();
  });

  it("maps outline runtime domain errors instead of leaking 500s", async () => {
    const runtime: PptWorkspaceRouteRuntime = {
      async createFromSentIntent() {
        return { status: "created", workspace };
      },
      async getWorkspace() {
        return workspace;
      },
      async saveRequirements() {
        return workspace;
      },
      async replaceSource() {
        return workspace;
      },
      async saveOutline() {
        throw new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD");
      },
      async generateOutline() {
        throw new PptOutlineRuntimeError("PPT_OUTLINE_ADAPTER_NOT_CONFIGURED");
      },
    };
    const app = Fastify({ logger: false });
    await registerPptWorkspaceRoutes(app, runtime, () => "account-a");

    const orphan = await app.inject({
      method: "PUT",
      url: "/api/v1/ppt-drafts/draft-a/outline",
      payload: {
        expectedVersion: 2,
        paragraphs: [{ id: "point-orphan", level: 2, text: "没有页面的要点" }],
      },
    });
    expect(orphan.statusCode).toBe(400);
    expect(orphan.json()).toEqual({ code: "PPT_OUTLINE_ORPHAN_CHILD" });

    const missingAdapter = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-drafts/draft-a/outline/generate",
      payload: { expectedVersion: 2 },
    });
    expect(missingAdapter.statusCode).toBe(503);
    expect(missingAdapter.json()).toEqual({ code: "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED" });
    await app.close();
  });

});
