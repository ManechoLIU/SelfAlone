import "./styles.css";
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
import type { LibraryBookSummary, LibrarySnapshot, TextReading } from "@selfalone/contracts";
import {
  authorLabel,
  bindLibrarySearchInteractions,
  coverStatusLabel,
  createLibraryPollingScheduler,
  createLatestLibraryRequest,
  libraryViewState,
  libraryBookHref,
  parseStatusLabel,
  readingBookIdFromHash,
  type LibraryLoadState,
} from "./library-state";
import { coverAssetForBook } from "./library-cover";
import { renderConversationView } from "./conversation-view";
import { createTextReaderApi, mountTextReader } from "./text-reader";
import { renderDesktopAppShell } from "./ui/desktop-shell";
import { icons } from "./ui/icons";

const workspaceScreens: WorkspaceScreen[] = ["requirements", "outline", "template", "generating", "completed", "failed", "stopped"];
const workspaceCacheStorageKey = "selfalone:m1:workspace-cache";
const conversationScrollStorageKey = "selfalone:m1:conversation-scroll";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("APP_ROOT_MISSING");
}
const app: HTMLDivElement = appRoot;

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
let routeGeneration = 0;
let conversationScrollTop = 0;
let taskScrollTop = 0;
let conversationFocusKey: string | null = null;
let routeRenderFrame: number | undefined;
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

function conversationHref() {
  return conversationHash(stageView ?? lastConversationStage);
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
  window.history.pushState(null, "", conversationHash(next));
  render();
}

function clearStageView() {
  stageView = null;
  lastConversationStage = null;
  if (window.location.hash.includes("?stage=")) {
    window.history.replaceState(null, "", conversationHash());
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
    <div class="library-shell">
      <aside class="library-rail" aria-label="主导航">
        <a class="library-brand" href="${conversationRoute}" aria-label="老己，对话首页">
          <img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="" />
          <strong>老己</strong>
        </a>
        <nav class="library-nav">
          <a href="${conversationRoute}">${icons.chat}<span>对话</span></a>
          <a class="active" href="#/library" aria-current="page">${icons.book}<span>读书</span></a>
          <span class="disabled-nav" aria-disabled="true">${icons.settings}<span>设置</span></span>
        </nav>
      </aside>
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
      const href = libraryBookHref(book);
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

function renderShell(content: string, taskPanel = "") {
  return renderDesktopAppShell({
    activeSection: "conversation",
    conversationHref: conversationHref(),
    currentConversation: {
      title: workspace ? `《${workspace.book.title}》读书分享` : "老己对话",
      meta: conversationMeta(),
    },
    conversationList: conversationList(),
    mainContent: content,
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

async function openTextReader(bookId: string, navigationId: number) {
  app.innerHTML = `<main class="loading-state" aria-live="polite"><p>正在打开正文…</p></main>`;
  const api = createTextReaderApi(bookId);
  try {
    const reading = await api.loadReading();
    if (navigationId !== routeGeneration || readingBookIdFromHash(window.location.hash) !== bookId) return;
    const prefetchedApi = {
      ...api,
      loadReading: async () => reading as TextReading,
    };
    activeTextReader = mountTextReader(app, {
      bookId,
      api: prefetchedApi,
      cacheScope: {
        accountId: "account-development-local",
        bookId,
        fileVersion: reading.fileVersion,
      },
    });
  } catch {
    if (navigationId !== routeGeneration || readingBookIdFromHash(window.location.hash) !== bookId) return;
    activeTextReader = mountTextReader(app, { bookId, api });
  }
}

function renderRoute() {
  persistConversationScroll();
  routeGeneration += 1;
  const navigationId = routeGeneration;
  if (!window.location.hash) {
    window.history.replaceState(null, "", "#/library");
  }
  const readingBookId = readingBookIdFromHash(window.location.hash);
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
window.addEventListener("focusin", (event) => {
  if (isConversationRoute()) {
    conversationFocusKey = focusKeyForElement(event.target instanceof Element ? event.target : null) ?? conversationFocusKey;
  }
});
window.addEventListener("hashchange", scheduleRouteRender);
window.addEventListener("popstate", scheduleRouteRender);
if (!window.location.hash) window.history.replaceState(null, "", "#/library");
renderRoute();
