import type { MiniappApp } from "../../app";
import type {
  DevelopmentState,
  OutlineNode,
  PptDraftSnapshot,
  PptOutlineSnapshot,
  PptPublicSource,
  PptWorkspace,
} from "../../adapters/client";
import { parseDevelopmentState } from "../../adapters/client";
import { isOutlineHierarchyValid, resolvePptScreen, type PptScreen } from "../../core/ppt-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";
import {
  countOutlinePages,
  editorPanelHeight,
  isPptOutlineUnavailableError,
  isPptStaleError,
  needsPptRecoverySnapshot,
  outlinePageLabels,
  outlineParagraphsToText,
  outlineTextToParagraphs,
  PPT_CUSTOM_RANGE_LABEL,
  PPT_OUTLINE_AUTOSAVE_DELAY_MS,
  PPT_PAGE_RANGE_PRESETS,
  pptActionClearance,
  pptPageRangeLabel,
  preservePptFailureContext,
  pptWorkspaceRetryState,
  preparePptWorkspaceForState,
  validatePptRequirementsForm,
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
  /** Sent-intent draft mode bound to the frozen Server PPT workspace contract. */
  draftMode: boolean;
  generatingOutline: boolean;
  rangeCustom: boolean;
  rangeMin: string;
  rangeMax: string;
  outlinePageCount: number;
  outlineHint: string;
  outlineDisplay: Array<{ level: 1 | 2 | 3; text: string; pageLabel: string }>;
  outlineSources: PptPublicSource[];
  editorSaveState: "idle" | "saving" | "saved" | "failed";
  editorStatus: string;
  editorError: string;
  outlineConflict: boolean;
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
const DEFAULT_PURPOSE = "读书分享";
const DEFAULT_AUDIENCE = "读书会成员";
const DRAFT_OUTLINE_REFRESH_ATTEMPTS = 3;

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

function draftWorkspaceSnapshot(snapshot: PptDraftSnapshot, outline: PptOutlineSnapshot): PptWorkspace {
  const requirements = snapshot.draft.requirements;
  return {
    draftId: snapshot.draft.id,
    version: snapshot.draft.version,
    stage: outline.paragraphs.length > 0 ? "outline" : "requirements",
    bookId: snapshot.sources[0].bookId,
    bookTitle: snapshot.sources[0].title,
    purpose: requirements.purpose ?? DEFAULT_PURPOSE,
    audience: requirements.audience ?? DEFAULT_AUDIENCE,
    pageRange: pptPageRangeLabel(requirements.pageRange),
    extra: requirements.additionalRequirements,
    outline: outline.paragraphs.map(({ level, text }) => ({ level, text })),
    templateId: "celadon-reading",
    task: null,
    previews: [],
  };
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
    rangeOptions: [...PPT_PAGE_RANGE_PRESETS],
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
    draftMode: false,
    generatingOutline: false,
    rangeCustom: false,
    rangeMin: "",
    rangeMax: "",
    outlinePageCount: 0,
    outlineHint: "",
    outlineDisplay: [],
    outlineSources: [],
    editorSaveState: "idle",
    editorStatus: "",
    editorError: "",
    outlineConflict: false,
  },
  onLoad(options: { bookId?: string; state?: string; stage?: string; conversationId?: string; requestId?: string }) {
    const app = getApp<MiniappApp>();
    this.bookId = options.bookId ? decodeURIComponent(options.bookId) : "";
    this.conversationId = options.conversationId ? decodeURIComponent(options.conversationId) : "";
    this.requestId = options.requestId ? decodeURIComponent(options.requestId) : "";
    this.draftMode = Boolean(this.bookId && this.conversationId && this.requestId);
    this.draftSnapshot = null;
    this.adoptedOutline = null;
    this.outlineDirty = false;
    this.outlineAutosaveTimer = undefined;
    this.outlineRefreshRequest = 0;
    this.outlineInputGeneration = 0;
    this.developmentState = parseDevelopmentState(options.state, app.globalData.developmentAdapter);
    this.previewStage = app.globalData.developmentAdapter && !this.draftMode ? options.stage : undefined;
    this.setData({
      developmentAdapter: app.globalData.developmentAdapter,
      draftMode: this.draftMode,
    });
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
    if (this.outlineAutosaveTimer) clearTimeout(this.outlineAutosaveTimer);
    this.releaseViewport?.();
  },
  measureActions() {
    wx.createSelectorQuery().select(".ppt-actions").boundingClientRect((rect) => {
      if (this.isUnloaded || !rect) return;
      this.setData({ actionStyle: `--ppt-action-clearance:${pptActionClearance(rect.height)}px` });
    }).exec();
  },
  async loadWorkspace(options?: { preserveShell?: boolean }) {
    if (this.draftMode) {
      await this.loadDraftWorkspace(options);
      return;
    }
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
  async loadDraftWorkspace(options?: { preserveShell?: boolean }) {
    const existingWorkspace = this.data.workspace;
    if (options?.preserveShell && existingWorkspace) this.setData({ error: "", retryingWorkspace: true });
    else this.setData({ phase: "loading", error: "", retryingWorkspace: false, workspaceVisible: false });
    try {
      const client = getApp<MiniappApp>().globalData.client;
      const created = await client.createPptDraft({
        conversationId: this.conversationId,
        requestId: this.requestId,
        bookId: this.bookId,
      });
      const outline = await client.getPptOutline(created.workspace.draft.id);
      this.applyDraftWorkspace(created.workspace, outline);
    } catch (error) {
      const failure = preservePptFailureContext(existingWorkspace, readableError(error));
      if (failure.workspace) this.applyWorkspace(failure.workspace, failure.phase, failure.error);
      else this.setData(failure);
    }
  },
  applyDraftWorkspace(snapshot: PptDraftSnapshot, outline: PptOutlineSnapshot) {
    this.draftSnapshot = snapshot;
    this.adoptedOutline = outline;
    const workspace = draftWorkspaceSnapshot(snapshot, outline);
    const purpose = choiceState(workspace.purpose, purposeOptions);
    const audience = choiceState(workspace.audience, audienceOptions);
    this.applyWorkspace(workspace);
    this.setData({
      draftMode: true,
      rangeCustom: workspace.pageRange === PPT_CUSTOM_RANGE_LABEL,
      rangeMin: snapshot.draft.requirements.pageRange?.min?.toString() ?? "",
      rangeMax: snapshot.draft.requirements.pageRange?.max?.toString() ?? "",
      outlinePageCount: outline.pageCount,
      outlineHint: outline.paragraphs.length ? "可直接编辑连续分层文本" : "确认需求后将生成大纲",
      outlineSources: [...outline.publicSources],
      purposeIndex: purpose.index,
      audienceIndex: audience.index,
      customPurpose: purpose.custom,
      customAudience: audience.custom,
      editorSaveState: "idle",
      editorStatus: "",
      editorError: "",
      outlineConflict: false,
    });
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
    const pageLabels = outlinePageLabels(workspace.outline);
    this.setData({
      phase,
      error,
      retryingWorkspace: false,
      workspaceVisible: true,
      workspace,
      screen,
      ...stageMeta(screen),
      outlineText: outlineToText(workspace.outline),
      outlineDisplay: workspace.outline.map((node, index) => ({ ...node, pageLabel: pageLabels[index] ?? "" })),
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
  async refreshDraftOutline() {
    const snapshot = this.draftSnapshot as PptDraftSnapshot | null;
    if (!snapshot) return;
    const refreshRequest = (this.outlineRefreshRequest ?? 0) + 1;
    const inputGeneration = this.outlineInputGeneration ?? 0;
    this.outlineRefreshRequest = refreshRequest;
    this.setData({ editorSaveState: "saving", editorStatus: "正在刷新…", editorError: "" });
    try {
      const client = getApp<MiniappApp>().globalData.client;
      let workspace: PptDraftSnapshot | undefined;
      let outline: PptOutlineSnapshot | undefined;
      for (let attempt = 0; attempt < DRAFT_OUTLINE_REFRESH_ATTEMPTS; attempt += 1) {
        const nextWorkspace = await client.getPptDraftWorkspace(snapshot.draft.id);
        const nextOutline = await client.getPptOutline(snapshot.draft.id);
        if (nextWorkspace.draft.version === nextOutline.version) {
          workspace = nextWorkspace;
          outline = nextOutline;
          break;
        }
      }
      if (!workspace || !outline) throw new Error("大纲在刷新期间持续更新，请稍后重试。");
      if (this.outlineRefreshRequest !== refreshRequest || (this.outlineInputGeneration ?? 0) !== inputGeneration) return;
      this.outlineDirty = false;
      this.applyDraftWorkspace(workspace, outline);
      this.setData({ editorSaveState: "idle", editorStatus: "已刷新为最新大纲", editorError: "", outlineConflict: false });
    } catch (error) {
      if (this.outlineRefreshRequest !== refreshRequest || (this.outlineInputGeneration ?? 0) !== inputGeneration) return;
      this.setData({
        editorSaveState: "failed",
        editorStatus: "刷新失败",
        editorError: `${readableError(error)}，当前编辑内容仍保留。`,
      });
    }
  },
  retryDraftOutlineSave() {
    void this.saveDraftOutline();
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
  chooseRange(event: MiniappEvent) {
    if (!this.data.workspace) return;
    const pageRange = String(event.currentTarget.dataset.value);
    this.setData({
      workspace: { ...this.data.workspace, pageRange },
      rangeCustom: this.draftMode && pageRange === PPT_CUSTOM_RANGE_LABEL,
    });
  },
  onRangeMin(event: MiniappEvent<{ value: string }>) { this.setData({ rangeMin: event.detail.value }); },
  onRangeMax(event: MiniappEvent<{ value: string }>) { this.setData({ rangeMax: event.detail.value }); },
  confirmRequirements() {
    if (this.draftMode) {
      void this.saveDraftRequirements();
      return;
    }
    if (this.data.workspace) void this.saveWorkspace({ ...this.data.workspace, stage: "outline" });
  },
  async saveDraftRequirements() {
    const workspace = this.data.workspace;
    const snapshot = this.draftSnapshot as PptDraftSnapshot | null;
    if (!workspace || !snapshot) return;
    const validation = validatePptRequirementsForm({
      purpose: workspace.purpose,
      audience: workspace.audience,
      pageRangeLabel: workspace.pageRange,
      rangeMin: this.data.rangeMin,
      rangeMax: this.data.rangeMax,
    });
    if ("error" in validation) {
      this.setData({ error: validation.error });
      return;
    }
    this.setData({ saving: true, error: "", generatingOutline: false });
    try {
      const client = getApp<MiniappApp>().globalData.client;
      const saved = await client.savePptRequirements(snapshot.draft.id, {
        expectedVersion: snapshot.draft.version,
        purpose: workspace.purpose,
        audience: workspace.audience,
        pageRange: validation.pageRange,
        additionalRequirements: workspace.extra,
      });
      this.draftSnapshot = saved;
      this.setData({ generatingOutline: true });
      const outline = await client.generatePptOutline(saved.draft.id, { expectedVersion: saved.draft.version });
      this.applyDraftWorkspace({
        ...saved,
        draft: { ...saved.draft, version: outline.version },
      }, outline);
    } catch (error) {
      this.setData({ error: readableError(error) });
    } finally {
      this.setData({ saving: false, generatingOutline: false });
    }
  },
  openOutlineEditor() {
    this.setData({
      outlineEditorOpen: true,
      editorError: "",
      editorStatus: this.draftMode ? "准备自动保存" : "",
    });
  },
  closeOutlineEditor() {
    // A failed save in draft mode keeps its edits and error context open until
    // the user retries the save or refreshes the authoritative outline.
    if (this.draftMode && this.outlineDirty && this.data.editorSaveState === "failed") return;
    this.setData({ outlineEditorOpen: false });
  },
  onOutlineInput(event: MiniappEvent<{ value: string }>) {
    this.setData({ outlineText: event.detail.value });
    if (!this.draftMode) return;
    this.outlineInputGeneration = (this.outlineInputGeneration ?? 0) + 1;
    this.outlineDirty = true;
    if (this.outlineAutosaveTimer) clearTimeout(this.outlineAutosaveTimer);
    this.setData({ editorSaveState: "saving", editorStatus: "正在保存…", editorError: "", outlineConflict: false });
    this.outlineAutosaveTimer = setTimeout(() => { void this.saveDraftOutline(); }, PPT_OUTLINE_AUTOSAVE_DELAY_MS);
  },
  async saveDraftOutline(options?: { closeWhenSaved?: boolean }) {
    const snapshot = this.draftSnapshot as PptDraftSnapshot | null;
    const previous = (this.adoptedOutline as PptOutlineSnapshot | null)?.paragraphs ?? [];
    if (!snapshot || !this.outlineDirty) {
      if (options?.closeWhenSaved) this.setData({ outlineEditorOpen: false });
      return;
    }
    const submittedText = this.data.outlineText;
    const paragraphs = outlineTextToParagraphs(submittedText, previous);
    if (!paragraphs.length || !isOutlineHierarchyValid(paragraphs)) {
      this.setData({
        editorSaveState: "failed",
        editorStatus: "未保存",
        editorError: "大纲需从页面层级开始，三级内容必须归属二级小节",
      });
      return;
    }
    this.outlineDirty = false;
    this.setData({ editorSaveState: "saving", editorStatus: "正在保存…", editorError: "" });
    try {
      const outline = await getApp<MiniappApp>().globalData.client.savePptOutline(snapshot.draft.id, {
        expectedVersion: snapshot.draft.version,
        paragraphs,
      });
      const savedSnapshot = { ...snapshot, draft: { ...snapshot.draft, version: outline.version } };
      if (this.data.outlineText === submittedText) {
        this.applyDraftWorkspace(savedSnapshot, outline);
        this.setData({ editorSaveState: "saved", editorStatus: "已自动保存" });
        if (options?.closeWhenSaved) this.setData({ outlineEditorOpen: false });
      } else {
        // A newer edit arrived while this save was in flight: only advance the
        // authoritative version and let the pending autosave persist that edit.
        this.draftSnapshot = savedSnapshot;
        this.adoptedOutline = outline;
        this.outlineDirty = true;
        const workspace = this.data.workspace;
        this.setData({
          workspace: workspace ? { ...workspace, version: outline.version } : workspace,
          outlinePageCount: outline.pageCount,
          outlineSources: [...outline.publicSources],
          editorSaveState: "saving",
          editorStatus: "正在保存…",
        });
      }
    } catch (error) {
      this.outlineDirty = true;
      if (isPptStaleError(error)) {
        this.setData({
          editorSaveState: "failed",
          editorStatus: "保存冲突",
          editorError: "大纲已在别处更新，请刷新后重试；当前编辑内容仍保留。",
          outlineConflict: true,
        });
      } else {
        this.setData({
          editorSaveState: "failed",
          editorStatus: "保存失败",
          editorError: `${isPptOutlineUnavailableError(error) ? "大纲服务暂不可用" : readableError(error)}，当前编辑内容仍保留。`,
        });
      }
    }
  },
  completeOutlineEdit() {
    if (this.draftMode) {
      void this.saveDraftOutline({ closeWhenSaved: true });
      return;
    }
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
