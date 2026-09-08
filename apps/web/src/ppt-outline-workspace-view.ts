import { escapeHtml } from "./ui/desktop-shell";
import type { PptOutlineParagraph } from "./ppt-outline-workspace-client";
import {
  countOutlinePages,
  type PptOutlineWorkspaceState,
} from "./ppt-outline-workspace-state";

export type PptOutlineViewSource = {
  title: string;
  author: string | null;
};

export type PptOutlineWorkspaceViewOptions = {
  source?: PptOutlineViewSource | null;
};

const gripSvg = `<svg class="ppt-outline-grip-icon" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" focusable="false"><circle cx="2.5" cy="2.5" r="1.3" fill="currentColor"/><circle cx="7.5" cy="2.5" r="1.3" fill="currentColor"/><circle cx="2.5" cy="8" r="1.3" fill="currentColor"/><circle cx="7.5" cy="8" r="1.3" fill="currentColor"/><circle cx="2.5" cy="13.5" r="1.3" fill="currentColor"/><circle cx="7.5" cy="13.5" r="1.3" fill="currentColor"/></svg>`;
const pointBulletSvg = `<svg class="ppt-outline-bullet" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const detailBulletSvg = `<svg class="ppt-outline-bullet" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="2.2" fill="currentColor"/></svg>`;

export function renderPptOutlineWorkspaceView(
  state: PptOutlineWorkspaceState,
  options: PptOutlineWorkspaceViewOptions = {},
) {
  if (state.phase !== "ready") return "";
  const source = options.source ?? null;
  const pageCount = countOutlinePages(state.paragraphs);

  return `<section class="desktop-task-panel-inner ppt-outline-workspace" data-current-stage="outline" data-stage-title="大纲" aria-labelledby="ppt-outline-title">
    <header class="desktop-task-header"><p>当前任务</p><h2 id="ppt-outline-title">大纲</h2></header>
    <ol class="desktop-stage-steps" aria-label="PPT 生成进度">
      <li class="done"><span aria-hidden="true">1</span><strong>范围与需求</strong></li>
      <li class="active" aria-current="step"><span aria-hidden="true">2</span><strong>大纲</strong></li>
      <li class=""><span aria-hidden="true">3</span><strong>模板</strong></li>
      <li class=""><span aria-hidden="true">4</span><strong>生成</strong></li>
    </ol>
    <div class="desktop-task-body">
      ${source ? `<p class="ppt-outline-source">来源：${escapeHtml(source.title)}${source.author ? ` · ${escapeHtml(source.author)}` : ""}</p>` : ""}
      <p class="ppt-outline-pagecount" role="status" data-ppt-outline-pagecount>${renderPageCount(pageCount)}</p>
      <div class="ppt-outline-editor" data-ppt-outline-editor role="group" aria-label="大纲连续编辑">
        ${renderPptOutlineRows(state)}
      </div>
      <p class="ppt-outline-editor-help">Enter 分段，Tab / Shift+Tab 调整层级，Esc 离开编辑器</p>
      ${renderProvenance(state)}
      ${renderSaveStatus(state)}
    </div>
    <footer class="ppt-outline-actions">
      <button type="button" class="ppt-outline-back" data-ppt-outline-back>返回修改需求</button>
    </footer>
  </section>`;
}

export function renderPptOutlineRows(state: PptOutlineWorkspaceState & { phase: "ready" }) {
  const rows = state.paragraphs.length > 0
    ? state.paragraphs
    : [{ id: "ppt-outline-first-page", level: 1 as const, text: "" }];
  let pageNumber = 0;
  return rows.map((paragraph) => {
    if (paragraph.level === 1) pageNumber += 1;
    return renderPptOutlineRow(paragraph, pageNumber, state.orphanIds.includes(paragraph.id));
  }).join("");
}

function renderPptOutlineRow(paragraph: PptOutlineParagraph, pageNumber: number, orphan: boolean) {
  const levelLabel = paragraph.level === 1 ? `第 ${pageNumber} 页` : paragraph.level === 2 ? "要点" : "说明";
  const marker = paragraph.level === 1
    ? `<span class="ppt-outline-grip" aria-hidden="true">${gripSvg}</span><span class="ppt-outline-index" aria-hidden="true">${pageNumber}.</span>`
    : `<span class="ppt-outline-marker" aria-hidden="true">${paragraph.level === 2 ? pointBulletSvg : detailBulletSvg}</span>`;
  return `<div class="ppt-outline-paragraph" data-level="${paragraph.level}" data-paragraph-id="${escapeHtml(paragraph.id)}">
      ${marker}
      <textarea class="ppt-outline-text" data-ppt-outline-text rows="1" maxlength="2000" autocomplete="off" spellcheck="false" aria-label="${levelLabel}">${escapeHtml(paragraph.text)}</textarea>
      ${orphan ? `<p class="ppt-outline-orphan-hint" data-ppt-outline-orphan="${escapeHtml(paragraph.id)}" role="alert">需要页面层级才能确认大纲</p>` : ""}
    </div>`;
}

function renderPageCount(pageCount: number) {
  return `当前 ${pageCount} 页`;
}

function renderProvenance(state: PptOutlineWorkspaceState & { phase: "ready" }) {
  if (state.publicSources.length === 0) return "";
  const titles = state.publicSources.map((source) => escapeHtml(source.title)).join(" · ");
  return `<p class="ppt-outline-provenance" data-ppt-outline-provenance>已参考公开资料：${titles}</p>`;
}

function renderSaveStatus(state: PptOutlineWorkspaceState & { phase: "ready" }) {
  if (state.saveBlocked) {
    return `<p class="ppt-outline-status ppt-outline-status-blocked" role="status" data-ppt-outline-status>存在失去页面层级的段落，恢复层级后才会自动保存</p>`;
  }
  if (state.saveStatus === "failed") {
    return `<p class="ppt-outline-status ppt-outline-status-error" role="alert" data-ppt-outline-status>保存失败，当前修改已保留在页面中。<button type="button" data-ppt-outline-retry>重试</button></p>`;
  }
  if (state.saveStatus === "recovering") {
    return `<p class="ppt-outline-status" role="status" data-ppt-outline-status>正在恢复最新版本…</p>`;
  }
  if (state.saveStatus === "pending" || state.saveStatus === "saving") {
    return `<p class="ppt-outline-status" role="status" data-ppt-outline-status>正在保存…</p>`;
  }
  return `<p class="ppt-outline-status" role="status" data-ppt-outline-status>已自动保存</p>`;
}

export const pptOutlineInternal = { renderSaveStatus, renderPageCount };
