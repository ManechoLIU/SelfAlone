import type { WeReadAnnotation, WeReadBook } from "@selfalone/contracts";
import type { WeReadState } from "./weread-state";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function phaseLabel(state: WeReadState) {
  if (state.phase === "loading") return "正在读取同步状态…";
  if (state.phase === "saving") return "正在保存连接…";
  if (state.phase === "syncing") return "正在同步微信读书…";
  if (state.phase === "failed") return "同步失败，已保留已有数据";
  return state.connection ? "已连接" : "未连接";
}

function renderBookCover(book: WeReadBook) {
  return book.coverUrl
    ? `<img class="weread-book-cover" src="${escapeHtml(book.coverUrl)}" alt="" />`
    : `<div class="weread-book-cover weread-book-cover--empty" role="img" aria-label="暂无《${escapeHtml(book.title)}》封面">暂无封面</div>`;
}

function renderAnnotation(annotation: WeReadAnnotation) {
  return `<article class="weread-annotation" data-weread-annotation-id="${escapeHtml(annotation.externalId)}">
    <blockquote>“${escapeHtml(annotation.quote)}”</blockquote>
    ${annotation.thought ? `<p>${escapeHtml(annotation.thought)}</p>` : ""}
    ${annotation.location ? `<span>${escapeHtml(annotation.location)}</span>` : ""}
  </article>`;
}

function renderBookCard(state: WeReadState, book: WeReadBook) {
  const selected = state.selectedBookExternalId === book.externalId;
  const notes = state.annotations[book.externalId] ?? [];
  const progress = book.progressPercent === null ? "进度未同步" : `已读 ${book.progressPercent}%`;
  return `<button class="weread-book-card${selected ? " selected" : ""}" type="button" data-weread-action="select-book" data-weread-book-id="${escapeHtml(book.externalId)}" aria-pressed="${selected}">
    ${renderBookCover(book)}
    <span class="weread-book-card__copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author ?? "作者未知")}</small><small>${progress} · ${notes.length} 条划线</small></span>
  </button>`;
}

function renderSelectedAnnotations(state: WeReadState) {
  const selectedId = state.selectedBookExternalId ?? state.books[0]?.externalId;
  if (!selectedId) return `<p class="weread-empty-note">同步后，微信读书中的划线和想法会显示在这里。</p>`;
  const selectedBook = state.books.find((book) => book.externalId === selectedId);
  const notes = state.annotations[selectedId] ?? [];
  return `<section class="weread-annotations" aria-labelledby="weread-annotations-title">
    <div class="weread-section-heading"><h3 id="weread-annotations-title">${selectedBook ? `《${escapeHtml(selectedBook.title)}》的划线与想法` : "划线与想法"}</h3><span>${notes.length} 条</span></div>
    ${notes.length ? notes.map(renderAnnotation).join("") : `<p class="weread-empty-note">这本书还没有同步到划线或想法。</p>`}
  </section>`;
}

export function renderWeReadSettings(state: WeReadState) {
  const connected = Boolean(state.connection);
  const submitLabel = state.phase === "saving" ? "正在保存…" : connected ? "保存并重新同步" : "连接并同步";
  return `<section class="weread-settings-detail" data-weread-settings aria-labelledby="weread-settings-title">
    <button class="settings-back" type="button" data-settings-action="back">返回设置</button>
    <div class="settings-detail-heading">
      <span class="settings-eyebrow">外部服务</span>
      <h2 id="weread-settings-title">微信读书</h2>
      <p>连接后会同步你的书架、阅读进度、划线与想法。当前接缝使用本地同步数据，不调用真实微信读书服务。</p>
    </div>
    <div class="weread-connection-summary" data-weread-connection-status="${connected ? "connected" : "disconnected"}">
      <strong>${escapeHtml(phaseLabel(state))}</strong>
      ${state.connection ? `<span>Key ${escapeHtml(state.connection.apiKeyHint)} · 账号已关联</span>` : `<span>还没有连接微信读书</span>`}
    </div>
    ${state.error ? `<p class="settings-form-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
    <form class="weread-connection-form" data-weread-connection-form novalidate>
      <label class="settings-field" for="weread-api-key"><span>${connected ? "新的 API Key" : "微信读书 API Key"}</span><input id="weread-api-key" name="apiKey" type="password" autocomplete="off" value="${escapeHtml(state.draftApiKey)}" aria-describedby="weread-api-key-help" /></label>
      <p id="weread-api-key-help" class="weread-form-help">Key 只用于当前连接操作，成功后仅保存掩码，不会写入本地恢复数据。</p>
      <button class="settings-primary" data-weread-action="save-connection" type="submit"${state.phase === "saving" ? " disabled" : ""}>${submitLabel}</button>
    </form>
    ${connected ? `<div class="weread-settings-actions"><button class="settings-secondary" type="button" data-weread-action="sync-books"${state.phase === "syncing" ? " disabled" : ""}>${state.phase === "syncing" ? "正在同步…" : "立即同步书架"}</button><button class="settings-secondary" type="button" data-weread-action="disconnect">解除连接</button></div>` : ""}
    <div class="weread-settings-data">
      <div class="weread-section-heading"><h3>已同步书籍</h3><span>${state.books.length} 本</span></div>
      ${state.books.length ? `<div class="weread-book-list">${state.books.map((book) => renderBookCard(state, book)).join("")}</div>` : `<p class="weread-empty-note">连接后会在这里看到你的微信读书书架。</p>`}
      ${renderSelectedAnnotations(state)}
    </div>
  </section>`;
}

export function renderWeReadLibrary(state: WeReadState, disconnectedHeading = "连接微信读书") {
  const connected = Boolean(state.connection);
  const entry = connected
    ? `<button class="weread-inline-action" type="button" data-weread-action="open-settings">修改连接</button><button class="weread-inline-action" type="button" data-weread-action="sync-books"${state.phase === "syncing" ? " disabled" : ""}>${state.phase === "syncing" ? "正在同步…" : "同步书架"}</button>`
    : `<button class="weread-inline-action" type="button" data-weread-action="open-settings" data-weread-intent="connect">连接并同步</button>`;
  const error = state.error
    ? `<div class="weread-inline-error" role="alert"><span>${escapeHtml(state.error)}</span>${connected ? `<button class="weread-inline-action" type="button" data-weread-action="retry-sync">重试同步</button>` : ""}</div>`
    : "";
  return `<section class="weread-library" data-weread-library aria-labelledby="weread-library-title">
    <div class="weread-library__heading"><div><span class="library-eyebrow">微信读书</span><h2 id="weread-library-title">${connected ? "同步书架" : escapeHtml(disconnectedHeading)}</h2><p>${connected ? `${escapeHtml(phaseLabel(state))} · ${state.books.length} 本书` : "把你的微信读书书架带回老己"}</p></div><div class="weread-library__actions">${entry}</div></div>
    ${error}
    ${state.books.length ? `<div class="weread-book-list weread-book-list--library">${state.books.map((book) => renderBookCard(state, book)).join("")}</div>${renderSelectedAnnotations(state)}` : `<div class="weread-library__empty"><p>${state.phase === "loading" ? "正在读取微信读书数据…" : "连接后，书封、阅读进度、划线和想法会在这里显示。"}</p></div>`}
  </section>`;
}
