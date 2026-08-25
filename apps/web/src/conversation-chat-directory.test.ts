import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderConversationChatDirectory,
  renderConversationChatQuota,
  type ConversationChatQuotaViewState,
} from "./conversation-chat-directory";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

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
    expect(renderConversationChatQuota({ status: "claimed" }, { phase: "success" } as ConversationChatQuotaViewState))
      .toContain("已领取");
    expect(renderConversationChatQuota({ status: "claimed" }, { phase: "claimed" })).toBe("");
    expect(renderConversationChatQuota({ status: "unclaimed" }, {
      phase: "error",
      error: "领取失败，请稍后重试",
    })).toContain("领取失败，请稍后重试");
  });

  it("offers an in-place retry when the current directory action fails", () => {
    const html = renderConversationChatDirectory([session], "conversation-a", "长安", {
      loading: false,
      error: "最近对话暂时无法打开，请重试",
      retry: true,
    });

    expect(html).toContain("最近对话暂时无法打开，请重试");
    expect(html).toContain('data-conversation-directory-retry="true"');
    expect(html).toContain("重试");
  });

  it("keeps the current chat mounted while create/open failures stay in the directory", () => {
    expect(mainSource).toContain("renderConversationChatDirectoryActionError");
    expect(mainSource).toContain("conversationChatDirectoryRetry");
    expect(mainSource).toContain('renderConversationChatDirectoryActionError("新建对话失败，请重试"');
    expect(mainSource).toContain('renderConversationChatDirectoryActionError("打开对话失败，请重试"');
    expect(mainSource).not.toContain("${message}");
  });

  it("lets a real filtered-empty response replace the directory list", () => {
    expect(mainSource).toContain("const sessions = conversationChatSessions;\n  return renderConversationChatDirectory(");
  });

  it("keeps a measurable brief success state before dismissing a claimed quota", () => {
    expect(mainSource).toContain("conversationChatQuotaDismissTimer");
    expect(mainSource).toContain('conversationChatQuotaViewState = { phase: "success" }');
  });
});
