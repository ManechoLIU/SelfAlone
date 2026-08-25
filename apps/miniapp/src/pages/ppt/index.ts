import type { MiniappApp } from "../../app";
import type { DevelopmentState, OutlineNode, PptWorkspace } from "../../adapters/client";
import { parseDevelopmentState } from "../../adapters/client";
import { isOutlineHierarchyValid, resolvePptScreen, type PptScreen } from "../../core/ppt-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";
import {
  editorPanelHeight,
  needsPptRecoverySnapshot,
  preservePptFailureContext,
  pptActionClearance,
  pptWorkspaceRetryState,
  preparePptWorkspaceForState,
} from "./page-state";

type TemplateOption = {
  id: PptWorkspace["templateId"];
  title: string;
  variant: string;
};

type PptData = {
  phase: "loading" | "ready" | "empty" | "filtered-empty" | "failed";
  error: string;
  retryingWorkspace: boolean;
  workspaceVisible: boolean;
  workspace: PptWorkspace | null;
  screen: PptScreen;
  stageIndex: number;
  stageTitle: string;
  outlineEditorOpen: boolean;
  outlineText: string;
  templates: TemplateOption[];
  rangeOptions: string[];
  purposeOptions: string[];
  audienceOptions: string[];
  purposeIndex: number;
  audienceIndex: number;
  customPurpose: boolean;
  customAudience: boolean;
  selectedTemplateTitle: string;
  saving: boolean;
  developmentAdapter: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
  actionStyle: string;
  editorStyle: string;
};

const templates: TemplateOption[] = [
  { id: "celadon-reading", title: "青瓷书简", variant: "celadon" },
  { id: "editorial-paper", title: "留白讲义", variant: "paper" },
  { id: "minimal-ink", title: "图文叙事", variant: "ink" },
  { id: "modern-minimal", title: "现代简约", variant: "modern" },
  { id: "reading-notes", title: "阅读札记", variant: "notes" },
  { id: "academic-lecture", title: "学术讲义", variant: "academic" },
];

const purposeOptions = ["读书分享", "课程讲解", "工作汇报", "自定义"];
const audienceOptions = ["读书会成员", "同事", "学生", "公开观众", "自定义"];

function choiceState(value: string, options: string[]) {
  const index = options.indexOf(value);
  const customIndex = options.length - 1;
  return index >= 0 && index < customIndex
    ? { index, custom: false }
    : { index: customIndex, custom: true };
}

function stageMeta(screen: PptScreen) {
  if (screen === "requirements") return { stageIndex: 1, stageTitle: "范围与需求" };
  if (screen === "outline") return { stageIndex: 2, stageTitle: "PPT 大纲" };
  if (screen === "template") return { stageIndex: 3, stageTitle: "选择模板" };
  return { stageIndex: 4, stageTitle: "生成 PPT" };
}

function outlineToText(outline: OutlineNode[]) {
  return outline.map((node) => `${"  ".repeat(node.level - 1)}${node.text}`).join("\n");
}

function textToOutline(value: string): OutlineNode[] {
  return value.split("\n").map((line) => {
    const leading = line.match(/^\s*/)?.[0].length ?? 0;
    const level = Math.min(3, Math.floor(leading / 2) + 1) as 1 | 2 | 3;
    return { level, text: line.trim() };
  }).filter((node) => node.text);
}

Page<PptData>({
  data: {
    phase: "loading",
    error: "",
    retryingWorkspace: false,
    workspaceVisible: false,
    workspace: null,
    screen: "requirements",
    stageIndex: 1,
    stageTitle: "范围与需求",
    outlineEditorOpen: false,
    outlineText: "",
    templates,
    rangeOptions: ["6–8 页", "8–10 页", "10–12 页", "自定义"],
    purposeOptions,
    audienceOptions,
    purposeIndex: 0,
    audienceIndex: 0,
    customPurpose: false,
    customAudience: false,
    selectedTemplateTitle: templates[0]!.title,
    saving: false,
    developmentAdapter: false,
    keyboardOpen: false,
    viewportStyle: "",
    viewportMetrics: "",
    actionStyle: "",
    editorStyle: "",
  },
  onLoad(options: { bookId?: string; state?: string; stage?: string }) {
    const app = getApp<MiniappApp>();
    this.bookId = options.bookId ? decodeURIComponent(options.bookId) : "";
    this.developmentState = parseDevelopmentState(options.state, app.globalData.developmentAdapter);
    this.previewStage = app.globalData.developmentAdapter ? options.stage : undefined;
    this.setData({ developmentAdapter: app.globalData.developmentAdapter });
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (this.isUnloaded) return;
      this.setData({
        ...viewportPresentation(geometry),
        editorStyle: `--ppt-editor-height:${editorPanelHeight(geometry.availableHeight)}px`,
      }, () => this.measureActions());
    });
    void this.loadWorkspace();
  },
  onUnload() {
    this.isUnloaded = true;
    this.releaseViewport?.();
  },
  measureActions() {
    wx.createSelectorQuery().select(".ppt-actions").boundingClientRect((rect) => {
      if (this.isUnloaded || !rect) return;
      this.setData({ actionStyle: `--ppt-action-clearance:${pptActionClearance(rect.height)}px` });
    }).exec();
  },
  async loadWorkspace(options?: { preserveShell?: boolean }) {
    const state = (this.developmentState ?? "normal") as DevelopmentState;
    if (state === "loading") {
      this.setData({ phase: "loading", error: "", retryingWorkspace: false, workspaceVisible: false });
      return;
    }
    const existingWorkspace = this.data.workspace;
    if (options?.preserveShell && existingWorkspace) this.setData({ error: "", retryingWorkspace: true });
    else this.setData({ phase: "loading", error: "", retryingWorkspace: false, workspaceVisible: false });
    let recoveryWorkspace = existingWorkspace;
    try {
      const app = getApp<MiniappApp>();
      const client = app.globalData.client;
      if (needsPptRecoverySnapshot(state, recoveryWorkspace, app.globalData.developmentAdapter)) {
        recoveryWorkspace = await client.getPptWorkspace(this.bookId, "normal");
        recoveryWorkspace = this.applyPreviewStage(recoveryWorkspace, this.previewStage);
        recoveryWorkspace = preparePptWorkspaceForState(recoveryWorkspace, state, Boolean(this.previewStage));
      }
      let workspace = await client.getPptWorkspace(this.bookId, state);
      if (state === "empty") {
        this.setData({ phase: "empty", error: "", retryingWorkspace: false, workspaceVisible: false, workspace: null });
        return;
      }
      workspace = this.applyPreviewStage(workspace, this.previewStage);
      workspace = preparePptWorkspaceForState(workspace, state, Boolean(this.previewStage));
      this.applyWorkspace(workspace, state === "filtered-empty" ? "filtered-empty" : "ready");
    } catch (error) {
      const failure = preservePptFailureContext(recoveryWorkspace, readableError(error));
      if (failure.workspace) this.applyWorkspace(failure.workspace, failure.phase, failure.error);
      else this.setData(failure);
    }
  },
  applyPreviewStage(workspace: PptWorkspace, stage?: string): PptWorkspace {
    if (!stage) return workspace;
    const next = { ...workspace, task: null } as PptWorkspace;
    if (stage === "requirements" || stage === "outline" || stage === "template") {
      next.stage = stage;
      return next;
    }
    next.stage = "submitted";
    if (stage === "failed") next.task = { status: "failed", completedPages: 2, totalPages: 6, error: "开发适配器模拟了可恢复失败" };
    else if (stage === "completed") next.task = { status: "completed", completedPages: next.previews.length, totalPages: next.previews.length };
    else if (stage === "stopped") next.task = { status: "stopped", completedPages: 2, totalPages: 6 };
    else next.task = { status: "running", completedPages: 2, totalPages: 6 };
    return next;
  },
  applyWorkspace(workspace: PptWorkspace, phase: PptData["phase"] = "ready", error = workspace.task?.error ?? "") {
    const screen = resolvePptScreen({ draft: workspace, task: workspace.task });
    const purpose = choiceState(workspace.purpose, purposeOptions);
    const audience = choiceState(workspace.audience, audienceOptions);
    this.setData({
      phase,
      error,
      retryingWorkspace: false,
      workspaceVisible: true,
      workspace,
      screen,
      ...stageMeta(screen),
      outlineText: outlineToText(workspace.outline),
      purposeIndex: purpose.index,
      audienceIndex: audience.index,
      customPurpose: purpose.custom,
      customAudience: audience.custom,
      selectedTemplateTitle: templates.find((template) => template.id === workspace.templateId)?.title ?? "未选择",
    }, () => this.measureActions());
  },
  retryWorkspace() {
    const workspace = this.data.workspace;
    this.setData(pptWorkspaceRetryState(workspace), () => {
      if (this.developmentState === "failed") this.developmentState = "normal";
      void this.loadWorkspace({ preserveShell: Boolean(workspace) });
    });
  },
  async saveWorkspace(workspace: PptWorkspace) {
    this.setData({ saving: true, error: "" });
    try {
      const saved = await getApp<MiniappApp>().globalData.client.savePptWorkspace(workspace);
      this.applyWorkspace(saved);
    } catch (error) {
      this.setData({ error: readableError(error) });
    } finally {
      this.setData({ saving: false });
    }
  },
  goBack() {
    const workspace = this.data.workspace;
    if (!workspace || this.data.screen === "requirements") {
      wx.navigateBack();
      return;
    }
    if (this.data.screen === "outline") void this.saveWorkspace({ ...workspace, stage: "requirements", task: null });
    else if (this.data.screen === "template") void this.saveWorkspace({ ...workspace, stage: "outline", task: null });
    else wx.navigateBack();
  },
  onPurpose(event: MiniappEvent<{ value: string }>) { if (this.data.workspace) this.setData({ workspace: { ...this.data.workspace, purpose: event.detail.value } }); },
  onAudience(event: MiniappEvent<{ value: string }>) { if (this.data.workspace) this.setData({ workspace: { ...this.data.workspace, audience: event.detail.value } }); },
  choosePurpose(event: MiniappEvent<{ value: string }>) {
    const workspace = this.data.workspace;
    if (!workspace) return;
    const index = Number(event.detail.value);
    const custom = index === purposeOptions.length - 1;
    this.setData({
      purposeIndex: index,
      customPurpose: custom,
      workspace: { ...workspace, purpose: custom ? "" : purposeOptions[index]! },
    });
  },
  chooseAudience(event: MiniappEvent<{ value: string }>) {
    const workspace = this.data.workspace;
    if (!workspace) return;
    const index = Number(event.detail.value);
    const custom = index === audienceOptions.length - 1;
    this.setData({
      audienceIndex: index,
      customAudience: custom,
      workspace: { ...workspace, audience: custom ? "" : audienceOptions[index]! },
    });
  },
  onExtra(event: MiniappEvent<{ value: string }>) { if (this.data.workspace) this.setData({ workspace: { ...this.data.workspace, extra: event.detail.value } }); },
  chooseRange(event: MiniappEvent) { if (this.data.workspace) this.setData({ workspace: { ...this.data.workspace, pageRange: String(event.currentTarget.dataset.value) } }); },
  confirmRequirements() { if (this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "outline" }); },
  openOutlineEditor() { this.setData({ outlineEditorOpen: true }); },
  closeOutlineEditor() { this.setData({ outlineEditorOpen: false }); },
  onOutlineInput(event: MiniappEvent<{ value: string }>) { this.setData({ outlineText: event.detail.value }); },
  completeOutlineEdit() {
    const workspace = this.data.workspace;
    const outline = textToOutline(this.data.outlineText);
    if (!workspace || !isOutlineHierarchyValid(outline)) {
      this.setData({ error: "大纲需从页面层级开始，三级内容必须归属二级小节" });
      return;
    }
    this.setData({ outlineEditorOpen: false });
    void this.saveWorkspace({ ...workspace, outline });
  },
  confirmOutline() { if (this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "template" }); },
  chooseTemplate(event: MiniappEvent) {
    if (!this.data.workspace) return;
    const templateId = String(event.currentTarget.dataset.id) as PptWorkspace["templateId"];
    this.setData({
      workspace: { ...this.data.workspace, templateId },
      selectedTemplateTitle: templates.find((template) => template.id === templateId)?.title ?? "未选择",
    });
  },
  startGeneration() {
    if (!this.data.workspace) return;
    void this.saveWorkspace({ ...this.data.workspace, stage: "submitted", task: { status: "running", completedPages: 2, totalPages: 6 } });
  },
  stopGeneration() {
    if (!this.data.workspace?.task) return;
    void this.saveWorkspace({ ...this.data.workspace, task: { ...this.data.workspace.task, status: "stopped" } });
  },
  retryGeneration() {
    if (!this.data.workspace?.task) return;
    void this.saveWorkspace({ ...this.data.workspace, task: { ...this.data.workspace.task, status: "running", error: undefined } });
  },
  modifyOutline() { if (this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "outline", task: null }); },
  changeTemplate() { if (this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "template", task: null }); },
  showTaskMenu() {
    wx.showModal({
      title: "删除失败任务？",
      content: "开发适配器只会移除当前内存中的失败状态，不影响会话、书籍或历史作品。",
      confirmText: "删除任务",
      success: (result) => { if (result.confirm && this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "outline", task: null }); },
    });
  },
  download() {
    wx.showModal({ title: "真实 PPTX 尚未接入", content: "F5 提供真实作品与下载契约后，再接入 wx.downloadFile 与 wx.openDocument。", showCancel: false });
  },
});
