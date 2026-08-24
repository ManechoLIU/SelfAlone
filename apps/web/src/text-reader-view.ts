import { icons } from "./ui/icons";
import {
  filterTextReaderSections,
  textReaderParagraphs,
  textReaderViewState,
  type TextReaderSnapshot,
} from "./text-reader-state";

const readerIcons = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  directory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>',
  background: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 100 18 7 7 0 010-18z"/></svg>',
  focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/></svg>',
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDirectory(snapshot: TextReaderSnapshot) {
  if (!snapshot.directoryOpen) return "";
  const sections = filterTextReaderSections(snapshot.sections, snapshot.query);
  const content = sections.length
    ? `<ol>${sections.map((section) => `<li>
        <button type="button" data-reader-jump="${escapeHtml(section.sectionId)}">
          <span>${String(section.order + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}
        </button>
      </li>`).join("")}</ol>`
    : `<div class="text-reader-directory-empty" role="status">
        ${icons.search}<strong>目录中没有找到“${escapeHtml(snapshot.query)}”</strong>
        <span>清除搜索后可查看全部章节。</span>
      </div>`;
  return `<aside id="text-reader-directory" class="text-reader-directory" role="dialog" aria-modal="false" aria-label="目录">
    <header><strong>目录</strong><button type="button" data-reader-directory-close aria-label="关闭目录">×</button></header>
    <label for="text-reader-directory-query">搜索章节</label>
    <div class="text-reader-directory-search">${icons.search}<input id="text-reader-directory-query" type="search" value="${escapeHtml(snapshot.query)}" autocomplete="off" /></div>
    ${content}
  </aside>`;
}

function renderState(snapshot: TextReaderSnapshot) {
  const state = textReaderViewState(snapshot);
  if (state === "loading") {
    return `<section class="text-reader-state" aria-live="polite">
      <div class="text-reader-loading" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <p>正在展开正文与上次阅读位置…</p>
    </section>`;
  }
  if (state === "failure") {
    return `<section class="text-reader-state is-failure" role="alert">
      <span>${icons.retry}</span><h1>正文暂时没有载入</h1><p>${escapeHtml(snapshot.error)}</p>
      <button class="text-reader-primary" type="button" data-reader-reload>重新载入</button>
    </section>`;
  }
  if (state === "filtered_empty") {
    return `<section class="text-reader-state" role="status">
      <span>${icons.search}</span><h1>没有找到“${escapeHtml(snapshot.query)}”</h1>
      <p>清除搜索后可继续阅读，当前位置不会改变。</p>
    </section>`;
  }
  if (state === "empty") {
    return `<section class="text-reader-state" role="status">
      <span>${icons.book}</span><h1>这本书没有可读正文</h1>
      <p>目录和正文均为空；返回书架可查看解析状态或重新导入。</p>
      <a class="text-reader-primary" href="#/library">返回书架</a>
    </section>`;
  }

  return `<article class="text-reader-document" aria-label="《${escapeHtml(snapshot.reading?.title ?? "书籍")}》正文">
    ${snapshot.sections.map((section) => `<section class="text-reader-section" data-section-id="${escapeHtml(section.sectionId)}" aria-labelledby="reader-title-${section.order}">
      <header><span>第 ${section.order + 1} 节</span><h2 id="reader-title-${section.order}">${escapeHtml(section.title)}</h2></header>
      <div class="text-reader-prose">
        ${textReaderParagraphs(section).map((paragraph) => `<p data-reader-paragraph data-section-id="${escapeHtml(section.sectionId)}" data-offset="${paragraph.offset}">${escapeHtml(paragraph.text).replaceAll("\n", "<br />")}</p>`).join("")}
      </div>
    </section>`).join("")}
  </article>`;
}

export function renderTextReader(snapshot: TextReaderSnapshot) {
  const background = snapshot.background;
  const backgroundClass = `is-${background}`;
  const hasContent = !snapshot.loading && !snapshot.error && snapshot.sections.length > 0;
  const unavailable = hasContent ? "" : " disabled";
  const focusLabel = snapshot.focusMode ? "退出专注阅读" : "进入专注阅读";
  const saveStatus = snapshot.saveError
    ? `${escapeHtml(snapshot.saveError)} <button type="button" data-reader-retry-save>重试保存</button>`
    : "阅读位置已保存";
  const directoryControls = snapshot.directoryOpen ? ' aria-controls="text-reader-directory"' : "";
  return `<div class="text-reader-shell${snapshot.focusMode ? " is-focus" : ""} ${backgroundClass}" data-reader-background="${background}">
    <aside class="text-reader-rail" aria-label="主导航">
      <a class="text-reader-brand" href="#/conversation" aria-label="老己，对话首页">
        <img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="" /><strong>老己</strong>
      </a>
      <nav>
        <a href="#/conversation">${icons.chat}<span>对话</span></a>
        <a class="active" href="#/library" aria-current="page">${icons.book}<span>读书</span></a>
        <span aria-disabled="true">${icons.settings}<span>设置</span></span>
      </nav>
    </aside>
    <main class="text-reader-main" tabindex="0" aria-label="正文阅读区">
      <header class="text-reader-toolbar" aria-label="阅读工具">
        <a class="text-reader-icon" href="#/library" aria-label="返回书架">${readerIcons.back}</a>
        <div class="text-reader-heading"><strong>${escapeHtml(snapshot.reading?.title ?? "正文阅读")}</strong><span>${escapeHtml(snapshot.reading?.author ?? "作者未知")}</span></div>
        <div class="text-reader-actions">
          <button class="text-reader-icon" type="button" data-reader-directory aria-label="打开目录"${directoryControls} aria-expanded="${snapshot.directoryOpen}"${unavailable}>${readerIcons.directory}</button>
          <button class="text-reader-icon" type="button" data-reader-background aria-label="切换阅读背景" aria-pressed="${background === "dark"}"${unavailable}>${readerIcons.background}</button>
          <button class="text-reader-icon text-reader-copy" type="button" data-reader-copy aria-label="复制所选正文" disabled>${readerIcons.copy}<span>复制所选</span></button>
          <a class="text-reader-selected-chat" data-reader-chat href="#/conversation" aria-label="把所选正文交给老己" hidden>${icons.chat}<span>和老己聊聊</span></a>
          <button class="text-reader-icon" type="button" data-reader-focus aria-label="${focusLabel}" aria-pressed="${snapshot.focusMode}"${unavailable}>${readerIcons.focus}</button>
        </div>
      </header>
      <div class="text-reader-save-status${snapshot.saveError ? " is-error" : ""}" aria-live="polite">${saveStatus}</div>
      <div class="text-reader-canvas">${renderState(snapshot)}</div>
      <div class="text-reader-copy-status" aria-live="polite">${snapshot.copied ? "已复制所选正文" : ""}</div>
    </main>
    ${renderDirectory(snapshot)}
  </div>`;
}
