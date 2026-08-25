import { icons } from "./icons";

export type DesktopSection = "conversation" | "library" | "settings";

export type DesktopConversation = {
  id: string;
  title: string;
  meta: string;
  active?: boolean;
};

export type DesktopAppShellOptions = {
  activeSection: DesktopSection;
  conversationHref?: string;
  currentConversation: { title: string; meta: string };
  conversationList: DesktopConversation[];
  mainContent: string;
  taskPanel?: string;
  connectionError?: string;
};

export type DesktopRailOptions = {
  activeSection: DesktopSection;
  conversationHref?: string;
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const navItems: Array<
  | { id: DesktopSection; label: string; href: string; icon: string; available: true }
  | { id: DesktopSection; label: string; icon: string; available: false }
> = [
  { id: "conversation", label: "对话", href: "#/conversation", icon: icons.chat, available: true },
  { id: "library", label: "读书", href: "#/library", icon: icons.book, available: true },
  { id: "settings", label: "设置", href: "#/settings", icon: icons.settings, available: true },
];

export function renderDesktopRail(options: DesktopRailOptions) {
  const conversationHref = options.conversationHref ?? "#/conversation";
  return `
    <aside class="desktop-rail" aria-label="主导航">
      <a class="desktop-brand" href="${conversationHref}" aria-label="老己，对话首页">
        <img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="" />
        <span>老己</span>
      </a>
      <nav class="desktop-primary-nav" aria-label="一级导航">
        ${navItems.map((item) => item.available
          ? `
          <a class="desktop-nav-link ${options.activeSection === item.id ? "active" : ""}" href="${item.id === "conversation" ? conversationHref : item.href}" aria-label="${item.label}"${options.activeSection === item.id ? ' aria-current="page"' : ""}>
            ${item.icon}<span>${item.label}</span>
          </a>`
          : `
          <span class="desktop-nav-link desktop-nav-link-disabled" role="button" tabindex="0" aria-disabled="true" aria-label="${item.label}（暂不可用）" title="${item.label}暂不可用">
            ${item.icon}<span>${item.label}</span>
          </span>`).join("")}
      </nav>
      <div class="desktop-rail-scenery" aria-hidden="true"></div>
    </aside>`;
}

function renderConversationList(
  conversations: DesktopConversation[],
  currentConversation: DesktopAppShellOptions["currentConversation"],
  conversationHref: string,
) {
  const items = conversations.length
    ? conversations.map((conversation) => `
        <a class="desktop-conversation-item ${conversation.active ? "active" : ""}" href="${conversationHref}"${conversation.active ? ' aria-current="page"' : ""}>
          <span class="desktop-conversation-item-icon">${icons.chat}</span>
          <span class="desktop-conversation-item-copy">
            <strong>${escapeHtml(conversation.title)}</strong>
            <small>${escapeHtml(conversation.meta)}</small>
          </span>
        </a>`).join("")
    : `<p class="desktop-list-empty">正在恢复最近对话…</p>`;

  return `
    <aside class="desktop-conversation-list" aria-label="最近对话">
      <div class="desktop-list-actions">
        <button class="desktop-new-conversation desktop-disabled-control" type="button" disabled aria-label="新建对话（暂不可用）" title="新建对话暂不可用">${icons.chat}<span>新建对话 · 暂不可用</span></button>
        <button class="desktop-list-toggle" type="button" disabled aria-label="打开会话列表（暂不可用）" title="会话列表暂不可用">${icons.file}</button>
      </div>
      <label class="desktop-conversation-search desktop-conversation-search-disabled">
        ${icons.search}
        <span class="visually-hidden">搜索对话</span>
        <input type="search" placeholder="搜索对话 · 暂不可用" autocomplete="off" disabled aria-label="搜索对话（暂不可用）" />
      </label>
      <h2>最近对话</h2>
      <nav class="desktop-conversation-items" aria-label="会话列表">
        ${items}
      </nav>
      ${conversations.length === 0 ? `<p class="desktop-current-conversation" hidden>${escapeHtml(currentConversation.title)}</p>` : ""}
    </aside>`;
}

function renderHeader(currentConversation: DesktopAppShellOptions["currentConversation"]) {
  return `
      <header class="desktop-conversation-header">
      <div class="desktop-current-title">
        <h1>${escapeHtml(currentConversation.title)}</h1>
        <span>${escapeHtml(currentConversation.meta)}</span>
      </div>
      <span class="desktop-mode-label">本地演示 · 不调用 AI</span>
      </header>`;
}

function renderConnectionError(error: string) {
  return `
    <div class="desktop-connection-banner" role="alert">
      <span>${escapeHtml(error)}</span>
      <small>不会清空当前输入或已完成页面</small>
      <button id="reconnect-workspace" class="desktop-reconnect" type="button">重新连接</button>
    </div>`;
}

export function renderDesktopAppShell(options: DesktopAppShellOptions) {
  const conversationHref = options.conversationHref ?? "#/conversation";
  return `
    <div class="desktop-app-shell" data-active-section="${options.activeSection}">
      ${renderDesktopRail({ activeSection: options.activeSection, conversationHref })}
      ${renderConversationList(options.conversationList, options.currentConversation, conversationHref)}
      <main class="desktop-conversation-main">
        ${renderHeader(options.currentConversation)}
        <div class="desktop-conversation-scroll">
          ${options.connectionError ? renderConnectionError(options.connectionError) : ""}
          ${options.mainContent}
        </div>
      </main>
      ${options.taskPanel ? `<aside class="desktop-task-panel" aria-label="当前任务工作区">${options.taskPanel}</aside>` : ""}
    </div>`;
}
