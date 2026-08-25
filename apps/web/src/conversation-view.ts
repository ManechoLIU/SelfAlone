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
  screenOverride?: WorkspaceScreen;
  localStageView?: boolean;
  outlineDraftStatus?: "local";
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

function taskPanelTitle(workspace: WorkspaceSnapshot, screen: WorkspaceScreen) {
  const task = workspace.task;
  const total = task?.totalPages ?? workspace.outline.length;
  const current = Math.min((task?.completedPages ?? 0) + 1, Math.max(total, 1));
  if (screen === "requirements") return "范围与需求";
  if (screen === "outline") return "大纲";
  if (screen === "template") return "选择模板";
  if (screen === "completed") return `已生成${task?.completedPages ?? total}页`;
  if (screen === "failed") return `生成在第${current}/${Math.max(total, 1)}页中断`;
  if (screen === "stopped") return `生成在第${current}/${Math.max(total, 1)}页停止`;
  return `正在生成第${current}/${Math.max(total, 1)}页`;
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

function renderRevisionNotice(workspace: WorkspaceSnapshot) {
  return workspace.staleTask
    ? `<p class="desktop-revision-note" role="status">上一版生成结果已失效；已完成内容仍保留在历史任务中。确认修改后的范围、大纲和模板后可重新生成。</p>`
    : "";
}

function renderRequirementsWorkspace(workspace: WorkspaceSnapshot, localStageView: boolean) {
  const action = localStageView
    ? `<button class="desktop-primary-button" type="submit" form="requirements-form" data-stage-forward="outline">保存范围并继续${icons.arrow}</button>`
    : `<button class="desktop-primary-button" type="submit" form="requirements-form" data-stage-forward="outline">生成示例大纲${icons.arrow}</button>`;
  return `
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
    ${renderRevisionNotice(workspace)}
    ${localStageView ? `<p class="desktop-local-stage-note">当前回到前序阶段；提交后会写入老己服务，后续阶段需要重新确认。</p>` : ""}
    ${action}`;
}

function renderOutlineWorkspace(workspace: WorkspaceSnapshot, busy: boolean, localStageView: boolean, outlineDraftStatus?: "local") {
  const action = localStageView
    ? `<button class="desktop-primary-button" type="submit" data-stage-forward="template" ${busy ? "disabled" : ""}>确认并保存大纲${icons.arrow}</button>`
    : `<button class="desktop-primary-button" type="submit" data-stage-forward="template" ${busy ? "disabled" : ""}>确认大纲${icons.arrow}</button>`;
  return `
    <div class="desktop-task-stage-copy">
      <strong>大纲已生成</strong>
      <span>逐页调整标题与正文，保存后进入模板选择。</span>
    </div>
    ${renderRevisionNotice(workspace)}
    ${outlineDraftStatus === "local" ? `<p class="desktop-local-draft-note" role="status"><strong>本地草稿 · 尚未保存</strong><span>确认大纲后才会写入老己服务；刷新或断网恢复会继续保留这份本地编辑。</span></p>` : ""}
    ${localStageView && outlineDraftStatus !== "local" ? `<p class="desktop-local-stage-note">当前回到前序阶段；确认并保存后会写入老己服务，后续阶段需要重新确认。</p>` : ""}
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
        <button class="desktop-secondary-button" type="button" data-stage-back="requirements">返回范围与需求</button>
        ${action}
      </div>
    </form>`;
}

function renderTemplateWorkspace(workspace: WorkspaceSnapshot, busy: boolean, selectedTemplate: string, localStageView: boolean) {
  const selected = templates.find((template) => template.id === selectedTemplate) ?? templates[0];
  const action = localStageView
    ? `<button id="submit-task" class="desktop-primary-button" type="button" data-stage-forward="generating" ${busy ? "disabled" : ""}>重新生成${icons.arrow}</button>`
    : `<button id="submit-task" class="desktop-primary-button" type="button" data-stage-forward="generating" ${busy ? "disabled" : ""}>开始生成${icons.arrow}</button>`;
  return `
    <div class="desktop-task-stage-copy">
      <strong>大纲已确认</strong>
      <span>首个闭环提供三种本地模板；生成的是可编辑 PPTX。</span>
    </div>
    ${renderRevisionNotice(workspace)}
    <div class="desktop-template-grid" role="radiogroup" aria-label="演示文稿模板">
      ${templates.map((template, index) => `
        <button type="button" class="desktop-template-card ${selectedTemplate === template.id ? "selected" : ""}" data-template="${template.id}" role="radio" aria-checked="${selectedTemplate === template.id}">
          <span class="desktop-template-preview preview-${index + 1}"><strong>${escapeHtml(template.name)}</strong><small>16:9 · ${escapeHtml(workspace.book.title)}</small></span>
          <span class="desktop-template-meta"><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.note)}</small></span>
          <span class="desktop-template-check" aria-hidden="true">${selectedTemplate === template.id ? "✓" : ""}</span>
        </button>`).join("")}
    </div>
    <div class="desktop-form-action">
      <span>已选择「${escapeHtml(selected.name)}」</span>
      <button class="desktop-secondary-button" type="button" data-stage-back="outline">返回大纲</button>
      ${action}
    </div>`;
}

function taskErrorLabel(error: string | undefined) {
  if (!error) return "生成未完成，已保留当前任务内容。";
  if (error === "PRESENTATION_GENERATION_FAILED") return "演示页生成未完成，已保留当前任务内容。";
  return `生成未完成（${escapeHtml(error)}），已保留当前任务内容。`;
}

function renderGenerationWorkspace(workspace: WorkspaceSnapshot, screen: WorkspaceScreen) {
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
  const currentIndex = completed;
  const skeleton = screen === "generating" && total > 0 && completed < total
    ? `<article class="desktop-generation-page current">
        <div class="desktop-slide-skeleton" role="status" aria-label="第 ${currentIndex + 1} 页正在生成"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>
        <div class="desktop-page-status"><strong>第 ${currentIndex + 1} 页 · 正在生成</strong><span>生成中</span></div>
      </article>`
    : "";
  const renderedPages = `${pages}${skeleton}`;

  return `
    <div class="desktop-task-stage-copy">
      <strong>${isDone ? "生成完成" : screen === "failed" ? "生成失败" : screen === "stopped" ? "已停止" : "正在生成"}</strong>
      <span>${isDone ? "文件为原生 16:9 PPTX，标题和正文可继续编辑。" : "页面会逐张完成；刷新后会从已保存进度恢复。"}</span>
    </div>
    <div class="desktop-task-status ${screen === "failed" ? "failed" : screen === "completed" ? "completed" : "running"}">
      <strong>${isDone ? "生成完成" : screen === "failed" ? "生成失败" : screen === "stopped" ? "已停止" : "正在生成"}</strong>
      <span>${task ? escapeHtml(taskProgressLabel(task)) : `${workspace.outline.length} 页`}</span>
    </div>
    <section class="desktop-waterfall" aria-live="polite">${renderedPages || `<p class="desktop-empty-generation">等待任务状态…</p>`}</section>
    <div class="desktop-generation-actions">
      ${screen === "failed"
        ? `<button class="desktop-secondary-button" type="button" data-stage-back="outline">修改大纲</button><button class="desktop-secondary-button" type="button" data-stage-back="template">重新生成</button>`
        : `<button class="desktop-secondary-button" type="button" data-stage-back="template">返回模板</button>`}
      ${isDone && task?.artifactId
        ? `<a class="desktop-primary-button" href="/api/v1/ppt-artifacts/${task.artifactId}/download">下载 PPTX${icons.arrow}</a>`
        : screen === "generating"
          ? `<button id="stop-task" class="desktop-secondary-button" type="button" ${!task ? "disabled" : ""}>停止生成</button>`
          : screen === "failed"
            ? `<span class="desktop-retained-copy">已保留需求、大纲和已完成页面。</span>`
            : `<button id="refresh-workspace" class="desktop-secondary-button" type="button">刷新状态</button>`}
      <span class="desktop-demo-note">本地演示 · 不调用 AI</span>
    </div>`;
}

function renderTaskPanel(workspace: WorkspaceSnapshot, screen: WorkspaceScreen, busy: boolean, selectedTemplate: string, localStageView: boolean, outlineDraftStatus?: "local") {
  const body = screen === "requirements"
    ? renderRequirementsWorkspace(workspace, localStageView)
    : screen === "outline"
      ? renderOutlineWorkspace(workspace, busy, localStageView, outlineDraftStatus)
      : screen === "template"
        ? renderTemplateWorkspace(workspace, busy, selectedTemplate, localStageView)
        : renderGenerationWorkspace(workspace, screen);
  const title = taskPanelTitle(workspace, screen);
  const eyebrow = screen === "requirements" ? "当前任务" : "制作 PPT";

  return `<section class="desktop-task-panel-inner" data-current-stage="${screen}" data-stage-title="${title}">
    <header class="desktop-task-header">
      <p>${eyebrow}</p>
      <h2>${title}</h2>
    </header>
    ${renderStageSteps(screen)}
    <div class="desktop-task-body">${body}</div>
  </section>`;
}

function renderRequirementsThread(workspace: WorkspaceSnapshot) {
  return `<article class="assistant-message desktop-message">
      <p>帮我把《${escapeHtml(workspace.book.title)}》的读书笔记整理成一份读书会分享 PPT。</p>
      <time>当前会话</time>
    </article>
    <article class="assistant-message desktop-message desktop-message-question">
      <div class="desktop-message-author"><img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" /><strong>这次想重点覆盖哪些内容？</strong></div>
      <time>范围与需求</time>
      <div class="desktop-selection-summary"><span>已选择：全书 · 包含个人笔记</span><strong>已确认</strong></div>
      <p class="desktop-message-note">已同步到右侧范围与需求。</p>
    </article>`;
}

function renderStageThread(workspace: WorkspaceSnapshot, screen: WorkspaceScreen) {
  const copy = screen === "outline"
    ? ["范围已确认，接下来编辑大纲。", "大纲内容已移到右侧工作区，可逐页调整。"]
    : screen === "template"
      ? ["大纲已确认，接下来选择版式。", "模板选择已移到右侧工作区，中心保留会话上下文。"]
      : screen === "completed"
        ? ["演示文稿已生成。", "已完成页面和下载入口保留在右侧工作区。"]
        : screen === "failed"
          ? ["这次生成没有完成。", "已保留需求、大纲和已完成页面；失败页、错误信息和重试入口在右侧工作区。"]
          : screen === "stopped"
            ? ["生成已停止。", "已保存进度保留在右侧工作区，可刷新后继续查看。"]
            : ["正在生成演示文稿。", "生成进度保留在右侧工作区，中心继续显示会话。"];
  return `<article class="assistant-message desktop-message">
      <p>《${escapeHtml(workspace.book.title)}》读书分享</p>
      <time>当前会话 · ${stageLabels[activeStage(screen)]}</time>
    </article>
    <article class="assistant-message desktop-message desktop-message-question">
      <div class="desktop-message-author"><img src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" /><strong>${copy[0]}</strong></div>
      <p class="desktop-message-note">${copy[1]}</p>
    </article>`;
}

function renderStageSummary(workspace: WorkspaceSnapshot, screen: WorkspaceScreen) {
  const summary = screen === "requirements"
    ? "范围与需求 · 生成示例大纲在右侧工作区"
    : screen === "outline"
    ? `已确认范围 · ${workspace.outline.length} 页大纲`
    : screen === "template"
      ? "大纲已确认 · 模板选择在右侧工作区"
      : screen === "completed"
        ? "生成完成 · 已保留下载与已完成页面"
        : screen === "failed"
          ? "生成失败 · 已保留当前任务内容"
          : screen === "stopped"
            ? "生成已停止 · 已保留当前任务内容"
            : "生成中 · 进度在右侧工作区实时保留";
  return `<aside class="desktop-stage-summary" aria-label="当前阶段摘要"><strong>${summary}</strong><span>右侧工作区只显示当前阶段的完整内容。</span></aside>`;
}

function renderConversationComposer(workspace: WorkspaceSnapshot, screen: WorkspaceScreen, busy: boolean) {
  const canEditRequirements = screen === "requirements" || screen === "stopped";
  const helper = screen === "stopped"
    ? "停止后可修改要求"
    : canEditRequirements
      ? "生成后仍可修改大纲"
      : "当前阶段内容请在右侧工作区查看";
  const saveAction = screen === "stopped"
    ? `<button class="desktop-secondary-button" type="submit" ${busy ? "disabled" : ""}>保存修改要求</button>`
    : "";
  return `<form id="requirements-form" class="desktop-composer" aria-busy="${busy}">
      <img class="desktop-conversation-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="老己坐姿持书" />
      <label for="requirements">生成要求 · 继续补充</label>
      <textarea id="requirements" name="requirements" rows="3" required ${canEditRequirements ? "" : "readonly aria-readonly=\"true\""} placeholder="补充用途、受众或希望保留的观点">${escapeHtml(workspace.draft.requirements)}</textarea>
      <div class="desktop-composer-actions">
        <span>${helper}</span>
        ${saveAction}
        <span class="desktop-demo-note">本地演示 · 不调用 AI</span>
      </div>
    </form>`;
}

function renderConversationMain(workspace: WorkspaceSnapshot, screen: WorkspaceScreen, busy: boolean) {
  const thread = screen === "requirements"
    ? renderRequirementsThread(workspace)
    : renderStageThread(workspace, screen);
  return `<section class="conversation-content ${screen}-content" aria-label="会话内容">
    <section class="conversation-thread">${thread}</section>
    ${renderStageSummary(workspace, screen)}
    ${renderConversationComposer(workspace, screen, busy)}
  </section>`;
}

export function renderConversationView(options: ConversationViewOptions): ConversationViewResult {
  const screen = options.screenOverride ?? resolveScreen(options.workspace);
  return {
    main: renderConversationMain(options.workspace, screen, options.busy),
    taskPanel: renderTaskPanel(options.workspace, screen, options.busy, options.selectedTemplate, options.localStageView ?? false, options.outlineDraftStatus),
  };
}
