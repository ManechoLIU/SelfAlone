import type { SettingsOverview, SettingsServiceStatus, SettingsState } from "./settings-state";
import { renderTextModelPage } from "./model-config-page";
import type { WeReadState } from "./weread-state";
import { renderWeReadSettings } from "./weread-view";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const arrowIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m9 5 7 7-7 7" />
  </svg>`;

const mailIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </svg>`;

const lockIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>`;

const textIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 5h14M8 9h8M5 13h14M8 17h8" />
  </svg>`;

const imageIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="9" cy="9" r="1.3" />
    <path d="m6 17 4-4 3 3 2-2 3 3" />
  </svg>`;

const bookIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21V5.5Z" />
    <path d="M5 5.5V21M8 7h7M8 10h6" />
  </svg>`;

function statusLabel(status: SettingsServiceStatus | undefined, fallback: string) {
  return status?.label ?? fallback;
}

function renderRow(
  action: string,
  label: string,
  status: string,
  icon: string,
  description?: string,
) {
  return `<button class="settings-row" data-settings-row data-settings-action="${action}" type="button">
    <span class="settings-row__icon" aria-hidden="true">${icon}</span>
    <span class="settings-row__copy"><strong>${escapeHtml(label)}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ""}</span>
    <span class="settings-row__status">${escapeHtml(status)}</span>
    <span class="settings-row__arrow">${arrowIcon}</span>
  </button>`;
}

function renderOverview(overview: SettingsOverview) {
  const email = overview.loginMethods.email.label ?? overview.account.email;
  const textModel = statusLabel(overview.services?.textModel, "未配置");
  const imageModel = statusLabel(overview.services?.imageModel, "未配置");
  const weread = statusLabel(
    overview.services?.weread,
    overview.loginMethods.wechat.connected ? "已连接" : "未连接",
  );
  return `<div class="settings-overview" data-settings-overview>
    <div class="settings-account-summary">
      <div class="settings-account-summary__copy">
        <span class="settings-eyebrow">账户</span>
        <strong>${escapeHtml(email)}</strong>
        <small>当前登录邮箱</small>
      </div>
      <img class="settings-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="" />
    </div>
    <section class="settings-group" aria-labelledby="settings-account-group">
      <h2 id="settings-account-group">账户</h2>
      ${renderRow("account", "账户与登录方式", email, mailIcon, "修改邮箱、修改密码")}
    </section>
    <section class="settings-group" aria-labelledby="settings-services-group">
      <h2 id="settings-services-group">服务</h2>
      ${renderRow("text-model", "文本模型", textModel, textIcon)}
      ${renderRow("image-model", "图片模型", imageModel, imageIcon)}
      ${renderRow("weread", "微信读书", weread, bookIcon)}
    </section>
    <section class="settings-group settings-group--logout" aria-label="账户操作">
      ${renderRow("logout", "退出登录", "", lockIcon)}
    </section>
  </div>`;
}

function renderAccountDetail(state: SettingsState) {
  const draft = state.draft;
  const error = state.accountError || state.mutation.error;
  const success = state.mutation.phase === "success"
    ? state.mutation.kind === "change-email"
      ? "验证邮件已发送，请完成验证后再使用新邮箱登录。"
      : state.mutation.kind === "change-password"
        ? "密码已更新。"
        : ""
    : "";
  return `<section class="settings-account-detail" data-settings-account aria-labelledby="settings-account-title">
    <button class="settings-back" type="button" data-settings-action="back">返回设置</button>
    <div class="settings-detail-heading">
      <span class="settings-eyebrow">账户与登录方式</span>
      <h2 id="settings-account-title">修改账户信息</h2>
      <p>修改邮箱需要验证新邮箱；修改密码前请先验证当前账户身份。</p>
    </div>
    <form class="settings-account-form" data-settings-account-form novalidate>
      <label class="settings-field" for="settings-email"><span>新邮箱</span><input id="settings-email" name="email" type="email" autocomplete="email" value="${escapeHtml(draft.email)}" /></label>
      <label class="settings-field" for="settings-current-password"><span>当前密码</span><input id="settings-current-password" name="currentPassword" type="password" autocomplete="current-password" value="${escapeHtml(draft.currentPassword)}" /></label>
      <label class="settings-field" for="settings-new-password"><span>新密码</span><input id="settings-new-password" name="newPassword" type="password" autocomplete="new-password" value="${escapeHtml(draft.newPassword)}" /></label>
      <label class="settings-field" for="settings-confirm-password"><span>确认新密码</span><input id="settings-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" value="${escapeHtml(draft.confirmPassword)}" /></label>
      ${error ? `<p class="settings-form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${success && !error ? `<p class="settings-form-success" role="status">${escapeHtml(success)}</p>` : ""}
      <button class="settings-primary" data-settings-primary type="submit"${state.mutation.phase === "submitting" ? " disabled" : ""}>${state.mutation.phase === "submitting" ? "正在验证…" : "保存并验证"}</button>
    </form>
  </section>`;
}

function renderLogoutDialog(state: SettingsState) {
  const error = state.mutation.kind === "logout" ? state.mutation.error : "";
  const submitting = state.mutation.kind === "logout" && state.mutation.phase === "submitting";
  return `<div class="settings-dialog-backdrop" data-settings-dialog-backdrop>
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-logout-title" aria-describedby="settings-logout-description">
      <h2 id="settings-logout-title">确认退出登录</h2>
      <p id="settings-logout-description">退出后需要重新登录才能继续。已保存的书籍和笔记不会被删除。</p>
      ${error ? `<p class="settings-form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      <div class="settings-dialog-actions">
        <button class="settings-secondary" type="button" data-settings-action="logout-cancel">取消</button>
        <button class="settings-danger" type="button" data-settings-action="logout-confirm"${submitting ? " disabled" : ""}>${submitting ? "正在退出…" : "退出登录"}</button>
      </div>
    </section>
  </div>`;
}

export function renderSettingsPage(state: SettingsState, wereadState?: WeReadState) {
  const isLoading = state.phase === "loading";
  if (wereadState?.view === "connection") {
    return `<main class="settings-page" data-settings-page="weread" data-settings-phase="${wereadState.phase}" aria-busy="${wereadState.phase === "loading" || wereadState.phase === "saving" || wereadState.phase === "syncing"}">
      ${renderWeReadSettings(wereadState)}
    </main>`;
  }
  if (state.view === "text-model") {
    return `<main class="settings-page" data-settings-page="text-model" data-settings-phase="${state.phase}" aria-busy="${state.textModel.status === "loading"}">
      ${renderTextModelPage(state.textModel)}
    </main>`;
  }
  const content = state.view === "account"
    ? renderAccountDetail(state)
    : state.overview
      ? renderOverview(state.overview)
      : state.phase === "failed"
        ? `<div class="settings-error-state" role="alert"><p>${escapeHtml(state.error || "暂时无法加载设置，请稍后重试。")}</p><button class="settings-secondary" type="button" data-settings-action="reload">重新加载</button></div>`
        : `<div class="settings-loading" role="status">正在加载设置…</div>`;
  return `<main class="settings-page" data-settings-page="${state.view}" data-settings-phase="${state.phase}" aria-busy="${isLoading}">
    <header class="settings-page__header"><div><span class="settings-eyebrow">老己</span><h1>设置</h1></div></header>
    ${state.error && !(state.phase === "failed" && !state.overview) ? `<p class="settings-page__error" role="alert">${escapeHtml(state.error)}</p>` : ""}
    ${content}
    ${state.logoutConfirmation ? renderLogoutDialog(state) : ""}
  </main>`;
}
