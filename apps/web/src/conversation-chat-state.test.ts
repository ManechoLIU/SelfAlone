import { describe, expect, it } from "vitest";
import {
  applyConversationSendResult,
  applyConversationSnapshot,
  beginConversationSend,
  createConversationChatState,
  updateConversationDraft,
} from "./conversation-chat-state";

describe("conversation chat state", () => {
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
});
