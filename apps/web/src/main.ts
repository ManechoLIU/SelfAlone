import "./styles.css";
import "./book-detail.css";
import "./settings-page.css";
import { ApiError, requestJson as requestAuthJson } from "./api";
import {
  conversationHash,
  outlineDraftStorageKey,
  parseOutlineDraft,
  parseRequirementsDraft,
  resolveScreen,
  requirementsDraftStorageKey,
  serializeRequirementsDraft,
  serializeOutlineDraft,
  stageFromConversationHash,
  taskProgressLabel,
  withDraftOutline,
  withDraftRequirements,
  type OutlineItem,
  type WorkspaceScreen,
  type WorkspaceSnapshot,
} from "./app-state";
import {
  authErrorField,
  authErrorMessage,
  authHash,
  createAuthState,
  parseAuthHash,
  resolveSession,
  setAuthMode,
  validateAuthInput,
  type AuthState,
} from "./auth-state";
import { renderAuthPage } from "./auth-page";
import { bookPptIntentFromHash, bookPptIntentHashForStage, bookPptIntentTitleFromHash } from "./book-detail-state";
import type { AuthAccountResponse, LibraryBookSummary, LibrarySnapshot, TextReading } from "@selfalone/contracts";
import {
  authorLabel,
  bindLibrarySearchInteractions,
  coverStatusLabel,
  createLibraryPollingScheduler,
  createLatestLibraryRequest,
  libraryViewState,
  libraryBookDetailHref,
  bookDetailIdFromHash,
  parseStatusLabel,
  readingBookIdFromHash,
  type LibraryLoadState,
} from "./library-state";
import { coverAssetForBook } from "./library-cover";
import { renderConversationView } from "./conversation-view";
import { createTextReaderApi, mountTextReader } from "./text-reader";
import { renderDesktopAppShell, renderDesktopRail } from "./ui/desktop-shell";
import { icons } from "./ui/icons";
import { renderSettingsPage } from "./settings-page";
import {
  createSettingsState,
  parseSettingsDraft,
  resolveSettingsOverview,
  serializeSettingsDraft,
  settingsDraftStorageKey,
  settingsErrorMessage,
  type SettingsMutation,
  type SettingsMutationKind,
  type SettingsMutationPhase,
  type SettingsOverview,
  type SettingsState,
} from "./settings-state";

const workspaceScreens: WorkspaceScreen[] = ["requirements", "outline", "template", "generating", "completed", "failed", "stopped"];
const workspaceCacheStorageKey = "selfalone:m1:workspace-cache";
const conversationScrollStorageKey = "selfalone:m1:conversation-scroll";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("APP_ROOT_MISSING");
}
const app: HTMLDivElement = appRoot;

let authState: AuthState = createAuthState(parseAuthHash(window.location.hash).mode);
let authDialogOpen = false;
let authRecoveryFinished = false;
let authRecoveryPromise: Promise<void> | null = null;
let workspace: WorkspaceSnapshot | null = null;
let busy = false;
let errorMessage = "";
let selectedTemplate = "qingci-study";
let pollingTimer: number | undefined;
let workspaceRequestInFlight = false;
let draftRequirements = "";
let draftRequirementsDirty = false;
let draftOutline: OutlineItem[] = [];
let draftOutlineDirty = false;
let outlineDraftStatus: "local" | undefined;
let stageView: WorkspaceScreen | null = readStageViewFromHash();
let lastConversationStage: WorkspaceScreen | null = stageView;
let bookPptIntentId: string | null = bookPptIntentFromHash(window.location.hash);
let bookPptIntentTitle: string | null = bookPptIntentTitleFromHash(window.location.hash);
let routeGeneration = 0;
let conversationScrollTop = 0;
let taskScrollTop = 0;
let conversationFocusKey: string | null = null;
let routeRenderFrame: number | undefined;
let settingsState: SettingsState = createSettingsState();
let settingsRequestInFlight = false;
let lastSettingsFocusField: string | null = null;
let libraryState: LibraryLoadState = {
  loading: true,
  searching: false,
  error: "",
  searchError: "",
  query: "",
  draftQuery: "",
  books: [],
  unfilteredBooks: [],
};
let libraryUploading = false;
const latestLibraryRequest = createLatestLibraryRequest();
const libraryPolling = createLibraryPollingScheduler(
  () => void loadLibrary(libraryState.query, "poll"),
);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readStageViewFromHash(): WorkspaceScreen | null {
  return stageFromConversationHash(window.location.hash);
}

function isConversationRoute() {
  return window.location.hash.slice(1).split("?")[0] === "/conversation";
}

function isAuthRoute() {
  return window.location.hash.startsWith("#/auth");
}

function isSettingsRoute() {
  return window.location.hash.startsWith("#/settings");
}

function settingsShell(content: string) {
  return `<div class="settings-shell" data-active-section="settings">
    ${renderDesktopRail({ activeSection: "settings", conversationHref: conversationHref() })}
    <div class="settings-main">${content}</div>
  </div>`;
}

function renderSettings() {
  app.innerHTML = settingsShell(renderSettingsPage(settingsState));
  bindSettingsInteractions();
}

function settingsMutation(
  kind: SettingsMutationKind,
  phase: SettingsMutationPhase,
  error = "",
): SettingsMutation {
  return { kind, phase, error };
}

function persistSettingsDraft() {
  const accountId = settingsState.overview?.account.id;
  if (!accountId) return;
  try {
    window.localStorage.setItem(settingsDraftStorageKey(accountId), serializeSettingsDraft(settingsState.draft));
  } catch {
    // Keep the in-memory draft when browser storage is unavailable.
  }
}

function restoreSettingsDraft(state: SettingsState) {
  const accountId = state.overview?.account.id;
  if (!accountId) return state;
  try {
    const recovered = parseSettingsDraft(window.localStorage.getItem(settingsDraftStorageKey(accountId)));
    return recovered ? { ...state, draft: recovered } : state;
  } catch {
    return state;
  }
}

async function loadSettings() {
  if (settingsRequestInFlight || !isSettingsRoute()) return;
  settingsRequestInFlight = true;
  settingsState = { ...settingsState, phase: "loading", error: "" };
  renderSettings();
  try {
    const overview = await requestAuthJson<SettingsOverview>("/api/v1/settings");
    settingsState = restoreSettingsDraft(resolveSettingsOverview(settingsState, overview));
  } catch {
    settingsState = resolveSettingsOverview(settingsState, new Error("SETTINGS_LOAD_FAILED"));
  } finally {
    settingsRequestInFlight = false;
    if (isSettingsRoute()) renderSettings();
  }
}

function focusSettingsDialog() {
  document.querySelector<HTMLButtonElement>('[data-settings-action="logout-confirm"]')?.focus();
}

function focusSettingsField(fieldName: string | null) {
  const selectors: Record<string, string> = {
    email: "#settings-email",
    currentPassword: "#settings-current-password",
    newPassword: "#settings-new-password",
    confirmPassword: "#settings-confirm-password",
  };
  document.querySelector<HTMLInputElement>(selectors[fieldName ?? ""] ?? "#settings-email")?.focus();
}

function closeSettingsLogoutDialog() {
  settingsState = {
    ...settingsState,
    logoutConfirmation: false,
    mutation: settingsMutation("idle", "idle"),
  };
  renderSettings();
  document.querySelector<HTMLButtonElement>('[data-settings-action="logout"]')?.focus();
}

async function confirmSettingsLogout() {
  settingsState = {
    ...settingsState,
    mutation: settingsMutation("logout", "submitting"),
  };
  renderSettings();
  try {
    await requestAuthJson<unknown>("/api/v1/auth/logout", { method: "POST" });
    authState = createAuthState("entry");
    authRecoveryFinished = true;
    settingsState = createSettingsState();
    window.history.replaceState(null, "", authHash("entry"));
    renderRoute();
  } catch (error) {
    const message = settingsErrorMessage(error instanceof ApiError ? error.code : "REQUEST_FAILED");
    settingsState = {
      ...settingsState,
      logoutConfirmation: true,
      mutation: settingsMutation("logout", "failed", message === "暂时无法保存设置，请稍后重试。"
        ? "退出登录失败，当前页面和登录状态已保留，请稍后重试。"
        : message),
    };
    if (isSettingsRoute()) {
      renderSettings();
      focusSettingsDialog();
    }
  }
}

async function submitSettingsForm(form: HTMLFormElement) {
  if (!settingsState.overview || settingsState.mutation.phase === "submitting") return;
  const formData = new FormData(form);
  const draft = {
    email: String(formData.get("email") ?? "").trim(),
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
  const currentEmail = settingsState.overview.account.email;
  const emailChanged = draft.email !== currentEmail;
  const passwordChanged = Boolean(draft.newPassword || draft.confirmPassword);
  const mutationKind: SettingsMutationKind = emailChanged ? "change-email" : "change-password";
  const settingsFocusField = document.activeElement?.getAttribute("name") || lastSettingsFocusField;

  settingsState = {
    ...settingsState,
    draft,
    accountError: "",
    mutation: settingsMutation("idle", "idle"),
  };
  persistSettingsDraft();

  const validationError = !emailChanged && !passwordChanged
    ? "请输入要修改的邮箱或密码。"
    : emailChanged && passwordChanged
      ? "邮箱和密码请分别保存，避免一次提交产生部分修改。"
      : !draft.currentPassword
        ? "请输入当前密码后再保存修改。"
        : passwordChanged && draft.newPassword.length < 8
          ? "密码至少需要 8 位。"
          : passwordChanged && draft.newPassword !== draft.confirmPassword
            ? "两次输入的新密码不一致。"
            : "";
  if (validationError) {
    settingsState = {
      ...settingsState,
      accountError: validationError,
      mutation: settingsMutation(mutationKind, "failed", validationError),
    };
    renderSettings();
    focusSettingsField(settingsFocusField || (emailChanged ? "email" : "currentPassword"));
    return;
  }

  settingsState = {
    ...settingsState,
    mutation: settingsMutation(mutationKind, "submitting"),
  };
  renderSettings();
  try {
    if (emailChanged) {
      await requestAuthJson<unknown>("/api/v1/settings/email", {
        method: "POST",
        body: JSON.stringify({ currentPassword: draft.currentPassword, newEmail: draft.email }),
      });
    } else {
      await requestAuthJson<unknown>("/api/v1/settings/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: draft.currentPassword, newPassword: draft.newPassword }),
      });
    }
    settingsState = {
      ...settingsState,
      accountError: "",
      draft: emailChanged
        ? settingsState.draft
        : { ...settingsState.draft, currentPassword: "", newPassword: "", confirmPassword: "" },
      mutation: settingsMutation(mutationKind, "success"),
    };
    persistSettingsDraft();
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "REQUEST_FAILED";
    const message = settingsErrorMessage(code);
    settingsState = {
      ...settingsState,
      accountError: message,
      draft,
      mutation: settingsMutation(mutationKind, "failed", message),
    };
    persistSettingsDraft();
  }
  if (isSettingsRoute()) {
    renderSettings();
    if (settingsState.mutation.phase === "failed") {
      focusSettingsField(settingsFocusField || (emailChanged ? "email" : "currentPassword"));
    }
  }
}

function bindSettingsInteractions() {
  document.querySelectorAll<HTMLButtonElement>("[data-settings-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = button.dataset.settingsAction;
      if (action === "account") {
        settingsState = {
          ...settingsState,
          view: "account",
          accountError: "",
          mutation: settingsMutation("idle", "idle"),
        };
        lastSettingsFocusField = "email";
        renderSettings();
        document.querySelector<HTMLInputElement>("#settings-email")?.focus();
      } else if (action === "back") {
        settingsState = {
          ...settingsState,
          view: "overview",
          accountError: "",
          mutation: settingsMutation("idle", "idle"),
        };
        lastSettingsFocusField = null;
        renderSettings();
        document.querySelector<HTMLButtonElement>('[data-settings-action="account"]')?.focus();
      } else if (action === "reload") {
        void loadSettings();
      } else if (action === "logout") {
        settingsState = {
          ...settingsState,
          logoutConfirmation: true,
          mutation: settingsMutation("logout", "idle"),
        };
        renderSettings();
        focusSettingsDialog();
      } else if (action === "logout-cancel") {
        closeSettingsLogoutDialog();
      } else if (action === "logout-confirm") {
        event.preventDefault();
        void confirmSettingsLogout();
      }
    });
  });

  document.querySelector<HTMLDivElement>("[data-settings-dialog-backdrop]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSettingsLogoutDialog();
  });

  const dialog = document.querySelector<HTMLElement>("[role=dialog][aria-labelledby=settings-logout-title]");
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettingsLogoutDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index === 0) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (!event.shiftKey && index === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  });

  const accountForm = document.querySelector<HTMLFormElement>("[data-settings-account-form]");
  accountForm?.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name) lastSettingsFocusField = target.name;
  });
  accountForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSettingsForm(event.currentTarget as HTMLFormElement);
  });
}

function renderAuth() {
  app.innerHTML = renderAuthPage(authState, authDialogOpen);
  bindAuthInteractions();
}

function focusAuthDialogInitial() {
  document.querySelector<HTMLElement>("[data-auth-dialog-initial-focus]")?.focus();
}

function closeAuthDialog() {
  if (!authDialogOpen) return;
  authDialogOpen = false;
  renderAuth();
  document.querySelector<HTMLButtonElement>("[data-auth-wechat]")?.focus();
}

function handleAuthDialogKeydown(event: KeyboardEvent) {
  if (!authDialogOpen) return;
  const dialog = document.querySelector<HTMLElement>('[data-auth-dialog="true"]');
  if (!dialog) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeAuthDialog();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("[data-auth-dialog-focusable]")).filter(
    (element) => !element.hasAttribute("disabled"),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (activeIndex === -1) {
    event.preventDefault();
    focusable[0]?.focus();
    return;
  }
  if (event.shiftKey && activeIndex === 0) {
    event.preventDefault();
    focusable[focusable.length - 1]?.focus();
  } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault();
    focusable[0]?.focus();
  }
}

function bindAuthInteractions() {
  document.querySelectorAll<HTMLButtonElement>("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.authMode;
      if (mode !== "entry" && mode !== "login" && mode !== "register") return;
      authState = setAuthMode(authState, mode);
      window.history.pushState(null, "", authHash(mode));
      renderAuth();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-auth-wechat]").forEach((button) => {
    button.addEventListener("click", () => {
      authDialogOpen = true;
      renderAuth();
      focusAuthDialogInitial();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-auth-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeAuthDialog();
    });
  });
  document.querySelector<HTMLDivElement>("[data-auth-dialog-backdrop]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeAuthDialog();
    }
  });
  const form = document.querySelector<HTMLFormElement>("[data-auth-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthForm(form);
  });
}

async function submitAuthForm(form: HTMLFormElement) {
  const mode = form.dataset.authForm;
  if (mode !== "login" && mode !== "register") return;
  const formData = new FormData(form);
  const next = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
  const fieldErrors = validateAuthInput(mode, next);
  authState = {
    ...authState,
    ...next,
    phase: Object.keys(fieldErrors).length > 0 ? "unauthenticated" : "submitting",
    fieldErrors,
    formError: "",
  };
  renderAuth();
  if (Object.keys(fieldErrors).length > 0) return;
  try {
    const response = await requestAuthJson<AuthAccountResponse>(
      mode === "register" ? "/api/v1/auth/email/register" : "/api/v1/auth/email/login",
      {
        method: "POST",
        body: JSON.stringify({ email: next.email, password: next.password }),
      },
    );
    authState = {
      ...createAuthState("entry"),
      phase: "authenticated",
      account: response.account,
    };
    authRecoveryFinished = true;
    window.history.replaceState(null, "", "#/library");
    renderRoute();
  } catch (error) {
    const code = error instanceof ApiError ? error.code : undefined;
    const field = authErrorField(code, mode);
    authState = {
      ...authState,
      phase: "unauthenticated",
      fieldErrors: field ? { [field]: authErrorMessage(code, mode) } : {},
      formError: field ? "" : authErrorMessage(code, mode),
    };
    renderAuth();
  }
}

async function recoverAuthSession() {
  if (authRecoveryPromise) return authRecoveryPromise;
  authState = { ...authState, phase: "recovering", formError: "" };
  renderAuth();
  authRecoveryPromise = (async () => {
    try {
      const response = await requestAuthJson<AuthAccountResponse>("/api/v1/account");
      const session = resolveSession({ status: 200, account: response.account });
      authState = { ...authState, ...session, formError: "" };
      authRecoveryFinished = true;
      if (isAuthRoute() || !window.location.hash) {
        window.history.replaceState(null, "", "#/library");
      }
      renderRoute();
    } catch (error) {
      authRecoveryFinished = true;
      const mode = parseAuthHash(window.location.hash).mode;
      authState = {
        ...createAuthState(mode),
        formError: error instanceof ApiError && error.status === 401
          ? ""
          : "暂时无法连接老己服务，请稍后重试。",
      };
      if (!isAuthRoute()) window.history.replaceState(null, "", authHash(mode));
      renderAuth();
    } finally {
      authRecoveryPromise = null;
    }
  })();
  return authRecoveryPromise;
}

function conversationHref() {
  const stage = stageView ?? lastConversationStage;
  return bookPptIntentId
    ? bookPptIntentHashForStage(bookPptIntentId, stage, bookPptIntentTitle ?? undefined)
    : conversationHash(stage);
}

function focusKeyForElement(element: Element | null) {
  if (!element || !element.closest(".conversation-content, .desktop-task-panel")) return null;
  if (element.id === "requirements") return "requirements";
  const name = element.getAttribute("name");
  return name && /^(title|body)-\d+$/.test(name) ? name : null;
}

function persistConversationScroll() {
  const scroll = document.querySelector<HTMLElement>(".desktop-conversation-scroll");
  const task = document.querySelector<HTMLElement>(".desktop-task-panel");
  if (!scroll && !task) return;
  conversationFocusKey = focusKeyForElement(document.activeElement) ?? conversationFocusKey;
  conversationScrollTop = scroll?.scrollTop ?? conversationScrollTop;
  taskScrollTop = task?.scrollTop ?? taskScrollTop;
  try {
    window.sessionStorage.setItem(conversationScrollStorageKey, JSON.stringify({
      conversation: conversationScrollTop,
      task: taskScrollTop,
      focus: conversationFocusKey,
    }));
  } catch {
    // Keep the in-memory position when session storage is unavailable.
  }
}

function restoreConversationScroll() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(conversationScrollStorageKey) ?? "null") as { conversation?: unknown; task?: unknown; focus?: unknown } | null;
    if (parsed) {
      if (typeof parsed.conversation === "number") conversationScrollTop = parsed.conversation;
      if (typeof parsed.task === "number") taskScrollTop = parsed.task;
      if (typeof parsed.focus === "string") conversationFocusKey = parsed.focus;
    }
  } catch {
    // The current in-memory position is still useful when storage is unavailable.
  }
  const apply = () => {
    document.querySelector<HTMLElement>(".desktop-conversation-scroll")?.scrollTo({ top: conversationScrollTop });
    document.querySelector<HTMLElement>(".desktop-task-panel")?.scrollTo({ top: taskScrollTop });
    const focusSelector = conversationFocusKey === "requirements"
      ? "#requirements"
      : conversationFocusKey && /^(title|body)-\d+$/.test(conversationFocusKey)
        ? `[name="${conversationFocusKey}"]`
        : null;
    if (focusSelector) document.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
  };
  window.requestAnimationFrame?.(apply);
  window.setTimeout(apply, 0);
}

function setStageView(next: WorkspaceScreen) {
  if (!workspace) return;
  if (stageView === next) return;
  persistConversationScroll();
  stageView = next;
  lastConversationStage = next;
  window.history.pushState(null, "", conversationHref());
  render();
}

function clearStageView() {
  stageView = null;
  lastConversationStage = null;
  if (window.location.hash.includes("?stage=")) {
    window.history.replaceState(null, "", conversationHref());
  }
}

function readRecoveredOutline(draftId: string) {
  try {
    return parseOutlineDraft(window.localStorage.getItem(outlineDraftStorageKey(draftId)));
  } catch {
    return null;
  }
}

function persistOutlineDraft(draftId: string, outline: OutlineItem[]) {
  try {
    window.localStorage.setItem(outlineDraftStorageKey(draftId), serializeOutlineDraft(outline));
  } catch {
    // A private browsing policy may deny local recovery; the in-memory draft still remains visible.
  }
}

function readRecoveredRequirements(draftId: string) {
  try {
    return parseRequirementsDraft(window.localStorage.getItem(requirementsDraftStorageKey(draftId)));
  } catch {
    return null;
  }
}

function persistRequirementsDraft(draftId: string, requirements: string) {
  try {
    window.localStorage.setItem(requirementsDraftStorageKey(draftId), serializeRequirementsDraft(requirements));
  } catch {
    // Keep the in-memory draft visible when browser storage is unavailable.
  }
}

function clearRecoveredRequirements(draftId: string) {
  try {
    window.localStorage.removeItem(requirementsDraftStorageKey(draftId));
  } catch {
    // Keep the successful server response usable when storage cleanup is unavailable.
  }
}

function clearRecoveredOutline(draftId: string) {
  try {
    window.localStorage.removeItem(outlineDraftStorageKey(draftId));
  } catch {
    // Keep the successful server response usable even when storage cleanup is unavailable.
  }
}

function cacheWorkspace(snapshot: WorkspaceSnapshot) {
  try {
    window.localStorage.setItem(workspaceCacheStorageKey, JSON.stringify(snapshot));
  } catch {
    // The network response remains the source of truth when browser storage is unavailable.
  }
}

function readCachedWorkspace(): WorkspaceSnapshot | null {
  try {
    const value = window.localStorage.getItem(workspaceCacheStorageKey);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("draft" in parsed) || !("outline" in parsed) || !Array.isArray(parsed.outline)) {
      return null;
    }
    return parsed as WorkspaceSnapshot;
  } catch {
    return null;
  }
}

function libraryShell(content: string) {
  const conversationRoute = conversationHref();
  return `
    <div class="library-shell" data-active-section="library">
      ${renderDesktopRail({ activeSection: "library", conversationHref: conversationRoute })}
      <main class="library-main">${content}</main>
      <div class="library-companion">
        <img src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="" />
        <a class="library-companion-button" href="${conversationRoute}" aria-label="和老己聊聊">${icons.chat}</a>
      </div>
    </div>`;
}

function libraryStatePanel() {
  const view = libraryViewState(libraryState);
  if (view === "loading") {
    return `<section class="library-state" aria-live="polite">
      <div class="shelf-loading" aria-hidden="true">${Array.from({ length: 5 }, () => "<i></i>").join("")}</div>
      <p>正在取回你的书架…</p>
    </section>`;
  }
  if (view === "failure") {
    return `<section class="library-state failure" role="alert">
      <span>${icons.retry}</span><h2>书架暂时没有载入</h2>
      <p>${escapeHtml(libraryState.error)}</p>
      <button id="retry-library" class="quiet-button" type="button">重新载入</button>
    </section>`;
  }
  if (view === "filtered_empty") {
    return `<section class="library-state">
      <span class="library-state-icon">${icons.search}</span><h2>没有找到“${escapeHtml(libraryState.query)}”</h2>
      <p>换一个书名或作者试试，书架内容不会被改动。</p>
      <button id="clear-search" class="quiet-button" type="button">清除搜索</button>
    </section>`;
  }
  if (view === "empty") {
    return `<section class="library-state empty">
      <span class="library-state-icon">${icons.book}</span><h2>把第一本书放进来</h2>
      <p>支持 EPUB、TXT 和 PDF；文件会保存到你的账户，再在这里显示解析结果。</p>
      <button id="empty-import-button" class="primary-button state-import" type="button" aria-label="导入一本书">${icons.upload}导入一本书</button>
    </section>`;
  }
  return libraryGrid(libraryState.books);
}

function libraryGrid(books: LibraryBookSummary[]) {
  return `<section class="book-grid" aria-label="书架，共 ${books.length} 本书">
    ${books.map((book) => {
      const author = authorLabel(book.author);
      const status = parseStatusLabel(book.parseStatus, book.errorCode);
      const coverStatus = coverStatusLabel(book.parseStatus, book.errorCode);
      const href = libraryBookDetailHref(book);
      const tag = href ? "a" : "article";
      const target = href ? ` href="${href}"` : "";
      return `<${tag} class="book-item ${book.parseStatus}"${target} aria-label="《${escapeHtml(book.title)}》，${escapeHtml(author)}，${escapeHtml(book.sourceLabel)}，${escapeHtml(status)}">
        <div class="default-cover" role="img" aria-label="《${escapeHtml(book.title)}》默认封面">
          <img class="default-cover-art" src="${coverAssetForBook(book.id)}" alt="" />
          <strong>${escapeHtml(book.title)}</strong>
          <em>${escapeHtml(author)}</em>
          <b class="parse-badge" aria-label="解析状态：${escapeHtml(status)}">${escapeHtml(coverStatus)}</b>
        </div>
        <div class="book-caption">
          <span class="book-source">${icons.file}<span>${escapeHtml(book.sourceLabel)}</span></span>
        </div>
      </${tag}>`;
    }).join("")}
  </section>`;
}

function renderLibrary(preserveSearchFocus = false) {
  const activeElement = document.activeElement;
  const activeSearch = activeElement instanceof HTMLInputElement
    && activeElement.id === "book-query";
  const searchSelection = activeSearch
    ? [activeElement.selectionStart, activeElement.selectionEnd] as const
    : [null, null] as const;
  const retainedError = libraryState.error && libraryState.books.length
    ? `<div class="library-inline-error" role="alert">${escapeHtml(libraryState.error)}，已保留当前书架。</div>`
    : "";
  const searchError = libraryState.searchError
    ? `<div class="library-inline-error library-search-error" role="alert">
        <span>搜索“${escapeHtml(libraryState.query)}”失败，当前显示未筛选的 ${libraryState.unfilteredBooks.length} 本书。</span>
        <div>
          <button id="retry-search" class="quiet-button" type="button">重试搜索</button>
          <button id="clear-search" class="quiet-button" type="button">清除搜索</button>
        </div>
      </div>`
    : "";
  app.innerHTML = libraryShell(`
    <h1 class="library-title">读书</h1>
    <section class="library-toolbar" aria-label="书架工具">
      <form id="library-search" role="search" aria-busy="${libraryState.searching}">
        <label class="visually-hidden" for="book-query">搜索书名或作者</label>
        <span>${icons.search}</span>
        <input id="book-query" name="query" type="search" value="${escapeHtml(libraryState.draftQuery)}" placeholder="搜索书名或作者" autocomplete="off" aria-describedby="library-search-status" />
        <span id="library-search-status" class="library-search-status" role="status" aria-live="polite">${libraryState.searching ? `<i aria-hidden="true"></i><span>正在搜索…</span>` : ""}</span>
      </form>
      <button id="top-import-button" class="import-button ${libraryUploading ? "busy" : ""}" type="button" aria-label="导入书籍" title="导入书籍" ${libraryUploading ? "disabled" : ""}>
        ${icons.upload}<span>${libraryUploading ? "正在保存…" : "导入书籍"}</span>
      </button>
      <input class="visually-hidden" id="book-import" type="file" tabindex="-1" aria-hidden="true" accept=".epub,.txt,.pdf,application/epub+zip,text/plain,application/pdf" ${libraryUploading ? "disabled" : ""} />
    </section>
    <section class="weread-note" aria-label="微信读书连接状态">
      <div><strong>连接微信读书</strong><span>开发中</span></div>
      <p>本地书籍已可导入；连接能力将在账户与设置闭环中开放。</p>
    </section>
    ${retainedError}
    ${searchError}
    ${libraryStatePanel()}
  `);
  bindLibraryInteractions();
  if (activeSearch || preserveSearchFocus) {
    const nextSearch = document.querySelector<HTMLInputElement>("#book-query");
    nextSearch?.focus({ preventScroll: true });
    if (searchSelection[0] !== null && searchSelection[1] !== null) {
      nextSearch?.setSelectionRange(searchSelection[0], searchSelection[1]);
    }
  }
}

type LibraryLoadKind = "initial" | "search" | "poll";

async function loadLibrary(
  query = libraryState.query,
  kind: LibraryLoadKind = "initial",
  preserveSearchFocus = false,
) {
  if (!window.location.hash.startsWith("#/library")) return;
  libraryPolling.stop();
  const normalizedQuery = query.trim();
  const request = latestLibraryRequest.begin();
  libraryState = kind === "search"
    ? {
        ...libraryState,
        loading: false,
        searching: true,
        error: "",
        searchError: "",
        query: normalizedQuery,
        draftQuery: query,
      }
    : {
        ...libraryState,
        loading: libraryState.books.length === 0,
        searching: false,
        error: "",
        searchError: "",
      };
  renderLibrary(preserveSearchFocus);
  try {
    const snapshot = await requestJson<LibrarySnapshot>(
      `/api/v1/books?query=${encodeURIComponent(normalizedQuery)}`,
      { signal: request.signal },
    );
    if (!latestLibraryRequest.isCurrent(request.id)) return;
    libraryState = {
      ...libraryState,
      loading: false,
      searching: false,
      error: "",
      searchError: "",
      query: normalizedQuery,
      draftQuery: normalizedQuery,
      books: snapshot.books,
      unfilteredBooks: normalizedQuery ? libraryState.unfilteredBooks : snapshot.books,
    };
  } catch (error) {
    if (!latestLibraryRequest.isCurrent(request.id) || (error instanceof DOMException && error.name === "AbortError")) return;
    libraryState = kind === "search"
      ? {
          ...libraryState,
          loading: false,
          searching: false,
          error: "",
          searchError: "无法连接书架服务",
          query: normalizedQuery,
          draftQuery: query,
          books: libraryState.unfilteredBooks,
        }
      : {
          ...libraryState,
          loading: false,
          searching: false,
          error: "无法连接书架服务，请检查本地服务后重试",
      };
  }
  if (!window.location.hash.startsWith("#/library")) return;
  renderLibrary(preserveSearchFocus);
  updateLibraryPolling();
}

function updateLibraryPolling() {
  libraryPolling.sync(libraryState);
}

async function uploadBook(file: File) {
  libraryUploading = true;
  libraryState = { ...libraryState, error: "" };
  renderLibrary();
  try {
    const response = await fetch("/api/v1/books/import", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const payload = await response.json() as LibraryBookSummary & { code?: string };
    if (!response.ok) throw new Error(payload.code ?? "UPLOAD_FAILED");
    libraryState = { ...libraryState, books: [payload, ...libraryState.books] };
  } catch (error) {
    const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const messages: Record<string, string> = {
      UNSUPPORTED_BOOK_FORMAT: "只支持 EPUB、TXT 和 PDF 文件",
      BOOK_FILE_TOO_LARGE: "文件超过 50 MB，未保存",
      EMPTY_BOOK_FILE: "文件没有内容，未保存",
    };
    libraryState = { ...libraryState, error: messages[code] ?? "这本书没有导入，当前书架已保留" };
  } finally {
    libraryUploading = false;
    if (window.location.hash.startsWith("#/library")) {
      renderLibrary();
      updateLibraryPolling();
    }
  }
}

function bindLibraryInteractions() {
  const searchForm = document.querySelector<HTMLFormElement>("#library-search");
  const searchInput = document.querySelector<HTMLInputElement>("#book-query");
  if (searchForm && searchInput) {
    bindLibrarySearchInteractions({
      form: searchForm,
      input: searchInput,
      onQueryChange: (query) => { libraryState = { ...libraryState, draftQuery: query }; },
      onSearch: (query) => void loadLibrary(query, "search", true),
    });
  }
  const fileInput = document.querySelector<HTMLInputElement>("#book-import");
  fileInput?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void uploadBook(file);
  });
  document.querySelector<HTMLButtonElement>("#top-import-button")?.addEventListener("click", () => fileInput?.click());
  document.querySelector<HTMLButtonElement>("#empty-import-button")?.addEventListener("click", () => fileInput?.click());
  document.querySelector<HTMLButtonElement>("#retry-library")?.addEventListener("click", () => void loadLibrary("", "initial"));
  document.querySelector<HTMLButtonElement>("#retry-search")?.addEventListener("click", () => void loadLibrary(libraryState.query, "search", true));
  document.querySelector<HTMLButtonElement>("#clear-search")?.addEventListener("click", () => void loadLibrary("", "search", true));
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) {
    throw new Error(payload.code ?? "REQUEST_FAILED");
  }
  return payload;
}

async function loadWorkspace() {
  if (workspaceRequestInFlight) return false;
  workspaceRequestInFlight = true;
  let loaded = false;
  try {
    const snapshot = await requestJson<WorkspaceSnapshot>("/api/v1/workspace");
    cacheWorkspace(snapshot);
    workspace = snapshot;
    loaded = true;
    const recoveredRequirements = readRecoveredRequirements(snapshot.draft.id);
    if (recoveredRequirements !== null && !draftRequirementsDirty) {
      draftRequirements = recoveredRequirements;
      draftRequirementsDirty = true;
    } else if (!draftRequirementsDirty) {
      draftRequirements = snapshot.draft.requirements;
    }
    const recoveredOutline = (snapshot.draft.stage === "outline" || stageView !== null) ? readRecoveredOutline(snapshot.draft.id) : null;
    if (recoveredOutline && !draftOutlineDirty) {
      draftOutline = recoveredOutline;
      draftOutlineDirty = true;
      outlineDraftStatus = "local";
    } else if (!draftOutlineDirty) {
      draftOutline = snapshot.outline.map((page) => ({ ...page }));
      outlineDraftStatus = undefined;
    }
    if (snapshot.draft.stage !== "outline" && stageView === null && !draftOutlineDirty) {
      clearRecoveredOutline(snapshot.draft.id);
      outlineDraftStatus = undefined;
    }
    if (snapshot.draft.stage !== "requirements" && stageView === null && !draftRequirementsDirty) {
      clearRecoveredRequirements(snapshot.draft.id);
    }
    if (snapshot.draft.templateId) {
      selectedTemplate = snapshot.draft.templateId;
    }
    errorMessage = "";
  } catch {
    errorMessage = "暂时无法连接老己服务，输入和已完成结果都不会被清空。";
    if (!workspace) {
      const cached = readCachedWorkspace();
      if (cached) {
        workspace = cached;
        const recoveredRequirements = readRecoveredRequirements(cached.draft.id);
        if (recoveredRequirements !== null) {
          draftRequirements = recoveredRequirements;
          draftRequirementsDirty = true;
        } else {
          draftRequirements = cached.draft.requirements;
        }
        const recoveredOutline = (cached.draft.stage === "outline" || stageView !== null) ? readRecoveredOutline(cached.draft.id) : null;
        if (recoveredOutline) {
          draftOutline = recoveredOutline;
          draftOutlineDirty = true;
          outlineDraftStatus = "local";
        } else {
          draftOutline = cached.outline.map((page) => ({ ...page }));
        }
      }
    }
  } finally {
    workspaceRequestInFlight = false;
    if (isConversationRoute()) render();
    updatePolling();
  }
  return loaded;
}

function updatePolling() {
  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  if (isConversationRoute() && workspace && !errorMessage && resolveScreen(workspace) === "generating") {
    pollingTimer = window.setInterval(loadWorkspace, 450);
  }
}

function conversationMeta() {
  if (!workspace) return "正在恢复最近对话";
  const screen = stageView ?? resolveScreen(workspace);
  const labels: Record<string, string> = {
    requirements: "范围与需求",
    outline: "大纲",
    template: "模板",
    submitted: "生成",
  };
  return screen === "failed"
    ? "生成失败"
    : screen === "completed"
      ? "生成完成"
      : labels[screen] ?? labels[workspace.draft.stage] ?? "当前会话";
}

function conversationList() {
  return workspace
    ? [{
        id: workspace.conversation.id,
        title: `《${workspace.book.title}》读书分享`,
        meta: conversationMeta(),
        active: true,
      }]
    : [];
}

function renderBookPptIntentNotice() {
  if (!bookPptIntentId) return "";
  const book = libraryState.unfilteredBooks.find((candidate) => candidate.id === bookPptIntentId);
  const title = bookPptIntentTitle
    ? `《${escapeHtml(bookPptIntentTitle)}》`
    : book
      ? `《${escapeHtml(book.title)}》`
      : "这本书";
  return `<aside class="book-ppt-intent" data-book-ppt-intent data-book-id="${escapeHtml(bookPptIntentId)}" role="status"><strong>${title}制作 PPT</strong><span>已从书籍详情带入本次意图；请在当前会话确认范围后再开始制作。</span></aside>`;
}

function renderShell(content: string, taskPanel = "") {
  return renderDesktopAppShell({
    activeSection: "conversation",
    conversationHref: conversationHref(),
    currentConversation: {
      title: workspace ? `《${workspace.book.title}》读书分享` : "老己对话",
      meta: conversationMeta(),
    },
    conversationList: conversationList(),
    mainContent: `${renderBookPptIntentNotice()}${content}`,
    taskPanel,
    connectionError: errorMessage || undefined,
  });
}

function renderWorkspaceSnapshot() {
  if (!workspace) return workspace;
  let snapshot = workspace;
  if (draftRequirementsDirty) {
    snapshot = withDraftRequirements(snapshot, draftRequirements);
  }
  if (draftOutlineDirty) {
    snapshot = withDraftOutline(snapshot, draftOutline);
  }
  return snapshot;
}

function renderLoading() {
  app.innerHTML = renderShell(
    `<section class="desktop-loading-state" aria-live="polite">
      <div class="desktop-loading-orbit" aria-hidden="true"></div>
      <p>正在恢复你的工作进度…</p>
    </section>`,
    `<section class="desktop-task-panel-inner desktop-task-loading" aria-live="polite">
      <p>当前任务</p><h2>范围与需求</h2><span>正在恢复已保存状态…</span>
    </section>`,
  );
  bindInteractions();
}

function bindInteractions() {
  document.querySelectorAll<HTMLButtonElement>('[data-stage-back], [data-stage-forward][data-stage-local="true"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const target = button.dataset.stageBack ?? button.dataset.stageForward;
      if (target && workspaceScreens.includes(target as WorkspaceScreen)) {
        setStageView(target as WorkspaceScreen);
      }
    });
  });

  document.querySelector<HTMLButtonElement>("#reconnect-workspace")?.addEventListener("click", () => {
    void loadWorkspace();
  });

  document.querySelector<HTMLFormElement>("#requirements-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    draftRequirements = String(form.get("requirements") ?? "");
    draftRequirementsDirty = true;
    persistRequirementsDraft(workspace.draft.id, draftRequirements);
    await act(async () => {
      await requestJson(`/api/v1/ppt-drafts/${workspace?.draft.id}/requirements`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: workspace?.draft.version,
          requirements: form.get("requirements"),
        }),
      });
    });
  });

  document.querySelector<HTMLTextAreaElement>("#requirements")?.addEventListener("input", (event) => {
    draftRequirements = (event.currentTarget as HTMLTextAreaElement).value;
    draftRequirementsDirty = true;
    if (workspace) persistRequirementsDraft(workspace.draft.id, draftRequirements);
  });

  const outlineForm = document.querySelector<HTMLFormElement>("#outline-form");
  const captureOutlineDraft = (form: HTMLFormElement) => {
    if (!workspace) return;
    const formData = new FormData(form);
    draftOutline = workspace.outline.map((_page, index) => ({
      title: String(formData.get(`title-${index}`) ?? "").trim(),
      body: String(formData.get(`body-${index}`) ?? "").trim(),
    }));
    draftOutlineDirty = true;
    outlineDraftStatus = "local";
    persistOutlineDraft(workspace.draft.id, draftOutline);
  };
  outlineForm?.addEventListener("input", (event) => {
    captureOutlineDraft(event.currentTarget as HTMLFormElement);
  });
  outlineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const outline: OutlineItem[] = workspace.outline.map((_page, index) => ({
      title: String(form.get(`title-${index}`) ?? "").trim(),
      body: String(form.get(`body-${index}`) ?? "").trim(),
    }));
    draftOutline = outline;
    draftOutlineDirty = true;
    outlineDraftStatus = "local";
    persistOutlineDraft(workspace.draft.id, outline);
    await act(async () => {
      await requestJson(`/api/v1/ppt-drafts/${workspace?.draft.id}/outline`, {
        method: "PUT",
        body: JSON.stringify({ expectedVersion: workspace?.draft.version, outline }),
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-template]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTemplate = button.dataset.template ?? "qingci-study";
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#submit-task")?.addEventListener("click", async () => {
    if (!workspace) return;
    const isRetry = workspace.task?.status === "failed" || workspace.task?.status === "stopped";
    const isNewTask = !workspace.task || isRetry;
    const requestKey = isNewTask
      ? crypto.randomUUID()
      : window.localStorage.getItem("selfalone-m0-request") ?? crypto.randomUUID();
    window.localStorage.setItem("selfalone-m0-request", requestKey);
    await act(async () => {
      await requestJson("/api/v1/ppt-tasks", {
        method: "POST",
        body: JSON.stringify({
          draftId: workspace?.draft.id,
          expectedVersion: workspace?.draft.version,
          idempotencyKey: requestKey,
          templateId: selectedTemplate,
        }),
      });
    });
  });

  document.querySelector<HTMLButtonElement>("#stop-task")?.addEventListener("click", async () => {
    if (!workspace?.task || stageView) return;
    await act(async () => {
      await requestJson(`/api/v1/ppt-tasks/${workspace?.task?.id}/stop`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: workspace?.task?.version }),
      });
    });
  });

  document.querySelector<HTMLButtonElement>("#refresh-workspace")?.addEventListener("click", loadWorkspace);
}

async function act(action: () => Promise<void>) {
  busy = true;
  errorMessage = "";
  render();
  try {
    await action();
    clearStageView();
    const loaded = await loadWorkspace();
    if (loaded && workspace) {
      clearRecoveredRequirements(workspace.draft.id);
      clearRecoveredOutline(workspace.draft.id);
      draftRequirementsDirty = false;
      draftOutlineDirty = false;
      outlineDraftStatus = undefined;
    }
  } catch (error) {
    errorMessage = error instanceof Error && error.message === "STALE_VERSION"
      ? "页面状态已经更新，正在为你恢复最新进度。"
      : "这一步暂时没有完成，已保留你的输入和当前进度。";
    await loadWorkspace();
  } finally {
    busy = false;
    render();
  }
}

function render() {
  if (!workspace) {
    renderLoading();
    return;
  }
  const view = renderConversationView({
    workspace: renderWorkspaceSnapshot() ?? workspace,
    busy,
    selectedTemplate,
    screenOverride: stageView ?? undefined,
    localStageView: stageView !== null,
    outlineDraftStatus,
  });
  app.innerHTML = renderShell(view.main, view.taskPanel);
  bindInteractions();
  restoreConversationScroll();
}

let activeTextReader: ReturnType<typeof mountTextReader> | null = null;

function destroyTextReader() {
  activeTextReader?.destroy();
  activeTextReader = null;
}

async function openTextReader(bookId: string, navigationId: number, initialDetailOpen = false) {
  app.innerHTML = `<main class="loading-state" aria-live="polite"><p>正在打开正文…</p></main>`;
  const api = createTextReaderApi(bookId);
  const isCurrentBookRoute = () => (
    readingBookIdFromHash(window.location.hash) === bookId
    || bookDetailIdFromHash(window.location.hash) === bookId
  );
  const onDetailClose = initialDetailOpen
    ? () => {
        if (bookDetailIdFromHash(window.location.hash) !== bookId) return;
        window.history.replaceState(null, "", "#/library");
        scheduleRouteRender();
      }
    : undefined;
  try {
    const reading = await api.loadReading();
    if (navigationId !== routeGeneration || !isCurrentBookRoute()) return;
    const prefetchedApi = {
      ...api,
      loadReading: async () => reading as TextReading,
    };
    activeTextReader = mountTextReader(app, {
      bookId,
      api: prefetchedApi,
      accountId: authState.account?.id ?? "account-development-local",
      initialDetailOpen,
      onDetailClose,
      cacheScope: {
        accountId: authState.account?.id ?? "account-development-local",
        bookId,
        fileVersion: reading.fileVersion,
      },
    });
  } catch {
    if (navigationId !== routeGeneration || !isCurrentBookRoute()) return;
    activeTextReader = mountTextReader(app, {
      bookId,
      api,
      accountId: authState.account?.id ?? "account-development-local",
      initialDetailOpen,
      onDetailClose,
    });
  }
}

function renderRoute() {
  persistConversationScroll();
  routeGeneration += 1;
  const navigationId = routeGeneration;
  if (!authRecoveryFinished) {
    if (!window.location.hash) window.history.replaceState(null, "", authHash("entry"));
    renderAuth();
    void recoverAuthSession();
    return;
  }
  if (isAuthRoute()) {
    if (authState.phase === "authenticated") {
      window.history.replaceState(null, "", "#/library");
      renderRoute();
      return;
    }
    authState = { ...authState, mode: parseAuthHash(window.location.hash).mode };
    destroyTextReader();
    renderAuth();
    return;
  }
  if (!window.location.hash) {
    window.history.replaceState(null, "", "#/library");
  }
  bookPptIntentId = bookPptIntentFromHash(window.location.hash);
  bookPptIntentTitle = bookPptIntentTitleFromHash(window.location.hash);
  const readingBookId = readingBookIdFromHash(window.location.hash);
  const bookDetailId = bookDetailIdFromHash(window.location.hash);
  if (bookDetailId) {
    destroyTextReader();
    void openTextReader(bookDetailId, navigationId, true);
    return;
  }
  if (readingBookId) {
    destroyTextReader();
    void openTextReader(readingBookId, navigationId);
    return;
  }
  if (window.location.hash.startsWith("#/library")) {
    destroyTextReader();
    renderLibrary();
    if (libraryState.loading) void loadLibrary("", "initial");
    return;
  }
  if (isSettingsRoute()) {
    destroyTextReader();
    renderSettings();
    if (settingsState.phase === "loading" && !settingsRequestInFlight) void loadSettings();
    return;
  }
  if (!isConversationRoute()) {
    window.history.replaceState(null, "", "#/library");
    renderLibrary();
    if (libraryState.loading) void loadLibrary("", "initial");
    return;
  }
  stageView = readStageViewFromHash();
  lastConversationStage = stageView;
  destroyTextReader();
  if (!workspace) {
    renderLoading();
    void loadWorkspace();
  } else {
    render();
    updatePolling();
  }
}

function scheduleRouteRender() {
  if (routeRenderFrame !== undefined) return;
  routeRenderFrame = window.requestAnimationFrame(() => {
    routeRenderFrame = undefined;
    renderRoute();
  });
}

window.addEventListener("beforeunload", () => {
  persistConversationScroll();
  destroyTextReader();
});
window.addEventListener("keydown", handleAuthDialogKeydown);
window.addEventListener("focusin", (event) => {
  if (isConversationRoute()) {
    conversationFocusKey = focusKeyForElement(event.target instanceof Element ? event.target : null) ?? conversationFocusKey;
  }
});
window.addEventListener("hashchange", scheduleRouteRender);
window.addEventListener("popstate", scheduleRouteRender);
if (!window.location.hash) window.history.replaceState(null, "", authHash("entry"));
renderRoute();
