import { describe, expect, it } from "vitest";
import {
  applyConversationSendResult,
  applyConversationSnapshot,
  beginConversationSend,
  canonicalizeConversationStageRoute,
  classifyConversationRoute,
  createConversationChatLoadCoordinator,
  createConversationChatState,
  updateConversationDraft,
} from "./conversation-chat-state";

describe("conversation chat state", () => {
  it("keeps stage and book handoff hashes on the legacy workspace route", () => {
    expect(classifyConversationRoute("#/conversation")).toBe("chat");
    expect(classifyConversationRoute("#/conversation?stage=requirements")).toBe("workspace");
    expect(classifyConversationRoute("#/conversation?stage=outline&book=book-1&bookTitle=书")).toBe("workspace");
  });

  it("canonicalizes a completed stage action without dropping a book handoff", () => {
    expect(canonicalizeConversationStageRoute("#/conversation?stage=requirements", "outline")).toBe("#/conversation?stage=outline");
    expect(canonicalizeConversationStageRoute("#/conversation?stage=requirements&book=book-1&bookTitle=书", "outline")).toBe("#/conversation?stage=outline&book=book-1&bookTitle=%E4%B9%A6");
  });

  it("restarts the current route after an in-flight load settles stale-successfully", () => {
    const coordinator = createConversationChatLoadCoordinator();

    expect(coordinator.request(1)).toBe("start");
    expect(coordinator.request(2)).toBe("pending");
    expect(coordinator.settle(1, "success")).toBe(2);
    expect(coordinator.request(2)).toBe("start");
    expect(coordinator.settle(2, "success")).toBeNull();
  });

  it("restarts the latest returned route after an in-flight load settles stale-failed", () => {
    const coordinator = createConversationChatLoadCoordinator();

    expect(coordinator.request(10)).toBe("start");
    expect(coordinator.request(11)).toBe("pending");
    expect(coordinator.request(12)).toBe("pending");
    expect(coordinator.settle(10, "failure")).toBe(12);
    expect(coordinator.request(12)).toBe("start");
    expect(coordinator.settle(12, "failure")).toBeNull();
  });

  it("retains input across a failed send and restores server history", () => {
    const initial = createConversationChatState("conversation-a");
    const drafted = updateConversationDraft(initial, "这段输入要留下");
    const loading = beginConversationSend(drafted, "request-a");

    expect(loading.status).toBe("sending");
    expect(loading.draft).toBe("这段输入要留下");

    const failed = applyConversationSendResult(loading, {
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "这段输入要留下", attachments: [] },
      session: {
        id: "conversation-a",
        revision: 4,
        draft: { text: "这段输入要留下", attachments: [] },
        context: [{ id: "request-a:user", role: "user", text: "这段输入要留下" }],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      },
    });

    expect(failed.status).toBe("error");
    expect(failed.draft).toBe("这段输入要留下");
    expect(failed.messages).toEqual([
      { id: "request-a:user", role: "user", text: "这段输入要留下" },
    ]);

    const refreshed = applyConversationSnapshot(failed, {
      id: "conversation-a",
      revision: 4,
      draft: { text: "这段输入要留下", attachments: [] },
      context: [{ id: "request-a:user", role: "user", text: "这段输入要留下" }],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });
    expect(refreshed.status).toBe("idle");
    expect(refreshed.draft).toBe("这段输入要留下");
  });

  it("restores the persisted request id with a retained draft", () => {
    const hydrated = applyConversationSnapshot(createConversationChatState("conversation-a"), {
      id: "conversation-a",
      revision: 3,
      draft: { text: "失败后继续", attachments: [] },
      context: [{
        id: "request-retry:user",
        role: "user",
        text: "失败后继续",
        requestId: "request-retry",
      }],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });

    expect(hydrated.retryRequestId).toBe("request-retry");
    expect(hydrated.retryText).toBe("失败后继续");
  });
});
