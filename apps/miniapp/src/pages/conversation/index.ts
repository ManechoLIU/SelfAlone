import type { MiniappApp } from "../../app";
import type { PptConversationIntent } from "../../core/ppt-intent";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { wxStorage } from "../../platform";
import {
  canConfirmSelection,
  createConversationLocalStore,
  defaultSelectionIds,
  developmentConversationId,
  preserveConversationFailure,
  selectionOptionsFor,
  selectionSummary,
  toggleSelectionId,
  type ConversationLocalState,
  type ConversationScopeOption,
} from "./page-state";

type ConversationData = {
  drawerOpen: boolean;
  draft: string;
  canSend: boolean;
  boundaryMessage: string;
  keyboardOpen: boolean;
  viewportStyle: string;
  pptIntent: PptConversationIntent | null;
  selectionSheetOpen: boolean;
  selectionOptions: ConversationScopeOption[];
  selectionDraftIds: string[];
  confirmedSelectionIds: string[];
  selectionSummary: string;
  canConfirmSelection: boolean;
  selectionError: string;
  attachments: string[];
};

type ConversationImagePicker = {
  chooseMedia?: (options: {
    count: number;
    mediaType: string[];
    sourceType: string[];
    success?: (result: { tempFiles?: Array<{ tempFilePath?: string }> }) => void;
    fail?: () => void;
  }) => void;
  chooseImage?: (options: {
    count: number;
    sizeType: string[];
    sourceType: string[];
    success?: (result: { tempFilePaths?: string[] }) => void;
    fail?: () => void;
  }) => void;
};

const defaultSelectionOptions = selectionOptionsFor(defaultSelectionIds);

Page<ConversationData>({
  data: {
    drawerOpen: false,
    draft: "",
    canSend: false,
    boundaryMessage: "",
    keyboardOpen: false,
    viewportStyle: "",
    pptIntent: null,
    selectionSheetOpen: false,
    selectionOptions: defaultSelectionOptions,
    selectionDraftIds: [...defaultSelectionIds],
    confirmedSelectionIds: [],
    selectionSummary: "",
    canConfirmSelection: true,
    selectionError: "",
    attachments: [],
  },

  onLoad() {
    this.isUnloaded = false;
    const app = getApp<MiniappApp>();
    this.conversationStore = createConversationLocalStore(
      wxStorage,
      app.globalData.developmentAdapter,
    );
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (this.isUnloaded) return;
      this.setData(viewportPresentation(geometry));
    });
  },

  onShow() {
    const app = getApp<MiniappApp>();
    app.globalData.session = app.globalData.sessionStore.restore();
    if (app.globalData.session.kind === "signed-out") {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }

    this.conversationStore ??= createConversationLocalStore(
      wxStorage,
      app.globalData.developmentAdapter,
    );
    const saved = this.conversationStore.restore();
    const pptIntent = app.globalData.pptIntentStore.restore();
    const intentTaskId = pptIntent?.taskId ?? null;
    const savedForIntent = saved?.intentTaskId === intentTaskId ? saved : null;
    const confirmedSelectionIds = pptIntent?.phase === "requirements-ready"
      ? savedForIntent?.confirmedSelectionIds ?? [...defaultSelectionIds]
      : [];
    const selectionDraftIds = pptIntent?.phase === "awaiting-confirmation"
      ? savedForIntent?.selectionDraftIds.length
        ? savedForIntent.selectionDraftIds
        : savedForIntent?.confirmedSelectionIds.length
          ? savedForIntent.confirmedSelectionIds
          : [...defaultSelectionIds]
      : confirmedSelectionIds;
    const selectionSheetOpen = pptIntent?.phase === "awaiting-confirmation"
      && (savedForIntent ? savedForIntent.selectionSheetOpen : true);
    const draft = saved?.draft ?? this.data.draft;
    const attachments = saved?.attachmentPaths ?? this.data.attachments;

    this.setData({
      draft,
      canSend: Boolean(draft.trim() || attachments.length),
      attachments,
      pptIntent,
      selectionSheetOpen,
      selectionDraftIds,
      confirmedSelectionIds,
      selectionOptions: selectionOptionsFor(selectionDraftIds),
      selectionSummary: selectionSummary(confirmedSelectionIds),
      canConfirmSelection: canConfirmSelection(selectionDraftIds),
      selectionError: "",
      boundaryMessage: "",
    });
    this.persistLocalState();
  },

  toggleDrawer() { this.setData({ drawerOpen: !this.data.drawerOpen }); },

  closeDrawer() { this.setData({ drawerOpen: false }); },

  noop() {},

  onDraftInput(event: MiniappEvent<{ value: string }>) {
    const draft = event.detail.value;
    this.setData({
      draft,
      canSend: Boolean(draft.trim() || this.data.attachments.length),
      boundaryMessage: "",
    }, () => this.persistLocalState());
  },

  openSelection() {
    if (!this.data.pptIntent) return;
    const selectedIds = this.data.confirmedSelectionIds.length
      ? this.data.confirmedSelectionIds
      : this.data.selectionDraftIds.length
        ? this.data.selectionDraftIds
        : [...defaultSelectionIds];
    this.setData({
      selectionSheetOpen: true,
      selectionDraftIds: selectedIds,
      selectionOptions: selectionOptionsFor(selectedIds),
      canConfirmSelection: canConfirmSelection(selectedIds),
      selectionError: "",
    }, () => this.persistLocalState());
  },

  editSelection() { this.openSelection(); },

  closeSelection() {
    this.setData({ selectionSheetOpen: false, selectionError: "" }, () => this.persistLocalState());
  },

  toggleSelection(event: MiniappEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const selectionDraftIds = toggleSelectionId(this.data.selectionDraftIds, id);
    this.setData({
      selectionDraftIds,
      selectionOptions: selectionOptionsFor(selectionDraftIds),
      canConfirmSelection: canConfirmSelection(selectionDraftIds),
      selectionError: "",
    }, () => this.persistLocalState());
  },

  confirmSelection() {
    const selectionDraftIds = [...this.data.selectionDraftIds];
    if (!canConfirmSelection(selectionDraftIds)) {
      this.setData({ selectionError: "至少选择一项" });
      return;
    }

    const app = getApp<MiniappApp>();
    let pptIntent = this.data.pptIntent;
    if (!pptIntent) return;
    if (pptIntent.phase === "awaiting-confirmation") {
      pptIntent = app.globalData.pptIntentStore.confirm();
      if (!pptIntent) {
        this.showFailure("范围暂时无法保存，当前选择与输入仍保留。");
        return;
      }
    }

    this.setData({
      pptIntent,
      selectionSheetOpen: false,
      confirmedSelectionIds: selectionDraftIds,
      selectionOptions: selectionOptionsFor(selectionDraftIds),
      selectionSummary: selectionSummary(selectionDraftIds),
      canConfirmSelection: true,
      selectionError: "",
      boundaryMessage: "",
    }, () => this.persistLocalState());
  },

  openPptStage() {
    if (this.data.pptIntent?.phase !== "requirements-ready") return;
    const url = getApp<MiniappApp>().globalData.pptIntentStore.workspaceUrl();
    if (!url) {
      this.showFailure("PPT 工作区暂时无法打开，已保留当前范围与输入。");
      return;
    }
    wx.navigateTo({ url });
  },

  chooseImage() {
    const remaining = Math.max(0, 4 - this.data.attachments.length);
    if (!remaining) {
      this.showFailure("图片已达到上限，当前输入仍保留。");
      return;
    }
    const picker = wx as unknown as ConversationImagePicker;
    if (picker.chooseMedia) {
      picker.chooseMedia({
        count: remaining,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (result) => {
          const paths = (result.tempFiles ?? [])
            .map((file) => file.tempFilePath ?? "")
            .filter(Boolean);
          this.addAttachments(paths);
        },
        fail: () => this.showFailure("图片未能加入，当前输入仍保留。"),
      });
      return;
    }
    if (picker.chooseImage) {
      picker.chooseImage({
        count: remaining,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: (result) => this.addAttachments(result.tempFilePaths ?? []),
        fail: () => this.showFailure("图片未能加入，当前输入仍保留。"),
      });
      return;
    }
    this.showFailure("图片选择暂不可用，当前输入仍保留。");
  },

  removeAttachment(event: MiniappEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.attachments.length) return;
    const attachments = this.data.attachments.filter((_: string, itemIndex: number) => itemIndex !== index);
    this.setData({
      attachments,
      canSend: Boolean(this.data.draft.trim() || attachments.length),
      boundaryMessage: "",
    }, () => this.persistLocalState());
  },

  sendDraft() {
    if (!this.data.draft.trim() && !this.data.attachments.length) return;
    this.showFailure("暂时无法发送，输入内容已保留。");
  },

  showFailure(message: string) {
    const preserved = preserveConversationFailure(this.data, message);
    this.setData({
      ...preserved,
      selectionOptions: selectionOptionsFor(preserved.selectionDraftIds),
      canConfirmSelection: canConfirmSelection(preserved.selectionDraftIds),
    }, () => this.persistLocalState());
  },

  addAttachments(paths: string[]) {
    const attachments = [...this.data.attachments, ...paths].filter(Boolean).slice(0, 4);
    if (!attachments.length) {
      this.showFailure("图片未能加入，当前输入仍保留。");
      return;
    }
    this.setData({
      attachments,
      canSend: true,
      boundaryMessage: "",
    }, () => this.persistLocalState());
  },

  persistLocalState() {
    if (!this.conversationStore) return;
    const state: ConversationLocalState = {
      version: 1,
      conversationId: this.data.pptIntent?.conversationId ?? developmentConversationId,
      intentTaskId: this.data.pptIntent?.taskId ?? null,
      draft: this.data.draft,
      attachmentPaths: this.data.attachments,
      selectionDraftIds: this.data.selectionDraftIds,
      confirmedSelectionIds: this.data.confirmedSelectionIds,
      selectionSheetOpen: this.data.selectionSheetOpen,
    };
    this.conversationStore.save(state);
  },

  onHide() { this.persistLocalState(); },

  onUnload() {
    this.isUnloaded = true;
    this.persistLocalState();
    this.releaseViewport?.();
  },
});
