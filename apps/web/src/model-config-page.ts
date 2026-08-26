import {
  TEXT_MODEL_PROVIDERS,
  textModelProviderLabel,
  type TextModelCredential,
  type TextModelDraft,
} from "./model-config";

export type SettingsRoute = { kind: "settings" } | { kind: "text-model"; returnTo?: string };

export type SettingsOverviewState =
  | { status: "loading"; notice?: string }
  | { status: "unconfigured"; notice?: string }
  | { status: "configured"; credential: TextModelCredential; notice?: string }
  | { status: "error"; message: string; notice?: string };

export type TextModelPageState =
  | { status: "loading"; returnTo: string }
  | { status: "error"; returnTo: string; message: string }
  | {
      status: "editing" | "confirm-revoke";
      credential: TextModelCredential | null;
      draft: TextModelDraft;
      returnTo: string;
      validating?: boolean;
      error?: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      status: "success";
      credential: TextModelCredential | null;
      draft: TextModelDraft;
      returnTo: string;
      notice: string;
    };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function parseSettingsRoute(hash: string): SettingsRoute {
  const [path, query = ""] = hash.split("?", 2);
  if (path === "#/settings/text-model") {
    const returnTo = new URLSearchParams(query).get("return");
    return returnTo?.startsWith("#/") ? { kind: "text-model", returnTo } : { kind: "text-model" };
  }
  return { kind: "settings" };
}

export function settingsRouteHash(route: SettingsRoute) {
  if (route.kind !== "text-model") return "#/settings";
  return route.returnTo && route.returnTo !== "#/settings"
    ? `#/settings/text-model?return=${encodeURIComponent(route.returnTo)}`
    : "#/settings/text-model";
}

function settingsChevron() {
  return `<span class="model-config-chevron" aria-hidden="true">›</span>`;
}

function settingsRow(content: string, href?: string) {
  if (href) {
    return `<a class="model-config-row" href="${escapeHtml(href)}">${content}${settingsChevron()}</a>`;
  }
  return `<div class="model-config-row model-config-row--disabled">${content}</div>`;
}

function renderOverviewRows(state: Exclude<SettingsOverviewState, { status: "loading" } | { status: "error" }>) {
  const modelStatus = state.status === "configured"
    ? `${textModelProviderLabel(state.credential.provider)} · ${state.credential.maskedApiKey}`
    : "未配置";
  return `
    <section class="model-config-group" aria-labelledby="model-config-account-heading">
      <h2 id="model-config-account-heading">账户</h2>
      ${settingsRow(`<span class="model-config-row__label">账户与登录方式</span><span class="model-config-row__status">当前账户</span>`)}
    </section>
    <section class="model-config-group" aria-labelledby="model-config-ai-heading">
      <h2 id="model-config-ai-heading">AI 能力</h2>
      ${settingsRow(`<span class="model-config-row__label">文本模型</span><span class="model-config-row__status">${escapeHtml(modelStatus)}</span>`, "#/settings/text-model")}
      ${settingsRow(`<span class="model-config-row__label">图片模型</span><span class="model-config-row__status">未配置</span>`)}
    </section>
    <section class="model-config-group" aria-labelledby="model-config-services-heading">
      <h2 id="model-config-services-heading">外部服务</h2>
      ${settingsRow(`<span class="model-config-row__label">微信读书</span><span class="model-config-row__status">未连接</span>`)}
    </section>
  `;
}

export function renderSettingsOverview(state: SettingsOverviewState) {
  const notice = "notice" in state && state.notice
    ? `<div class="model-config-notice" role="status">${escapeHtml(state.notice)}</div>`
    : "";
  if (state.status === "loading") {
    return `<main class="model-config-overview" aria-labelledby="model-config-title"><header><p>账户设置</p><h1 id="model-config-title">设置</h1></header><div class="model-config-state" aria-live="polite"><p>正在加载设置…</p></div></main>`;
  }
  if (state.status === "error") {
    return `<main class="model-config-overview" aria-labelledby="model-config-title"><header><p>账户设置</p><h1 id="model-config-title">设置</h1></header>${notice}<section class="model-config-state model-config-state--error" role="alert"><strong>设置暂时不可用</strong><p>${escapeHtml(state.message)}</p></section></main>`;
  }
  return `<main class="model-config-overview" aria-labelledby="model-config-title"><header><p>账户设置</p><h1 id="model-config-title">设置</h1><span>管理账户、AI 能力与已连接的服务。</span></header>${notice}<div class="model-config-groups">${renderOverviewRows(state)}</div></main>`;
}

function renderProviderOptions(provider: TextModelDraft["provider"]) {
  return TEXT_MODEL_PROVIDERS.map((option) => `<option value="${option.id}"${option.id === provider ? " selected" : ""}>${option.label}</option>`).join("");
}

function renderFieldError(id: string, message?: string) {
  return message ? `<p class="model-config-field-error" id="${id}-error" role="alert">${escapeHtml(message)}</p>` : "";
}

function renderTextModelForm(state: Extract<TextModelPageState, { status: "editing" | "confirm-revoke" }>) {
  const { draft, credential, fieldErrors } = state;
  const keyType = draft.showApiKey ? "text" : "password";
  const isConfirmingRevoke = state.status === "confirm-revoke";
  const disabled = state.validating || isConfirmingRevoke;
  return `
    <form id="text-model-form" class="model-config-form" novalidate>
      <div class="model-config-field">
        <label for="text-model-provider">供应商</label>
        <select id="text-model-provider" name="provider"${disabled ? " disabled" : ""} aria-describedby="text-model-provider-help">${renderProviderOptions(draft.provider)}</select>
        <p id="text-model-provider-help" class="model-config-field-help">使用固定供应商目录，老己只会在保存时检测配置。</p>
        ${renderFieldError("text-model-provider", fieldErrors?.provider)}
      </div>
      ${credential ? `<div class="model-config-field"><label for="text-model-existing-key">当前 API Key</label><input id="text-model-existing-key" type="text" value="${escapeHtml(credential.maskedApiKey)}" readonly aria-describedby="text-model-existing-key-help" /><p id="text-model-existing-key-help" class="model-config-field-help">当前密钥仅显示脱敏结果；输入新的 API Key 后才会替换。</p></div>` : ""}
      <div class="model-config-field">
        <label for="text-model-api-key">${credential ? "新的 API Key" : "API Key"}</label>
        <div class="model-config-secret-field">
          <input id="text-model-api-key" name="apiKey" type="${keyType}" autocomplete="new-password"${disabled ? " disabled" : ""} aria-describedby="text-model-api-key-help${fieldErrors?.apiKey ? " text-model-api-key-error" : ""}" />
          <button class="model-config-secret-toggle" data-settings-action="text-model-toggle-key" type="button"${disabled ? " disabled" : ""} aria-label="${draft.showApiKey ? "隐藏 API Key" : "显示 API Key"}">${draft.showApiKey ? "隐藏" : "显示"}</button>
        </div>
        <p id="text-model-api-key-help" class="model-config-field-help">API Key 默认隐藏，仅保存在本次配置操作中。</p>
        ${renderFieldError("text-model-api-key", fieldErrors?.apiKey)}
      </div>
      ${draft.provider === "qwen" ? `<div class="model-config-field"><label for="text-model-workspace">业务空间 ID</label><input id="text-model-workspace" name="workspaceId" type="text" value="${escapeHtml(draft.workspaceId)}" autocomplete="off"${disabled ? " disabled" : ""} aria-describedby="text-model-workspace-help${fieldErrors?.workspaceId ? " text-model-workspace-error" : ""}" /><p id="text-model-workspace-help" class="model-config-field-help">通义千问需要填写阿里云百炼业务空间 ID。</p>${renderFieldError("text-model-workspace", fieldErrors?.workspaceId)}</div>` : ""}
      ${state.error ? `<p class="model-config-form-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
      <div class="model-config-form-actions">
        <button class="settings-primary" id="save-text-model" type="submit"${disabled ? " disabled" : ""}>${state.validating ? "正在检测并保存…" : "检测并保存"}</button>
        <a class="settings-secondary model-config-back" href="${escapeHtml(state.returnTo)}">返回</a>
      </div>
    </form>
    ${credential ? `<div class="model-config-danger-zone"><p>移除后，老己不会再使用这组文本模型配置。</p><button class="model-config-danger-link" data-settings-action="text-model-revoke" type="button"${disabled ? " disabled" : ""}>移除配置</button></div>` : ""}
    ${isConfirmingRevoke ? `<div class="model-config-confirm" role="dialog" aria-modal="true" aria-labelledby="revoke-title"><div class="model-config-confirm-card"><h2 id="revoke-title">确认移除文本模型配置？</h2><p>移除后需要重新检测并保存，当前已脱敏的密钥不会恢复。</p><div class="model-config-form-actions"><button class="settings-danger" data-settings-action="text-model-revoke-confirm" type="button"${state.validating ? " disabled" : ""}>${state.validating ? "正在移除…" : "确认移除"}</button><button class="settings-secondary" data-settings-action="text-model-revoke-cancel" type="button"${state.validating ? " disabled" : ""}>保留当前配置</button></div></div></div>` : ""}
  `;
}

export function renderTextModelPage(state: TextModelPageState) {
  const backLink = `<a class="model-config-back" href="${escapeHtml(state.returnTo)}">返回设置</a>`;
  if (state.status === "loading") {
    return `<section class="text-model-page" aria-labelledby="text-model-title">${backLink}<header class="text-model-header"><p>AI 能力</p><h1 id="text-model-title">文本模型</h1></header><div class="model-config-state" aria-live="polite"><p>正在加载文本模型配置…</p></div></section>`;
  }
  if (state.status === "error") {
    return `<section class="text-model-page" aria-labelledby="text-model-title">${backLink}<header class="text-model-header"><p>AI 能力</p><h1 id="text-model-title">文本模型</h1></header><section class="model-config-state model-config-state--error" role="alert"><strong>文本模型配置暂时不可用</strong><p>${escapeHtml(state.message)}</p><button class="settings-secondary" data-settings-action="text-model-reload" type="button">重新加载</button></section></section>`;
  }
  if (state.status === "success") {
    const outcome = state.credential
      ? "配置已保存，可以继续使用 AI 能力。"
      : "已移除保存的凭证；书籍、笔记和历史作品不受影响。";
    return `<section class="text-model-page" aria-labelledby="text-model-title">${backLink}<header class="text-model-header"><p>AI 能力</p><h1 id="text-model-title">文本模型</h1></header><section class="model-config-success" role="status"><strong>${escapeHtml(state.notice)}</strong><p>${outcome}</p><a class="settings-primary model-config-success__back" href="${escapeHtml(state.returnTo)}">返回设置</a></section></section>`;
  }
  return `<section class="text-model-page" aria-labelledby="text-model-title">${backLink}<header class="text-model-header"><p>AI 能力</p><h1 id="text-model-title">文本模型</h1><span>配置自己的 AI 模型后，老己才会使用对应供应商生成内容。</span></header>${renderTextModelForm(state)}</section>`;
}
