import type { MiniappApp } from "../../app";
import type {
  ConversationApiSendResult,
  ConversationApiSession,
} from "../../adapters/conversation";
import type { PptConversationIntent } from "../../core/ppt-intent";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { wxStorage } from "../../platform";
import {
  canConfirmSelection,
  completeConversationSend,
  conversationStorageScope,
  createConversationLocalStore,
  defaultSelectionIds,
  developmentConversationReply,
  developmentConversationId,
  failConversationSend,
  preserveConversationFailure,
  selectionOptionsFor,
  selectionSummary,
  startConversationSend,
  toggleSelectionId,
  type ConversationLocalState,
  type ConversationMessage,
  type ConversationPendingSend,
  type ConversationScopeOption,
} from "./page-state";

type ConversationData = {
  drawerOpen: boolean;
  drawerConversations: DrawerConversation[];
  conversationId: string;
  draft: string;
  canSend: boolean;
  boundaryMessage: string;
  keyboardOpen: boolean;
  viewportStyle: string;
  pptIntent: PptConversationIntent | null;
  pptHandoff: PptConversationIntent | null;
  selectionSheetOpen: boolean;
  selectionOptions: ConversationScopeOption[];
  selectionDraftIds: string[];
  confirmedSelectionIds: string[];
  selectionSummary: string;
  canConfirmSelection: boolean;
  selectionError: string;
  attachments: string[];
  messages: ConversationMessage[];
  pendingSend: ConversationPendingSend | null;
  sending: boolean;
  sendStatus: "idle" | "sending" | "failed";
  messageAnchor: string;
};

type DrawerConversation = {
  id: string;
  title: string;
  current?: boolean;
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

const DEVELOPMENT_LONG_LIST_SIZE = 18;
const productionConversationPlaceholder = "production-pending-conversation";

type ConversationApiFailure = Extract<ConversationApiSendResult, { status: "failed" }>;

type ConversationSendOutcome =
  | { status: "completed"; reply: string; session?: ConversationApiSession }
  | ConversationApiFailure;

function createConversationStore(app: MiniappApp) {
  const { session } = app.globalData;
  return createConversationLocalStore(wxStorage, {
    enabled: session.kind !== "signed-out",
    ...(session.kind === "authenticated" ? { scope: conversationStorageScope(session) } : {}),
  });
}

function pendingFromApiSession(session: ConversationApiSession): ConversationPendingSend | null {
  const lastUser = [...session.context]
    .reverse()
    .find((entry) => entry.role === "user" && Boolean(entry.requestId));
  const requestId = lastUser?.requestId ?? session.activeRun?.requestId;
  const draftText = session.draft?.text ?? lastUser?.text;
  if (!requestId || draftText === undefined) return null;
  if (!session.draft && !session.activeRun) return null;
  return {
    id: requestId,
    draft: draftText,
    attachmentPaths: [...(session.draft?.attachments ?? [])],
  };
}

function mapApiSessionMessages(
  session: ConversationApiSession,
  fallback: readonly ConversationMessage[],
  pending: ConversationPendingSend | null,
): ConversationMessage[] {
  const pendingId = pending?.id;
  const mapped = session.context
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .map((entry): ConversationMessage => {
      const isPending = Boolean(
        pendingId
        && (entry.requestId === pendingId
          || entry.id === `${pendingId}:user`
          || entry.id === `${pendingId}:assistant`),
      );
      const role: ConversationMessage["role"] = entry.role === "user" ? "user" : "assistant";
      const id = isPending && pendingId && role === "user"
        ? pendingId
        : isPending && pendingId && role === "assistant"
          ? `${pendingId}-reply`
          : entry.id;
      return {
        id,
        role,
        text: entry.text,
        attachments: isPending && role === "user" ? [...(pending?.attachmentPaths ?? [])] : [],
        status: "sent",
        ...(role === "assistant" && (entry.requestId || isPending)
          ? { replyTo: entry.requestId ?? pendingId }
          : {}),
      };
    });
  return mapped.length ? mapped : [...fallback];
}

function apiReplyFor(
  session: ConversationApiSession,
  pending: ConversationPendingSend | null,
) {
  if (!pending) return undefined;
  return session.context.find((entry) => entry.role === "assistant"
    && (entry.requestId === pending.id || entry.id === `${pending.id}:assistant`))?.text;
}

function markPendingMessage(
  messages: readonly ConversationMessage[],
  pending: ConversationPendingSend | null,
  status: "sending" | "failed",
) {
  if (!pending) return [...messages];
  return messages.map((message) => message.id === pending.id && message.role === "user"
    ? { ...message, status }
    : message);
}

function createDevelopmentLongConversationList(): DrawerConversation[] {
  return Array.from({ length: DEVELOPMENT_LONG_LIST_SIZE }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `development-long-${number}`,
      title: `会话 ${number}`,
      current: index === 0,
    };
  });
}

function conversationMessageAnchor(messageId: string) {
  return `conversation-message-${messageId}`;
}

Page<ConversationData>({
  data: {
    drawerOpen: false,
    drawerConversations: [] as DrawerConversation[],
    conversationId: "",
    draft: "",
    canSend: false,
    boundaryMessage: "",
    keyboardOpen: false,
    viewportStyle: "",
    pptIntent: null,
    pptHandoff: null,
    selectionSheetOpen: false,
    selectionOptions: defaultSelectionOptions,
    selectionDraftIds: [...defaultSelectionIds],
    confirmedSelectionIds: [],
    selectionSummary: "",
    canConfirmSelection: true,
    selectionError: "",
    attachments: [],
    messages: [],
    pendingSend: null,
    sending: false,
    sendStatus: "idle",
    messageAnchor: "",
  },

  onLoad(options: { developmentSendFailure?: string; developmentLongList?: string } = {}) {
    this.isUnloaded = false;
    this.conversationHydrationGeneration = 0;
    const app = getApp<MiniappApp>();
    const longListEnabled = app.globalData.developmentAdapter
      && options.developmentLongList === "1";
    this.developmentSendFailure = app.globalData.developmentAdapter
      && options.developmentSendFailure === "1";
    this.setData({
      drawerConversations: longListEnabled ? createDevelopmentLongConversationList() : [],
    });
    this.conversationStore = createConversationStore(app);
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

    this.conversationStore = createConversationStore(app);
    const saved = this.conversationStore.restore();
    const storedPptContext = app.globalData.pptIntentStore.restore();
    const pptHandoff = storedPptContext?.phase === "draft" ? storedPptContext : null;
    const pptIntent = storedPptContext && storedPptContext.phase !== "draft" ? storedPptContext : null;
    const preferredConversationId = storedPptContext?.conversationId ?? saved?.conversationId;
    const conversationId = app.globalData.developmentAdapter
      ? preferredConversationId ?? developmentConversationId
      : preferredConversationId && preferredConversationId !== developmentConversationId
        ? preferredConversationId
        : productionConversationPlaceholder;
    const savedForIntent = saved?.conversationId === conversationId ? saved : null;
    const confirmedSelectionIds = pptIntent?.phase === "requirements-ready"
      ? savedForIntent?.confirmedSelectionIds ?? [...defaultSelectionIds]
      : [];
    const selectionDraftIds = pptIntent?.phase === "awaiting-confirmation"
      ? savedForIntent?.selectionDraftIds.length
        ? savedForIntent.selectionDraftIds
        : savedForIntent?.confirmedSelectionIds.length
          ? savedForIntent.confirmedSelectionIds
          : [...defaultSelectionIds]
      : pptIntent?.phase === "requirements-ready" ? confirmedSelectionIds : [];
    const selectionSheetOpen = pptIntent?.phase === "awaiting-confirmation"
      && (savedForIntent?.selectionSheetOpen ?? false);
    const draft = pptHandoff?.draft ?? savedForIntent?.draft ?? this.data.draft;
    const attachments = saved?.attachmentPaths ?? this.data.attachments;
    const pendingSend = saved?.pendingSend ?? null;
    const restoredMessages = saved?.messages ?? [];
    const messages = pendingSend
      ? failConversationSend(restoredMessages, pendingSend.id)
      : restoredMessages;

    this.setData({
      conversationId,
      draft,
      canSend: Boolean(draft.trim() || attachments.length),
      attachments,
      messages,
      pendingSend,
      sending: false,
      sendStatus: pendingSend ? "failed" : "idle",
      messageAnchor: messages.length ? conversationMessageAnchor(messages[messages.length - 1].id) : "",
      pptIntent,
      pptHandoff,
      selectionSheetOpen,
      selectionDraftIds,
      confirmedSelectionIds,
      selectionOptions: selectionOptionsFor(selectionDraftIds),
      selectionSummary: selectionSummary(confirmedSelectionIds),
      canConfirmSelection: canConfirmSelection(selectionDraftIds),
      selectionError: "",
      boundaryMessage: pendingSend ? "这次没有发出去，内容还在这里。可以再试一次。" : "",
    });
    this.persistLocalState();
    if (!app.globalData.developmentAdapter) {
      void this.hydrateProductionConversation(
        conversationId === productionConversationPlaceholder ? undefined : conversationId,
      );
    }
  },

  toggleDrawer() { this.setData({ drawerOpen: !this.data.drawerOpen }); },

  closeDrawer() { this.setData({ drawerOpen: false }); },

  noop() {},

  onDraftInput(event: MiniappEvent<{ value: string }>) {
    if (this.data.sending) return;
    const draft = event.detail.value;
    const context = this.data.pptHandoff ?? this.data.pptIntent;
    const updatedContext = context
      ? getApp<MiniappApp>().globalData.pptIntentStore.updateDraft(draft)
      : null;
    this.setData({
      draft,
      canSend: Boolean(draft.trim() || this.data.attachments.length),
      boundaryMessage: "",
      ...(this.data.pptHandoff ? { pptHandoff: updatedContext } : {}),
      ...(this.data.pptIntent ? { pptIntent: updatedContext } : {}),
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
    if (this.data.sending) return;
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
    if (this.data.sending) return;
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
    if (this.data.sending) return;
    if (!this.data.draft.trim() && !this.data.attachments.length) return;
    this.beginSend();
  },

  retrySend() {
    if (this.data.sending || !this.data.pendingSend) return;
    this.beginSend();
  },

  async hydrateProductionConversation(localConversationId?: string) {
    const generation = (this.conversationHydrationGeneration ?? 0) + 1;
    this.conversationHydrationGeneration = generation;
    try {
      const session = await this.getProductionConversationSession(localConversationId);
      if (this.isUnloaded || generation !== this.conversationHydrationGeneration) return;
      this.applyConversationApiSession(session);
    } catch {
      if (this.isUnloaded || generation !== this.conversationHydrationGeneration) return;
      if (this.data.sending && this.data.pendingSend) return;
      const hasRetainedInput = Boolean(
        this.data.draft.trim() || this.data.attachments.length || this.data.pendingSend,
      );
      this.setData({
        sending: false,
        sendStatus: this.data.pendingSend ? "failed" : "idle",
        canSend: Boolean(this.data.draft.trim() || this.data.attachments.length),
        boundaryMessage: hasRetainedInput
          ? "会话暂时无法连接，当前输入仍保留。"
          : "会话暂时无法载入，请稍后重试。",
      }, () => this.persistLocalState());
    }
  },

  getProductionConversationSession(localConversationId?: string): Promise<ConversationApiSession> {
    if (this.conversationHydrationPromise) return this.conversationHydrationPromise;
    let request: Promise<ConversationApiSession>;
    try {
      request = getApp<MiniappApp>().globalData.conversationClient.hydrateOrCreateSession(
        localConversationId,
      );
    } catch (error) {
      request = Promise.reject(error);
    }
    this.conversationHydrationPromise = request.finally(() => {
      this.conversationHydrationPromise = undefined;
    });
    return this.conversationHydrationPromise;
  },

  applyConversationApiSession(session: ConversationApiSession) {
    const localSendInFlight = Boolean(this.data.sending && this.data.pendingSend);
    const persistedPending = this.data.pendingSend;
    const completedReply = apiReplyFor(session, persistedPending);
    const completedPending = persistedPending && completedReply !== undefined
      ? persistedPending
      : null;
    const pendingForMapping = persistedPending ?? pendingFromApiSession(session);
    const pendingSend = completedPending ? null : pendingForMapping;
    const activeRun = Boolean(session.activeRun);
    const serverMessages = localSendInFlight
      ? this.data.messages
      : mapApiSessionMessages(session, this.data.messages, pendingForMapping);
    const messages = completedPending
      ? completeConversationSend(serverMessages, completedPending, completedReply ?? "")
      : markPendingMessage(
        serverMessages,
        pendingSend,
        activeRun ? "sending" : "failed",
      );
    const draft = localSendInFlight
      ? this.data.draft
      : completedPending
        ? ""
        : pendingSend?.draft ?? session.draft?.text ?? this.data.draft;
    const attachments = localSendInFlight
      ? [...this.data.attachments]
      : completedPending
        ? []
        : pendingSend
          ? [...pendingSend.attachmentPaths]
          : session.draft
            ? [...session.draft.attachments]
            : [...this.data.attachments];
    const lastMessage = messages[messages.length - 1];
    this.setData({
      conversationId: session.id,
      draft,
      attachments,
      messages,
      pendingSend,
      sending: localSendInFlight || (activeRun && !completedPending),
      sendStatus: localSendInFlight
        ? "sending"
        : activeRun
          ? "sending"
          : pendingSend
            ? "failed"
            : "idle",
      canSend: !localSendInFlight && !activeRun && Boolean(draft.trim() || attachments.length),
      boundaryMessage: localSendInFlight
        ? ""
        : pendingSend && !activeRun
          ? "这次没有发出去，内容还在这里。可以再试一次。"
          : "",
      messageAnchor: lastMessage ? conversationMessageAnchor(lastMessage.id) : "",
    }, () => this.persistLocalState());
  },

  beginSend() {
    let pptIntent = this.data.pptIntent;
    if (this.data.pptHandoff) {
      pptIntent = getApp<MiniappApp>().globalData.pptIntentStore.activate();
      if (!pptIntent) {
        this.showFailure("PPT 书籍上下文暂时无法恢复，当前输入仍保留。");
        return;
      }
    }
    const next = startConversationSend(
      this.data.messages,
      this.data.pendingSend,
      this.data.draft,
      this.data.attachments,
    );
    const pendingSend = next.pendingSend;
    this.setData({
      messages: next.messages,
      pendingSend,
      sending: true,
      sendStatus: "sending",
      canSend: false,
      boundaryMessage: "",
      messageAnchor: conversationMessageAnchor(pendingSend.id),
      pptIntent,
      pptHandoff: null,
      selectionSheetOpen: pptIntent?.phase === "awaiting-confirmation",
      selectionDraftIds: pptIntent?.phase === "awaiting-confirmation" ? [...defaultSelectionIds] : this.data.selectionDraftIds,
      confirmedSelectionIds: pptIntent?.phase === "awaiting-confirmation" ? [] : this.data.confirmedSelectionIds,
      selectionSummary: pptIntent?.phase === "awaiting-confirmation" ? "" : this.data.selectionSummary,
      selectionOptions: selectionOptionsFor(pptIntent?.phase === "awaiting-confirmation" ? defaultSelectionIds : this.data.selectionDraftIds),
      canConfirmSelection: canConfirmSelection(pptIntent?.phase === "awaiting-confirmation" ? defaultSelectionIds : this.data.selectionDraftIds),
    }, () => this.persistLocalState());

    const app = getApp<MiniappApp>();
    const send = app.globalData.developmentAdapter
      ? this.performDevelopmentSend(pendingSend).then((reply: string) => ({
        status: "completed" as const,
        reply,
      }))
      : this.performConversationSend(pendingSend);
    void send
      .then((result: ConversationSendOutcome) => {
        if (result.status === "completed") {
          this.completeSend(pendingSend, result.reply, result.session);
          return;
        }
        this.failApiSend(pendingSend, result);
      })
      .catch(() => this.failSend(pendingSend));
  },

  async performConversationSend(pendingSend: ConversationPendingSend): Promise<ConversationApiSendResult> {
    if (pendingSend.attachmentPaths.length) {
      throw new Error("CONVERSATION_ATTACHMENTS_UNAVAILABLE");
    }
    const app = getApp<MiniappApp>();
    let conversationId = this.data.conversationId;
    if (this.conversationHydrationPromise) {
      const session = await this.conversationHydrationPromise;
      if (this.isUnloaded) throw new Error("CONVERSATION_PAGE_UNLOADED");
      conversationId = session.id;
      if (this.data.conversationId !== conversationId) {
        this.setData({ conversationId }, () => this.persistLocalState());
      }
    } else if (!conversationId || conversationId === productionConversationPlaceholder) {
      const session = await this.getProductionConversationSession();
      if (this.isUnloaded) throw new Error("CONVERSATION_PAGE_UNLOADED");
      conversationId = session.id;
      this.setData({ conversationId }, () => this.persistLocalState());
    }
    return app.globalData.conversationClient.sendText(conversationId, {
      requestId: pendingSend.id,
      text: pendingSend.draft,
    });
  },

  performDevelopmentSend(pendingSend: ConversationPendingSend): Promise<string> {
    const app = getApp<MiniappApp>();
    const shouldFail = !app.globalData.developmentAdapter || this.developmentSendFailure === true;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (shouldFail) {
          reject(new Error("CONVERSATION_SEND_UNAVAILABLE"));
          return;
        }
        resolve(developmentConversationReply(pendingSend));
      }, 0);
    });
  },

  completeSend(
    pendingSend: ConversationPendingSend,
    reply: string,
    session?: ConversationApiSession,
  ) {
    if (this.isUnloaded || !this.data.sending || this.data.pendingSend?.id !== pendingSend.id) return;
    const serverMessages = session
      ? mapApiSessionMessages(session, this.data.messages, pendingSend)
      : this.data.messages;
    const messages = completeConversationSend(serverMessages, pendingSend, reply);
    const lastMessage = messages[messages.length - 1];
    this.setData({
      conversationId: session?.id ?? this.data.conversationId,
      messages,
      pendingSend: null,
      sending: false,
      sendStatus: "idle",
      draft: "",
      attachments: [],
      canSend: false,
      boundaryMessage: "",
      messageAnchor: lastMessage ? conversationMessageAnchor(lastMessage.id) : "",
    }, () => this.persistLocalState());
  },

  failApiSend(pendingSend: ConversationPendingSend, result: ConversationApiFailure) {
    if (this.isUnloaded || !this.data.sending || this.data.pendingSend?.id !== pendingSend.id) return;
    const retained: ConversationPendingSend = {
      ...pendingSend,
      draft: result.retainedDraft.text,
      attachmentPaths: [...result.retainedDraft.attachments],
    };
    const serverMessages = mapApiSessionMessages(result.session, this.data.messages, retained);
    const messages = failConversationSend(serverMessages, pendingSend.id);
    this.setData({
      conversationId: result.session.id,
      messages,
      pendingSend: retained,
      sending: false,
      sendStatus: "failed",
      draft: retained.draft,
      attachments: [...retained.attachmentPaths],
      canSend: Boolean(retained.draft.trim() || retained.attachmentPaths.length),
      boundaryMessage: "这次没有发出去，内容还在这里。可以再试一次。",
      messageAnchor: conversationMessageAnchor(pendingSend.id),
    }, () => this.persistLocalState());
  },

  failSend(pendingSend: ConversationPendingSend) {
    if (this.isUnloaded || !this.data.sending || this.data.pendingSend?.id !== pendingSend.id) return;
    const messages = failConversationSend(this.data.messages, pendingSend.id);
    this.setData({
      messages,
      sending: false,
      sendStatus: "failed",
      canSend: Boolean(this.data.draft.trim() || this.data.attachments.length),
      boundaryMessage: "这次没有发出去，内容还在这里。可以再试一次。",
      messageAnchor: conversationMessageAnchor(pendingSend.id),
    }, () => this.persistLocalState());
  },

  showFailure(message: string) {
    if (this.data.sending) return;
    const preserved = preserveConversationFailure(this.data, message);
    this.setData({
      ...preserved,
      sendStatus: "idle",
      selectionOptions: selectionOptionsFor(preserved.selectionDraftIds),
      canConfirmSelection: canConfirmSelection(preserved.selectionDraftIds),
    }, () => this.persistLocalState());
  },

  addAttachments(paths: string[]) {
    if (this.data.sending) return;
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
    const app = getApp<MiniappApp>();
    const conversationId = this.data.conversationId
      || (app.globalData.developmentAdapter
        ? this.data.pptIntent?.conversationId
          ?? this.data.pptHandoff?.conversationId
          ?? developmentConversationId
        : productionConversationPlaceholder);
    const state: ConversationLocalState = {
      version: 1,
      conversationId,
      intentTaskId: null,
      draft: this.data.draft,
      attachmentPaths: this.data.attachments,
      selectionDraftIds: this.data.selectionDraftIds,
      confirmedSelectionIds: this.data.confirmedSelectionIds,
      selectionSheetOpen: this.data.selectionSheetOpen,
      messages: this.data.messages,
      pendingSend: this.data.pendingSend,
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
