import type { AuthMode, AuthState } from "./auth-state";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const wechatIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8.7 5.1c-3.3 0-6 2.1-6 4.8 0 1.5.8 2.8 2.1 3.7l-.7 2.3 2.5-1.3c.7.2 1.4.3 2.1.3 3.3 0 6-2.1 6-4.9s-2.7-4.9-6-4.9Z" />
    <path d="M14.7 9.1c-.2 0-.4 0-.6.1.1.2.1.5.1.7 0 2-1.7 3.7-4 4.2.7 1.5 2.4 2.5 4.4 2.5.7 0 1.3-.1 1.9-.3l2.1 1.1-.6-1.8c1.1-.8 1.8-1.9 1.8-3.2 0-1.9-2.3-3.3-5.1-3.3Z" />
    <circle cx="6.8" cy="9.8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="9.8" r=".8" fill="currentColor" stroke="none" />
  </svg>`;

const emailIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </svg>`;

const closeIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>`;

function renderAuthForm(state: AuthState) {
  const mode = state.mode === "register" ? "register" : "login";
  const isRegister = mode === "register";
  const field = (name: "email" | "password" | "confirmPassword", label: string, type: string, value: string, autocomplete: string) => {
    const error = state.fieldErrors[name];
    const id = `auth-${name}`;
    return `<label class="auth-field" for="${id}">
      <span>${label}</span>
      <input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value)}" autocomplete="${autocomplete}"${error ? ' aria-invalid="true" aria-describedby="' + id + '-error"' : ""} required />
      ${error ? `<small id="${id}-error" class="auth-field-error">${escapeHtml(error)}</small>` : ""}
    </label>`;
  };
  return `<form class="auth-form" data-auth-form="${mode}" novalidate>
      ${field("email", "邮箱", "email", state.email, "email")}
      ${field("password", "密码", "password", state.password, isRegister ? "new-password" : "current-password")}
      ${isRegister ? field("confirmPassword", "确认密码", "password", state.confirmPassword, "new-password") : ""}
      ${state.formError ? `<p class="auth-form-error" role="alert">${escapeHtml(state.formError)}</p>` : ""}
      <button class="auth-primary-button" type="submit"${state.phase === "submitting" ? " disabled" : ""}>${state.phase === "submitting" ? "正在处理…" : isRegister ? "注册并进入" : "登录"}</button>
    </form>`;
}

function renderEntry(state: AuthState) {
  return `<div class="auth-entry-actions">
    <button class="auth-primary-button auth-wechat-button" type="button" data-auth-wechat>${wechatIcon}<span>微信登录</span></button>
    <div class="auth-divider" role="separator"><span>或</span></div>
    <button class="auth-secondary-button" type="button" data-auth-mode="login">${emailIcon}<span>邮箱登录</span></button>
  </div>`;
}

function renderAccountPane(state: AuthState) {
  const formMode: AuthMode = state.mode === "register" ? "register" : "login";
  return `<section class="auth-account-pane" aria-labelledby="auth-title">
    <div class="auth-tabs" role="tablist" aria-label="账户入口">
      <button type="button" role="tab" aria-selected="${formMode === "login"}" class="auth-tab${formMode === "login" ? " is-active" : ""}" data-auth-mode="login">登录</button>
      <button type="button" role="tab" aria-selected="${formMode === "register"}" class="auth-tab${formMode === "register" ? " is-active" : ""}" data-auth-mode="register">注册</button>
    </div>
    <h1 id="auth-title">${formMode === "register" ? "创建账户" : "欢迎回来"}</h1>
    <p class="auth-subtitle">${formMode === "register" ? "从今天开始，留住你的阅读与灵感" : "继续整理你的阅读与灵感"}</p>
    ${state.mode === "entry" ? renderEntry(state) : renderAuthForm(state)}
    <p class="auth-agreement">登录即表示你同意 <a href="#/terms">《用户协议》</a> 和 <a href="#/privacy">《隐私政策》</a></p>
  </section>`;
}

function renderWechatDialog(open: boolean) {
  if (!open) return "";
  return `<div class="auth-dialog-backdrop" data-auth-dialog-backdrop>
    <section class="auth-dialog" data-auth-dialog="true" role="dialog" aria-modal="true" aria-labelledby="wechat-dialog-title" aria-describedby="wechat-dialog-description">
      <button class="auth-dialog-close" type="button" data-auth-close data-auth-dialog-focusable="true" data-auth-dialog-initial-focus="true" aria-label="关闭微信登录提示">${closeIcon}</button>
      <h2 id="wechat-dialog-title">微信登录暂不可用</h2>
      <p id="wechat-dialog-description">微信登录正在接入中，请先使用邮箱登录。</p>
      <button class="auth-secondary-button" type="button" data-auth-close data-auth-dialog-focusable="true">返回账户入口</button>
    </section>
  </div>`;
}

export function renderAuthPage(state: AuthState, wechatDialogOpen = false) {
  return `<main class="auth-page" data-auth-phase="${state.phase}">
    <section class="auth-brand-panel" aria-label="老己品牌">
      <div class="auth-brand-lockup"><span class="auth-brand-mark">老己</span><span class="auth-brand-seal" aria-hidden="true">己</span><p>遇见自己，爱你老己</p></div>
      <div class="auth-landscape" aria-hidden="true"></div>
      <img class="auth-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="" />
    </section>
    ${renderAccountPane(state)}
    ${renderWechatDialog(wechatDialogOpen)}
  </main>`;
}
