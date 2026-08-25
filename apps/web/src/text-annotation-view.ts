import { selectionToolbarPosition, textAnnotationViewState, type TextAnnotationSnapshot } from "./text-annotation-state";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type TextAnnotationLayerOptions = {
  chatHandoffAvailable?: boolean;
};

function renderSelection(snapshot: TextAnnotationSnapshot, options: TextAnnotationLayerOptions) {
  const selection = snapshot.selection;
  if (!selection) return "";
  const viewport = typeof window === "undefined"
    ? { width: 1440, height: 844 }
    : { width: window.innerWidth || 1440, height: window.innerHeight || 844 };
  const position = selectionToolbarPosition(selection.rect, {
    width: viewport.width,
    height: viewport.height,
  }, selection.avoidRects);
  if (snapshot.composer) {
    return `<form class="text-annotation-thought" data-annotation-thought-form style="left:${position.left}px;top:${position.top}px" data-placement="${position.placement}">
      <label for="text-annotation-thought-input">写下这句的想法</label>
      <textarea id="text-annotation-thought-input" rows="3" maxlength="20000" data-annotation-thought-input>${escapeHtml(snapshot.composer.body)}</textarea>
      ${snapshot.saveError ? `<p class="text-annotation-inline-error" role="alert">${escapeHtml(snapshot.saveError)}</p><button type="button" data-annotation-retry>重试保存</button>` : ""}
      <div><button type="button" data-annotation-thought-cancel>取消</button><button class="text-annotation-primary" type="submit">保存划线与想法</button></div>
    </form>`;
  }
  const chatAction = options.chatHandoffAvailable
    ? `<button type="button" data-annotation-chat aria-label="把选中文本交给老己" data-annotation-quote="${escapeHtml(selection.source.quote)}">和老己聊聊</button>`
    : `<button type="button" data-annotation-chat disabled aria-disabled="true" title="聊天入口待共享接入" aria-label="和老己聊聊（聊天入口待共享接入）" data-annotation-quote="${escapeHtml(selection.source.quote)}">和老己聊聊</button>`;
  return `<div class="text-annotation-selection-menu" data-annotation-selection-menu role="toolbar" aria-label="选中文字操作" style="left:${position.left}px;top:${position.top}px" data-placement="${position.placement}">
    <button type="button" data-annotation-highlight>划线</button>
    <button type="button" data-annotation-thought>写想法</button>
    ${chatAction}
    ${snapshot.saveError ? `<span class="text-annotation-inline-error" role="alert">${escapeHtml(snapshot.saveError)}</span><button type="button" data-annotation-retry>重试保存</button>` : ""}
  </div>`;
}

function renderAnnotationStatus(snapshot: TextAnnotationSnapshot) {
  const state = textAnnotationViewState(snapshot);
  if (state === "loading") return `<span class="text-annotation-status" role="status">正在载入划线与笔记…</span>`;
  if (state === "failure") return `<span class="text-annotation-status is-error" role="alert">${escapeHtml(snapshot.error)} <button type="button" data-annotation-reload>重试</button></span>`;
  if (snapshot.pending) return `<span class="text-annotation-status" role="status">正在保存划线…</span>`;
  if (snapshot.saveError) return `<span class="text-annotation-status is-error" role="alert">${escapeHtml(snapshot.saveError)} <button type="button" data-annotation-retry>重试</button></span>`;
  return `<span class="text-annotation-status" aria-live="polite">${snapshot.highlights.length + snapshot.notes.length ? `已保存 ${snapshot.highlights.length + snapshot.notes.length} 条记录` : ""}</span>`;
}

export function renderTextAnnotationLayer(snapshot: TextAnnotationSnapshot, options: TextAnnotationLayerOptions = {}) {
  return `<div class="text-annotation-layer" data-annotation-layer>
    <div class="text-annotation-summary"><span>正文标注</span>${renderAnnotationStatus(snapshot)}<button type="button" class="text-annotation-detail-link" data-reader-book-detail>划线与笔记</button></div>
    ${renderSelection(snapshot, options)}
  </div>`;
}

export { escapeHtml as escapeTextAnnotationHtml };
