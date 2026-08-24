import "./styles.css";
import {
  resolveScreen,
  taskProgressLabel,
  type OutlineItem,
  type WorkspaceSnapshot,
} from "./app-state";
import type { LibraryBookSummary, LibrarySnapshot } from "@selfalone/contracts";
import {
  authorLabel,
  libraryViewState,
  parseStatusLabel,
  type LibraryLoadState,
} from "./library-state";

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
let libraryPollingTimer: number | undefined;
let libraryState: LibraryLoadState = { loading: true, error: "", query: "", books: [] };
let libraryUploading = false;

const icons = {
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z"/><path d="M8 9h8M8 12h5"/></svg>`,
  book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5A3.5 3.5 0 0 1 8 2h4v17H8a3.5 3.5 0 0 0-3.5 3V5.5Z"/><path d="M19.5 5.5A3.5 3.5 0 0 0 16 2h-4v17h4a3.5 3.5 0 0 1 3.5 3V5.5Z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.4-2.6h-4L10 6a8 8 0 0 0-1.6 1.1L6 6.1 4 9.5 6.1 11a7 7 0 0 0 0 2L4 14.5l2 3.4 2.4-1A8 8 0 0 0 10 18l.5 2.6h4L15 18a8 8 0 0 0 1.6-1.1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z"/></svg>`,
  arrow: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>`,
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/></svg>`,
  retry: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.2 16.2A8 8 0 1 1 19.4 9"/></svg>`,
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function coverVariantClass(bookId: string) {
  let hash = 2166136261;
  for (const character of bookId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `cover-variant-${((hash >>> 0) % 5) + 1}`;
}

function libraryShell(content: string) {
  return `
    <div class="library-shell">
      <aside class="library-rail" aria-label="主导航">
        <a class="library-brand" href="#/conversation" aria-label="老己，对话首页">
          <img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="" />
          <strong>老己</strong>
        </a>
        <nav class="library-nav">
          <a href="#/conversation">${icons.chat}<span>对话</span></a>
          <a class="active" href="#/library" aria-current="page">${icons.book}<span>读书</span></a>
          <span class="disabled-nav" aria-disabled="true">${icons.settings}<span>设置</span></span>
        </nav>
      </aside>
      <main class="library-main">${content}</main>
      <a class="library-companion" href="#/conversation" aria-label="和老己聊聊">
        <img src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="" />
        <span>${icons.chat}</span>
      </a>
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
      <span class="empty-glyph">无</span><h2>没有找到“${escapeHtml(libraryState.query)}”</h2>
      <p>换一个书名或作者试试，书架内容不会被改动。</p>
      <button id="clear-search" class="quiet-button" type="button">清除搜索</button>
    </section>`;
  }
  if (view === "empty") {
    return `<section class="library-state empty">
      <span class="empty-glyph">书</span><h2>把第一本书放进来</h2>
      <p>支持 EPUB、TXT 和 PDF；文件会保存到你的账户，再在这里显示解析结果。</p>
      <label class="primary-button state-import" for="book-import">${icons.upload}导入书籍</label>
    </section>`;
  }
  return libraryGrid(libraryState.books);
}

function libraryGrid(books: LibraryBookSummary[]) {
  return `<section class="book-grid" aria-label="书架，共 ${books.length} 本书">
    ${books.map((book) => {
      const author = authorLabel(book.author);
      const status = parseStatusLabel(book.parseStatus, book.errorCode);
      return `<article class="book-item ${book.parseStatus}" aria-label="《${escapeHtml(book.title)}》，${escapeHtml(author)}，${escapeHtml(book.sourceLabel)}，${escapeHtml(status)}">
        <div class="default-cover ${coverVariantClass(book.id)}" role="img" aria-label="《${escapeHtml(book.title)}》默认封面">
          <strong>${escapeHtml(book.title)}</strong>
          <em>${escapeHtml(author)}</em>
          <b class="parse-badge">${escapeHtml(status)}</b>
        </div>
        <div class="book-caption">
          <span class="book-source">${icons.file}<span>${escapeHtml(book.sourceLabel)}</span></span>
        </div>
      </article>`;
    }).join("")}
  </section>`;
}

function renderLibrary() {
  const retainedError = libraryState.error && libraryState.books.length
    ? `<div class="library-inline-error" role="alert">${escapeHtml(libraryState.error)}，已保留当前书架。</div>`
    : "";
  app.innerHTML = libraryShell(`
    <h1 class="library-title">读书</h1>
    <section class="library-toolbar" aria-label="书架工具">
      <form id="library-search" role="search">
        <label class="visually-hidden" for="book-query">搜索书名或作者</label>
        <span>${icons.search}</span>
        <input id="book-query" name="query" type="search" value="${escapeHtml(libraryState.query)}" placeholder="搜索书名或作者" autocomplete="off" />
      </form>
      <label class="import-button ${libraryUploading ? "busy" : ""}" for="book-import" aria-disabled="${libraryUploading}">
        ${icons.upload}<span>${libraryUploading ? "正在保存…" : "导入书籍"}</span>
        <input class="visually-hidden" id="book-import" type="file" accept=".epub,.txt,.pdf,application/epub+zip,text/plain,application/pdf" ${libraryUploading ? "disabled" : ""} />
      </label>
    </section>
    <section class="weread-note" aria-label="微信读书连接状态">
      <div><strong>连接微信读书</strong><span>暂未开放</span></div>
      <p>本地书籍已可导入；连接能力将在账户与设置闭环中开放。</p>
    </section>
    ${retainedError}
    ${libraryStatePanel()}
  `);
  bindLibraryInteractions();
}

async function loadLibrary(query = libraryState.query) {
  libraryState = { ...libraryState, loading: libraryState.books.length === 0, error: "", query };
  renderLibrary();
  try {
    const snapshot = await requestJson<LibrarySnapshot>(`/api/v1/books?query=${encodeURIComponent(query)}`);
    libraryState = { loading: false, error: "", query, books: snapshot.books };
  } catch {
    libraryState = { ...libraryState, loading: false, error: "无法连接书架服务，请检查本地服务后重试" };
  }
  renderLibrary();
  updateLibraryPolling();
}

function updateLibraryPolling() {
  if (libraryPollingTimer) window.clearInterval(libraryPollingTimer);
  libraryPollingTimer = undefined;
  if (libraryState.books.some((book) => book.parseStatus === "processing")) {
    libraryPollingTimer = window.setInterval(() => void loadLibrary(), 700);
  }
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
    renderLibrary();
    updateLibraryPolling();
  }
}

function bindLibraryInteractions() {
  document.querySelector<HTMLFormElement>("#library-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    void loadLibrary(String(form.get("query") ?? "").trim());
  });
  document.querySelector<HTMLInputElement>("#book-import")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void uploadBook(file);
  });
  document.querySelector<HTMLButtonElement>("#retry-library")?.addEventListener("click", () => void loadLibrary());
  document.querySelector<HTMLButtonElement>("#clear-search")?.addEventListener("click", () => void loadLibrary(""));
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
  try {
    workspace = await requestJson<WorkspaceSnapshot>("/api/v1/workspace");
    if (workspace.draft.templateId) {
      selectedTemplate = workspace.draft.templateId;
    }
    errorMessage = "";
  } catch {
    errorMessage = "暂时无法连接老己服务，输入和已完成结果都不会被清空。";
  }
  render();
  updatePolling();
}

function updatePolling() {
  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  if (workspace && resolveScreen(workspace) === "generating") {
    pollingTimer = window.setInterval(loadWorkspace, 450);
  }
}

function renderShell(content: string) {
  return `
    <div class="app-shell">
      <aside class="side-rail" aria-label="主导航">
        <img class="brand-avatar" src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" />
        <nav class="rail-nav">
          <div class="rail-item active" aria-current="page">${icons.chat}<span>对话</span></div>
          <div class="rail-item muted">${icons.book}<span>读书</span></div>
          <div class="rail-item muted">${icons.settings}<span>设置</span></div>
        </nav>
        <img class="rail-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="老己坐着读书" />
      </aside>
      <section class="workspace-shell">
        <header class="topbar">
          <div>
            <p class="topbar-title">${workspace?.book.title ?? "读书与表达"}</p>
            <p class="topbar-subtitle">${workspace?.book.sourceLabel ?? "正在连接开发工作区"}</p>
          </div>
          <div class="development-flag"><span></span>开发数据</div>
        </header>
        ${errorMessage ? `<div class="error-banner" role="alert">${errorMessage}</div>` : ""}
        ${content}
      </section>
    </div>
  `;
}

function renderLoading() {
  app.innerHTML = renderShell(`
    <main class="loading-state" aria-live="polite">
      <div class="loading-orbit"></div>
      <p>正在恢复你的工作进度…</p>
    </main>
  `);
}

function stageSteps(activeIndex: number) {
  const labels = ["说明需求", "确认大纲", "选择模板", "生成演示"];
  return `<ol class="stage-steps" aria-label="PPT 生成进度">
    ${labels
      .map(
        (label, index) => `
          <li class="${index < activeIndex ? "done" : index === activeIndex ? "active" : ""}">
            <span>${index < activeIndex ? "✓" : index + 1}</span>${label}
          </li>`,
      )
      .join("")}
  </ol>`;
}

function requirementsPanel() {
  return `
    <main class="workbench two-column">
      <section class="conversation-column" aria-labelledby="conversation-title">
        <div class="section-heading">
          <p>新对话</p>
          <h1 id="conversation-title">从一本书，讲出你真正想说的</h1>
        </div>
        <div class="message-row">
          <img src="/avatar/laoji-avatar-conversation-approved-v1.png" alt="老己头像" />
          <div class="assistant-message">
            <p>这次想把《${workspace?.book.title}》讲给谁听？</p>
            <p>告诉我场景、页数和你最想留下的一个观点，我先帮你理出结构。</p>
          </div>
        </div>
        <div class="source-strip">
          <div class="book-cover">荔</div>
          <div><strong>${workspace?.book.title}</strong><span>已选为本次生成材料</span></div>
        </div>
        <form id="requirements-form" class="prompt-composer">
          <label for="requirements">你的生成要求</label>
          <textarea id="requirements" name="requirements" rows="4" required>${workspace?.draft.requirements || "为读书会生成三页分享，突出普通人的选择。"}</textarea>
          <div class="composer-actions">
            <span>生成后仍可修改大纲</span>
            <button class="primary-button" type="submit" ${busy ? "disabled" : ""}>${busy ? "正在整理…" : "生成大纲"}${icons.arrow}</button>
          </div>
        </form>
      </section>
      <aside class="progress-column">
        ${stageSteps(0)}
        <div class="quiet-note"><span>本次只生成 3 页</span><p>先跑通表达，再决定要不要继续扩写。</p></div>
      </aside>
    </main>`;
}

function outlinePanel() {
  const outline = workspace?.outline ?? [];
  return `
    <main class="workbench outline-workbench">
      <section class="outline-main">
        <div class="section-heading">
          <p>大纲草案</p>
          <h1>先看结构，再开始生成</h1>
          <span>每一页都可以直接修改。确认后，老己再把它变成演示文稿。</span>
        </div>
        <form id="outline-form">
          <div class="outline-document">
            ${outline
              .map(
                (page, index) => `
                  <div class="outline-node">
                    <div class="outline-level" aria-hidden="true">${index + 1}</div>
                    <div class="outline-fields">
                      <label>第 ${index + 1} 页标题<input name="title-${index}" value="${page.title}" required /></label>
                      <label>这一页要说什么<textarea name="body-${index}" rows="2" required>${page.body}</textarea></label>
                    </div>
                  </div>`,
              )
              .join("")}
          </div>
          <div class="sticky-action">
            <span>共 ${outline.length} 页 · 文字可编辑</span>
            <button class="primary-button" type="submit" ${busy ? "disabled" : ""}>${busy ? "正在保存…" : "确认大纲"}${icons.arrow}</button>
          </div>
        </form>
      </section>
      <aside class="progress-column">${stageSteps(1)}</aside>
    </main>`;
}

const templates = [
  { id: "qingci-study", name: "青瓷书房", note: "留白、青绿、适合读书分享" },
  { id: "paper-notes", name: "纸上札记", note: "柔和纸色、适合观点梳理" },
  { id: "ink-minimal", name: "墨色极简", note: "高对比、适合演讲投屏" },
];

function templatePanel() {
  return `
    <main class="workbench template-workbench">
      <section class="template-main">
        <div class="section-heading">
          <p>选择模板</p>
          <h1>选一个与你的表达气质相近的版式</h1>
          <span>首个闭环提供三种本地模板；生成的是可编辑 PPTX。</span>
        </div>
        <div class="template-grid" role="radiogroup" aria-label="演示文稿模板">
          ${templates
            .map(
              (template, index) => `
                <button type="button" class="template-card ${selectedTemplate === template.id ? "selected" : ""}" data-template="${template.id}" role="radio" aria-checked="${selectedTemplate === template.id}">
                  <div class="template-preview preview-${index + 1}"><span>老己</span><strong>${workspace?.book.title}</strong><i>${index + 1} / 3</i></div>
                  <div class="template-meta"><strong>${template.name}</strong><span>${template.note}</span></div>
                  <b class="selection-mark">${selectedTemplate === template.id ? "✓" : ""}</b>
                </button>`,
            )
            .join("")}
        </div>
        <div class="sticky-action template-action">
          <span>已选择「${templates.find((template) => template.id === selectedTemplate)?.name}」</span>
          <button id="submit-task" class="primary-button" type="button" ${busy ? "disabled" : ""}>${busy ? "正在创建…" : "开始生成"}${icons.arrow}</button>
        </div>
      </section>
      <aside class="progress-column">${stageSteps(2)}</aside>
    </main>`;
}

function generationPanel() {
  const task = workspace?.task;
  const screen = workspace ? resolveScreen(workspace) : "generating";
  const completed = task?.completedPages ?? 0;
  const total = task?.totalPages ?? workspace?.outline.length ?? 3;
  const isDone = screen === "completed";
  return `
    <main class="generation-workbench">
      <section class="generation-header">
        <div>
          <p>${isDone ? "生成完成" : screen === "failed" ? "生成失败" : screen === "stopped" ? "已停止" : "正在生成"}</p>
          <h1>${isDone ? "你的读书分享已经可以下载" : "老己正在把大纲变成演示文稿"}</h1>
          <span>${isDone ? "文件为原生 16:9 PPTX，标题和正文可继续编辑。" : "页面会逐张完成；刷新后会从已保存进度恢复。"}</span>
        </div>
        <div class="compact-progress"><strong>${task ? taskProgressLabel(task) : `0 / ${total}`}</strong><span>页</span></div>
      </section>
      ${stageSteps(3)}
      <section class="waterfall" aria-live="polite">
        ${(workspace?.outline ?? [])
          .filter((_page, index) => isDone || index <= completed)
          .map(
            (page, index) => `
              <article class="generation-page ${index < completed || isDone ? "complete" : "working"}">
                <div class="slide-miniature"><span>老己 · ${workspace?.book.title}</span><strong>${page.title}</strong><p>${page.body}</p><i>${index + 1} / ${total}</i></div>
                <div class="page-status"><strong>第 ${index + 1} 页 · ${page.title}</strong><span>${index < completed || isDone ? "已完成" : "正在排版"}</span></div>
              </article>`,
          )
          .join("")}
      </section>
      <div class="generation-actions">
        ${
          isDone && task?.artifactId
            ? `<a class="primary-button download-button" href="/api/v1/ppt-artifacts/${task.artifactId}/download">下载 PPTX${icons.arrow}</a>`
            : screen === "generating"
              ? `<button id="stop-task" class="secondary-button" type="button" ${busy || !task ? "disabled" : ""}>停止生成</button>`
              : `<button id="refresh-workspace" class="secondary-button" type="button">刷新状态</button>`
        }
        <span>${screen === "failed" ? "已保留需求、大纲和完成页面。" : screen === "stopped" ? "已完成页面仍然保留。" : "开发数据不会调用外部模型。"}</span>
      </div>
    </main>`;
}

function bindInteractions() {
  document.querySelector<HTMLFormElement>("#requirements-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
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

  document.querySelector<HTMLFormElement>("#outline-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const outline: OutlineItem[] = workspace.outline.map((_page, index) => ({
      title: String(form.get(`title-${index}`) ?? "").trim(),
      body: String(form.get(`body-${index}`) ?? "").trim(),
    }));
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
    const requestKey =
      window.localStorage.getItem("selfalone-m0-request") ?? crypto.randomUUID();
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
    if (!workspace?.task) return;
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
    await loadWorkspace();
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
  const screen = resolveScreen(workspace);
  const content = screen === "requirements"
    ? requirementsPanel()
    : screen === "outline"
      ? outlinePanel()
      : screen === "template"
        ? templatePanel()
        : generationPanel();
  app.innerHTML = renderShell(content);
  bindInteractions();
}

window.addEventListener("hashchange", () => window.location.reload());
if (!window.location.hash) window.history.replaceState(null, "", "#/library");
if (window.location.hash === "#/library") {
  renderLibrary();
  void loadLibrary();
} else {
  renderLoading();
  void loadWorkspace();
}
