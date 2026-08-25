import { describe, expect, it } from "vitest";
import { renderConversationChatDirectory, renderConversationChatQuota } from "./conversation-chat-directory";

const session = {
  id: "conversation-a",
  revision: 1,
  draft: null,
  context: [{ id: "message-a", role: "user" as const, text: "讨论长安的故事" }],
  activeRun: null,
  tasks: [],
  works: [],
  deleted: false,
};

describe("conversation chat directory", () => {
  it("renders real new/search controls and an uncarded recent conversation list", () => {
    const html = renderConversationChatDirectory([session], "conversation-a");

    expect(html).toContain('id="new-conversation"');
    expect(html).toContain('id="conversation-search"');
    expect(html).toContain('id="conversation-search-input"');
    expect(html).toContain('data-conversation-id="conversation-a"');
    expect(html).toContain("讨论长安的故事");
    expect(html).not.toContain("暂不可用");
  });

  it("keeps the one-line free quota bar hidden after claim and recoverable on failure", () => {
    expect(renderConversationChatQuota({ status: "unclaimed" }, { phase: "unclaimed" }))
      .toContain("免费体验额度");
    expect(renderConversationChatQuota({ status: "claimed" }, { phase: "claimed" })).toBe("");
    expect(renderConversationChatQuota({ status: "unclaimed" }, {
      phase: "error",
      error: "领取失败，请稍后重试",
    })).toContain("领取失败，请稍后重试");
  });
});
