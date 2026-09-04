import { describe, expect, it } from "vitest";
import { createPptRequirementsWorkspaceStore } from "./ppt-requirements-workspace-state";

const workspace = {
  draft: {
    id: "draft-1", conversationId: "conversation-a", stage: "requirements" as const, version: 1,
    requirements: { purpose: "读书分享", audience: "同事", pageRange: { min: 8, max: 12 }, additionalRequirements: "简洁" },
  },
  sources: [{ bookId: "book-1", title: "测试书", author: "作者", sourceLabel: "本地" }] as const,
};

describe("PPT requirements workspace state", () => {
  it("only exposes the panel atomically for its matching legal requirements snapshot", () => {
    const store = createPptRequirementsWorkspaceStore();
    const context = { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" };
    store.begin(context);
    expect(store.getState()).toMatchObject({ phase: "pending" });

    expect(store.ready(context, { status: "created", workspace })).toBe(true);
    expect(store.getState()).toMatchObject({ phase: "ready", workspace });
  });

  it("rejects a snapshot that does not belong to the active conversation and source", () => {
    const store = createPptRequirementsWorkspaceStore();
    const context = { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" };
    const mismatched = {
      ...workspace,
      draft: { ...workspace.draft, conversationId: "conversation-b" },
    };

    expect(store.ready(context, { status: "reused", workspace: mismatched })).toBe(false);
    expect(store.getState()).toMatchObject({ phase: "error", context });
  });

  it("keeps a failed workspace in place for retry with the same request id", () => {
    const store = createPptRequirementsWorkspaceStore();
    const context = { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" };
    store.begin(context);
    store.fail(context, new Error("offline"));

    expect(store.getState()).toMatchObject({ phase: "error", context });
    expect(store.retryContext()).toEqual(context);
  });
});
