import type { TrialQuotaStatus } from "@selfalone/contracts";
import type { ConversationChatSession } from "./conversation-chat-state";
import { escapeHtml } from "./ui/desktop-shell";
import { icons } from "./ui/icons";

export type ConversationChatQuotaViewState =
  | { phase: "loading" | "claimed" }
  | { phase: "unclaimed" | "claiming" | "error"; error?: string };

export type ConversationChatDirectoryViewState = {
  loading?: boolean;
  error?: string;
};

export function renderConversationChatDirectory(
  sessions: readonly ConversationChatSession[],
  activeId: string | null,
  query = "",
  viewState: ConversationChatDirectoryViewState = {},
) {
  const items = sessions.length
    ? sessions.map((session) => {
        const active = session.id === activeId;
        return `<a class="desktop-conversation-item ${active ? "active" : ""}" href="#/conversation" data-conversation-id="${escapeHtml(session.id)}"${active ? ' aria-current="page"' : ""}>
          <span class="desktop-conversation-item-icon">${icons.chat}</span>
          <span class="desktop-conversation-item-copy"><strong>${escapeHtml(conversationTitle(session))}</strong><small>${active ? "当前会话" : "最近对话"}</small></span>
        </a>`;
      }).join("")
    : `<p class="desktop-list-empty" role="${viewState.error ? "alert" : "status"}">${viewState.loading ? "正在搜索对话…" : viewState.error ? escapeHtml(viewState.error) : query.trim() ? "没有找到匹配的对话" : "还没有对话"}</p>`;

  return `<aside class="desktop-conversation-list" aria-label="最近对话">
    <div class="desktop-list-actions">
      <button id="new-conversation" class="desktop-new-conversation" type="button" aria-label="新建对话">${icons.chat}<span>新建对话</span></button>
    </div>
    <form id="conversation-search" class="desktop-conversation-search" role="search">
      ${icons.search}
      <label class="visually-hidden" for="conversation-search-input">搜索对话</label>
      <input id="conversation-search-input" name="query" type="search" value="${escapeHtml(query)}" placeholder="搜索对话" autocomplete="off" aria-label="搜索对话" />
    </form>
    <h2>最近对话</h2>
    <nav class="desktop-conversation-items" aria-label="会话列表">${items}</nav>
  </aside>`;
}

export function renderConversationChatQuota(
  status: TrialQuotaStatus | null,
  viewState: ConversationChatQuotaViewState,
) {
  if (viewState.phase === "loading" || viewState.phase === "claimed" || status?.status === "claimed") {
    return "";
  }

  const isClaiming = viewState.phase === "claiming";
  const error = viewState.phase === "error" ? viewState.error ?? "领取失败，请稍后重试" : "";
  return `<aside class="conversation-chat-trial" data-conversation-trial role="status" aria-live="polite">
    <span class="conversation-chat-trial-icon">${icons.gift}</span>
    <strong>免费体验额度</strong>
    <button id="claim-trial-quota" class="conversation-chat-trial-action" type="button"${isClaiming ? " disabled" : ""}>${isClaiming ? "领取中…" : "领取"}</button>
    ${error ? `<span class="conversation-chat-trial-error" role="alert">${escapeHtml(error)}</span>` : ""}
  </aside>`;
}

export function conversationTitle(session: ConversationChatSession) {
  const firstUserMessage = session.context.find((entry) => entry.role === "user")?.text.trim();
  if (firstUserMessage) return firstUserMessage.length > 34
    ? `${firstUserMessage.slice(0, 34)}…`
    : firstUserMessage;
  return "新对话";
}
