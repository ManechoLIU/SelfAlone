import type { TextHighlight, TextNote } from "@selfalone/contracts";
import type { BookDetailSnapshot } from "./book-detail-state";
import { icons } from "./ui/icons";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function sourceMeta(source: TextNote["source"] | TextHighlight) {
  if (!source) return "独立记录";
  return `原文位置 · ${source.locator.offset}–${source.endOffset} 字`;
}

function renderHighlight(highlight: TextHighlight) {
  return `<article class="book-detail-highlight-row" data-highlight-id="${escapeHtml(highlight.id)}">
    <blockquote>${escapeHtml(highlight.quote)}</blockquote>
    <div class="book-detail-row-meta"><span>${sourceMeta(highlight)}</span><time datetime="${escapeHtml(highlight.createdAt)}">${dateLabel(highlight.createdAt)}</time></div>
    ${highlight.thought ? `<p class="book-detail-thought">${escapeHtml(highlight.thought)}</p>` : `<p class="book-detail-muted">还没有写下想法</p>`}
  </article>`;
}

function renderNote(note: TextNote) {
  return `<article class="book-detail-note-row" data-note-id="${escapeHtml(note.id)}">
    ${note.source ? `<blockquote>${escapeHtml(note.source.quote)}</blockquote><div class="book-detail-row-meta"><span>${sourceMeta(note.source)}</span><time datetime="${escapeHtml(note.createdAt)}">${dateLabel(note.createdAt)}</time></div>` : `<div class="book-detail-row-meta"><span>独立记录</span><time datetime="${escapeHtml(note.createdAt)}">${dateLabel(note.createdAt)}</time></div>`}
    <p class="book-detail-note-body">${escapeHtml(note.body).replaceAll("\n", "<br />")}</p>
    <div class="book-detail-row-actions"><button type="button" data-book-detail-edit-note="${escapeHtml(note.id)}">编辑</button><button type="button" data-book-detail-delete-note="${escapeHtml(note.id)}">删除</button></div>
  </article>`;
}

function renderDraft(snapshot: BookDetailSnapshot) {
  const draft = snapshot.draft;
  if (!draft) return "";
  return `<form class="book-detail-note-editor" data-book-detail-form>
    <label for="book-detail-note-body">${draft.mode === "edit" ? "编辑笔记" : "写下此刻的想法"}</label>
    <textarea id="book-detail-note-body" name="body" rows="6" required>${escapeHtml(draft.body)}</textarea>
    ${snapshot.saveError ? `<div class="book-detail-save-error" role="alert">${escapeHtml(snapshot.saveError)} <button type="button" data-book-detail-retry>重试保存</button></div>` : ""}
    <div class="book-detail-editor-actions"><button type="button" data-book-detail-cancel>取消</button><button class="book-detail-primary" type="submit">保存笔记</button></div>
  </form>`;
}

export function renderBookDetail(snapshot: BookDetailSnapshot) {
  if (!snapshot.open) return "";
  if (snapshot.loading && snapshot.fileVersion === null) {
    return `<section class="book-detail-private" data-book-detail-panel role="dialog" aria-modal="true" aria-label="书籍详情" tabindex="-1"><div class="book-detail-state" role="status">正在载入划线与笔记…</div></section>`;
  }
  if (snapshot.error && snapshot.fileVersion === null) {
    return `<section class="book-detail-private" data-book-detail-panel role="dialog" aria-modal="true" aria-label="书籍详情" tabindex="-1"><button type="button" class="book-detail-close" data-book-detail-close aria-label="返回正文">×</button><div class="book-detail-state is-error" role="alert"><strong>书籍内容暂时没有载入</strong><span>${escapeHtml(snapshot.error)}</span><button type="button" data-book-detail-reload>重新载入</button></div></section>`;
  }
  const activeTab = snapshot.activeTab ?? "highlights";
  const highlightsSelected = activeTab === "highlights";
  const notesSelected = activeTab === "notes";
  const pptSelected = activeTab === "ppt";
  const cover = snapshot.coverSrc
    ? `<div class="book-detail-cover" data-book-detail-cover role="img" aria-label="《${escapeHtml(snapshot.title)}》封面"><img src="${escapeHtml(snapshot.coverSrc)}" alt="" /><strong>${escapeHtml(snapshot.title)}</strong><em>${escapeHtml(snapshot.author)}</em></div>`
    : "";
  const pptCta = snapshot.pptHref
    ? `<a class="book-detail-ppt-cta" data-book-detail-ppt-cta href="${escapeHtml(snapshot.pptHref)}">基于本书制作 PPT${icons.arrow}</a>`
    : "";
  return `<section class="book-detail-private" data-book-detail-panel role="dialog" aria-modal="true" aria-labelledby="book-detail-heading" tabindex="-1">
    <header class="book-detail-header">
      <button type="button" class="book-detail-close" data-book-detail-close aria-label="返回正文">×</button>
      <div class="book-detail-book-context">
        ${cover}
        <div><span class="book-detail-kicker">读书</span><h1 id="book-detail-heading">《${escapeHtml(snapshot.title)}》</h1><p>${escapeHtml(snapshot.author)}</p></div>
      </div>
      <div class="book-detail-header-actions">
        ${pptCta}
        ${snapshot.draft ? `<button type="button" class="book-detail-secondary" data-book-detail-cancel>收起编辑</button>` : `<button type="button" class="book-detail-primary" data-book-detail-new-note>新建笔记</button>`}
      </div>
    </header>
    <nav class="book-detail-tabs" aria-label="书籍内容入口">
      <a class="book-detail-tab-link" data-book-detail-read href="${escapeHtml(snapshot.readingHref ?? "#/library")}">阅读</a>
      <div class="book-detail-tablist" role="tablist" aria-label="标注内容">
        <button type="button" role="tab" id="book-detail-tab-highlights" data-book-detail-tab="highlights" aria-controls="book-detail-panel-highlights" aria-selected="${String(highlightsSelected)}" tabindex="${highlightsSelected ? "0" : "-1"}">划线与想法</button>
        <button type="button" role="tab" id="book-detail-tab-notes" data-book-detail-tab="notes" aria-controls="book-detail-panel-notes" aria-selected="${String(notesSelected)}" tabindex="${notesSelected ? "0" : "-1"}">老己笔记</button>
        <button type="button" role="tab" id="book-detail-tab-ppt" data-book-detail-tab="ppt" aria-controls="book-detail-panel-ppt" aria-selected="${String(pptSelected)}" tabindex="${pptSelected ? "0" : "-1"}">PPT作品</button>
      </div>
    </nav>
    <div class="book-detail-flow">
      <section class="book-detail-section book-detail-tabpanel" id="book-detail-panel-highlights" role="tabpanel" aria-labelledby="book-detail-tab-highlights"${highlightsSelected ? "" : " hidden"}><h2 id="book-detail-highlights-title">划线与想法</h2>${snapshot.highlights.length ? snapshot.highlights.map(renderHighlight).join("") : `<p class="book-detail-empty">还没有划线，回到正文选中一句话就能留下它。</p>`}</section>
      <section class="book-detail-section book-detail-tabpanel" id="book-detail-panel-notes" role="tabpanel" aria-labelledby="book-detail-tab-notes"${notesSelected ? "" : " hidden"}><h2 id="book-detail-notes-title">老己笔记</h2>${renderDraft(snapshot)}${snapshot.notes.length ? snapshot.notes.map(renderNote).join("") : `<p class="book-detail-empty">还没有老己笔记。</p>`}</section>
      <section class="book-detail-section book-detail-tabpanel" id="book-detail-panel-ppt" role="tabpanel" aria-labelledby="book-detail-tab-ppt"${pptSelected ? "" : " hidden"}><h2 id="book-detail-ppt-title">PPT作品</h2><div class="book-detail-ppt-empty"><p class="book-detail-empty">还没有 PPT 作品。</p><span>完成制作后，作品会回到这里。</span>${pptCta}</div></section>
      ${snapshot.deleteError ? `<p class="book-detail-save-error" role="alert">${escapeHtml(snapshot.deleteError)}</p>` : ""}
    </div>
  </section>`;
}

export { escapeHtml as escapeBookDetailHtml };
