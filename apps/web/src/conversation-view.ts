import {
  resolveScreen,
  taskProgressLabel,
  type WorkspaceScreen,
  type WorkspaceSnapshot,
} from "./app-state";
import { escapeHtml } from "./ui/desktop-shell";
import { icons } from "./ui/icons";

export type ConversationViewOptions = {
  workspace: WorkspaceSnapshot;
  busy: boolean;
  selectedTemplate: string;
};

export type ConversationViewResult = {
  main: string;
  taskPanel: string;
};

const templates = [
  { id: "qingci-study", name: "青瓷书房", note: "留白、青绿、适合读书分享" },
  { id: "paper-notes", name: "纸上札记", note: "柔和纸色、适合观点梳理" },
  { id: "ink-minimal", name: "墨色极简", note: "高对比、适合演讲投屏" },
];

const stageLabels = ["范围与需求", "大纲", "模板", "生成"];

function activeStage(screen: WorkspaceScreen) {
  if (screen === "requirements") return 0;
  if (screen === "outline") return 1;
  if (screen === "template") return 2;
  return 3;
}

function renderStageSteps(screen: WorkspaceScreen) {
  const activeIndex = activeStage(screen);
  return `<ol class="desktop-stage-steps" aria-label="PPT 生成进度">
    ${stageLabels.map((label, index) => `
      <li class="${index < activeIndex ? "done" : index === activeIndex ? "active" : ""}">
        <span aria-hidden="true">${index + 1}</span><strong>${label}</strong>
      </li>`).join("")}
  </ol>`;
}

function renderScopeSummary(workspace: WorkspaceSnapshot) {
  const requirements = workspace.draft.requirements.trim();
  return `
    <dl class="desktop-scope-summary">
      <div><dt>资料</dt><dd>《${escapeHtml(workspace.book.title)}》</dd></div>
      <div><dt>范围</dt><dd>${requirements ? "全书 · 包含个人笔记" : "待确认"}</dd></div>
    </dl>`;
}

function renderTaskPanel(workspace: WorkspaceSnapshot, screen: WorkspaceScreen, selectedTemplate: string) {
  const selected = templates.find((template) => template.id === selectedTemplate) ?? templates[0];
  const task = workspace.task;
  const progress = task ? taskProgressLabel(task) : `${workspace.outline.length ? workspace.outline.length : 0} 页`;
  const body = screen === "requirements"
    ? `
        <div class="desktop-confirmed-scope">
          <p>已确认范围</p>
          ${renderScopeSummary(workspace)}
        </div>
        <div class="desktop-scope-fields">
          <label for="scope-purpose">用途<select id="scope-purpose" name="purpose" disabled aria-disabled="true" aria-label="用途（暂不可用）"><option>本地示例暂不可用</option></select></label>
          <label for="scope-audience">受众<select id="scope-audience" name="audience" disabled aria-disabled="true" aria-label="受众（暂不可用）"><option>本地示例暂不可用</option></select></label>
          <label for="scope-pages">页数范围<select id="scope-pages" name="pages" disabled aria-disabled="true" aria-label="页数范围（暂不可用）"><option>本地示例暂不可用</option></select></label>
        </div>
        <p class="desktop-scope-note">用途、受众和页数暂不可用，不会进入本地示例提交与结果；本次只读取下方要求。</p>
        <button class="desktop-primary-button" type="submit" form="requirements-form">生成示例大纲${icons.arrow}</button>`
    : screen === "outline"
      ? `
        <div class="desktop-confirmed-scope">
          <p>已确认范围</p>
          ${renderScopeSummary(workspace)}
        </div>
        <p class="desktop-task-helper">逐页调整标题与正文，保存后进入模板选择。</p>`
      : screen === "template"
        ? `
          <div class="desktop-confirmed-scope">
            <p>当前选择</p>
            <strong class="desktop-selected-template">${escapeHtml(selected.name)}</strong>
            <span>${escapeHtml(selected.note)}</span>
          </div>
          <p class="desktop-task-helper">模板只影响版式，生成后标题与正文仍可在 PowerPoint 或 WPS 中编辑。</p>`
        : `
          <div class="desktop-task-status ${screen === "failed" ? "failed" : screen === "completed" ? "completed" : "running"}">
            <strong>${screen === "completed" ? "生成完成" : screen === "failed" ? "生成失败" : screen === "stopped" ? "已停止" : "正在生成"}</strong>
            <span>${escapeHtml(progress)}</span>
          </div>
          ${renderScopeSummary(workspace)}`;

  return `<section class="desktop-task-panel-inner">
    <header class="desktop-task-header">
      <p>当前任务</p>
      <h2>范围与需求</h2>
    </header>
    ${renderStageSteps(screen)}
    <div class="desktop-task-body">${body}</div>
  </section>`;
}

function renderRequirementsMain(workspace: WorkspaceSnapshot, busy: boolean) {
  return `<section class="conversation-content requirements-content" aria-labelledby="conversation-title">
    <section class="conversation-thread">
      <article class="assistant-message desktop-message">
        <p>帮我把《${escapeHtml(workspace.book.title)}》的读书笔记整理成一份读书会分享 PPT。</p>
        <time>当前会话</time>
      </article>
      <article class="assistant-message desktop-message desktop-message-question">
        <div class="desktop-message-author"><img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" /><strong>这次想重点覆盖哪些内容？</strong></div>
        <time>范围与需求</time>
        <div class="desktop-selection-summary"><span>已选择：全书 · 包含个人笔记</span><strong>已确认</strong></div>
        <p class="desktop-message-note">已同步到右侧范围与需求。</p>
      </article>
    </section>
    <form id="requirements-form" class="desktop-composer">
      <img class="desktop-conversation-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="老己坐姿持书" />
      <label for="requirements">生成要求 · 继续补充</label>
      <textarea id="requirements" name="requirements" rows="3" required placeholder="补充用途、受众或希望保留的观点">${escapeHtml(workspace.draft.requirements)}</textarea>
      <div class="desktop-composer-actions">
        <span>生成后仍可修改大纲</span>
        <span class="desktop-demo-note">本地演示 · 不调用 AI</span>
      </div>
    </form>
  </section>`;
}

function renderOutlineMain(workspace: WorkspaceSnapshot, busy: boolean) {
  return `<section class="conversation-content outline-content" aria-labelledby="outline-title">
    <section class="conversation-heading">
      <p>已确认范围</p>
      <h2 id="outline-title">先看结构，再开始生成</h2>
      <span>每一页都可以直接修改。确认后，老己再把它变成演示文稿。</span>
    </section>
    <form id="outline-form" class="desktop-outline-form">
      <div class="desktop-outline-document">
        ${workspace.outline.map((page, index) => `
          <div class="desktop-outline-node">
            <span class="desktop-outline-level" aria-hidden="true">${index + 1}</span>
            <label>第 ${index + 1} 页标题<input name="title-${index}" value="${escapeHtml(page.title)}" required /></label>
            <label>这一页要说什么<textarea name="body-${index}" rows="2" required>${escapeHtml(page.body)}</textarea></label>
          </div>`).join("")}
      </div>
      <div class="desktop-form-action">
        <span>共 ${workspace.outline.length} 页 · 文字可编辑</span>
        <button class="desktop-primary-button" type="submit" ${busy ? "disabled" : ""}>确认大纲${icons.arrow}</button>
      </div>
    </form>
  </section>`;
}

function renderTemplateMain(workspace: WorkspaceSnapshot, busy: boolean, selectedTemplate: string) {
  return `<section class="conversation-content template-content" aria-labelledby="template-title">
    <section class="conversation-heading">
      <p>大纲已确认</p>
      <h2 id="template-title">选一个与你的表达气质相近的版式</h2>
      <span>首个闭环提供三种本地模板；生成的是可编辑 PPTX。</span>
    </section>
    <div class="desktop-template-grid" role="radiogroup" aria-label="演示文稿模板">
      ${templates.map((template, index) => `
        <button type="button" class="desktop-template-card ${selectedTemplate === template.id ? "selected" : ""}" data-template="${template.id}" role="radio" aria-checked="${selectedTemplate === template.id}">
          <span class="desktop-template-preview preview-${index + 1}"><strong>${escapeHtml(template.name)}</strong><small>16:9 · ${escapeHtml(workspace.book.title)}</small></span>
          <span class="desktop-template-meta"><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.note)}</small></span>
          <span class="desktop-template-check" aria-hidden="true">${selectedTemplate === template.id ? "✓" : ""}</span>
        </button>`).join("")}
    </div>
    <div class="desktop-form-action">
      <span>已选择「${escapeHtml(templates.find((template) => template.id === selectedTemplate)?.name ?? templates[0].name)}」</span>
      <button id="submit-task" class="desktop-primary-button" type="button" ${busy ? "disabled" : ""}>开始生成${icons.arrow}</button>
    </div>
  </section>`;
}

function taskErrorLabel(error: string | undefined) {
  if (!error) return "生成未完成，已保留当前任务内容。";
  if (error === "PRESENTATION_GENERATION_FAILED") return "演示页生成未完成，已保留当前任务内容。";
  return `生成未完成（${escapeHtml(error)}），已保留当前任务内容。`;
}

function renderGenerationMain(workspace: WorkspaceSnapshot, screen: WorkspaceScreen) {
  const task = workspace.task;
  const completed = task?.completedPages ?? 0;
  const total = task?.totalPages ?? workspace.outline.length;
  const isDone = screen === "completed";
  const pages = workspace.outline
    .map((page, index) => {
      const pageComplete = isDone || index < completed;
      const pageFailed = screen === "failed" && index === completed;
      if (!pageComplete && !pageFailed) return "";
      return `<article class="desktop-generation-page ${pageComplete ? "complete" : "failed"}">
        ${pageFailed
          ? `<div class="desktop-slide-error" role="alert"><strong>第 ${index + 1} 页生成失败</strong><p>${taskErrorLabel(task?.error)}</p>${task?.error ? `<small class="desktop-error-code">错误码：${escapeHtml(task.error)}</small>` : ""}<button id="refresh-workspace" class="desktop-secondary-button" type="button">刷新状态</button></div>`
          : `<div class="desktop-slide-miniature"><span>《${escapeHtml(workspace.book.title)}》读书分享</span><strong>${escapeHtml(page.title)}</strong><p>${escapeHtml(page.body)}</p><i>${index + 1} / ${total}</i></div>`}
        <div class="desktop-page-status"><strong>第 ${index + 1} 页 · ${escapeHtml(page.title)}</strong><span>${pageComplete ? "已完成" : "生成失败"}</span></div>
      </article>`;
    })
    .join("");

  return `<section class="conversation-content generation-content" aria-labelledby="generation-title">
    <section class="conversation-heading generation-heading">
      <p>${isDone ? "生成完成" : screen === "failed" ? "生成失败" : screen === "stopped" ? "已停止" : "正在生成"}</p>
      <h2 id="generation-title">${isDone ? "你的读书分享已经可以下载" : "老己正在把大纲变成演示文稿"}</h2>
      <span>${isDone ? "文件为原生 16:9 PPTX，标题和正文可继续编辑。" : "页面会逐张完成；刷新后会从已保存进度恢复。"}</span>
    </section>
    <section class="desktop-waterfall" aria-live="polite">${pages || `<p class="desktop-empty-generation">等待任务状态…</p>`}</section>
    <div class="desktop-generation-actions">
      ${isDone && task?.artifactId
        ? `<a class="desktop-primary-button" href="/api/v1/ppt-artifacts/${task.artifactId}/download">下载 PPTX${icons.arrow}</a>`
        : screen === "generating"
          ? `<button id="stop-task" class="desktop-secondary-button" type="button" ${!task ? "disabled" : ""}>停止生成</button>`
          : screen === "failed"
            ? `<span class="desktop-retained-copy">已保留需求、大纲和已完成页面。</span>`
            : `<button id="refresh-workspace" class="desktop-secondary-button" type="button">刷新状态</button>`}
      <span class="desktop-demo-note">本地演示 · 不调用 AI</span>
    </div>
  </section>`;
}

export function renderConversationView(options: ConversationViewOptions): ConversationViewResult {
  const screen = resolveScreen(options.workspace);
  const main = screen === "requirements"
    ? renderRequirementsMain(options.workspace, options.busy)
    : screen === "outline"
      ? renderOutlineMain(options.workspace, options.busy)
      : screen === "template"
        ? renderTemplateMain(options.workspace, options.busy, options.selectedTemplate)
        : renderGenerationMain(options.workspace, screen);

  return {
    main,
    taskPanel: renderTaskPanel(options.workspace, screen, options.selectedTemplate),
  };
}
