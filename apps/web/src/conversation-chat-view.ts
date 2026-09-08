import "./conversation-chat.css";
import "./ppt-requirements-workspace.css";
import "./ppt-outline-workspace.css";
import { escapeHtml } from "./ui/desktop-shell";
import type { ConversationChatController } from "./conversation-chat-controller";
import type { PptRequirementsWorkspaceState } from "./ppt-requirements-workspace-state";
import { renderPptRequirementsWorkspaceNotice, renderPptRequirementsWorkspaceView } from "./ppt-requirements-workspace-view";
import type { PptOutlineWorkspaceState } from "./ppt-outline-workspace-state";
import { renderPptOutlineWorkspaceView } from "./ppt-outline-workspace-view";
import type { ConversationChatMessage, ConversationChatState } from "./conversation-chat-state";
import type { ConversationSelectionController } from "./conversation-selection-controller";
import {
  mountConversationSelectionView,
  renderConversationSelectionView,
  selectionStateForMessage,
} from "./conversation-selection-view";
import {
  selectionQuestionsForMessage,
  type ConversationSelectionState,
} from "./conversation-selection-state";

export type ConversationChatViewOptions = {
  state: ConversationChatState;
  title?: string;
  selectionState?: ConversationSelectionState;
  settingsReturnTo?: string;
  workspaceState?: PptRequirementsWorkspaceState;
};

export type ConversationChatViewResult = {
  main: string;
  taskPanel: string;
};

export type ConversationChatMountOptions = {
  title?: string;
  selectionController?: ConversationSelectionController;
  hydrateSelection?: boolean;
  settingsReturnTo?: string;
  workspaceStore?: {
    getState(): PptRequirementsWorkspaceState;
    subscribe(listener: (state: PptRequirementsWorkspaceState) => void): () => void;
  };
  onWorkspaceRetry?: (context: { conversationId: string; requestId: string; bookId: string }) => void;
  onRequirementsSubmit?: (input: { purpose: string; audience: string; pageRange: { min: number; max: number }; additionalRequirements: string }) => void;
  outlineStore?: {
    getState(): PptOutlineWorkspaceState;
    subscribe(listener: (state: PptOutlineWorkspaceState) => void): () => void;
    editText(id: string, text: string): void;
    split(id: string, offset: number): unknown;
    backspaceAtStart(id: string): unknown;
    indent(id: string): boolean;
    outdent(id: string): boolean;
    retrySave(): Promise<void>;
    hide(): void;
  };
  onOutlineBack?: () => void;
};

export function renderConversationChatView(options: ConversationChatViewOptions): ConversationChatViewResult {
  const { state } = options;
  const title = options.title?.trim() || "当前对话";
  const isSending = state.status === "sending";
  const hasDraft = state.draft.trim().length > 0;
  const statusLabel = isSending ? "正在发送" : state.status === "error" ? "需要重试" : "空闲";
  const statusNotice = state.status === "error"
    ? renderErrorNotice(state.errorCode, options.settingsReturnTo)
    : isSending
      ? `<p class="conversation-chat-status" role="status">正在发送…</p>`
      : `<p class="conversation-chat-status" role="status">就绪</p>`;

  const workspaceState = options.workspaceState ?? { phase: "hidden" };
  return {
    main: `
      <section class="conversation-chat-view" data-conversation-chat="${escapeHtml(state.conversationId)}" aria-labelledby="conversation-chat-title" aria-busy="${isSending ? "true" : "false"}">
        <h1 id="conversation-chat-title" class="visually-hidden">${escapeHtml(title)}</h1>
        <span class="conversation-chat-state-label visually-hidden ${isSending ? "is-sending" : state.status === "error" ? "is-error" : "is-idle"}" role="status">${statusLabel}</span>
        <div class="conversation-chat-scroll">
          <div class="conversation-chat-stream" data-conversation-chat-messages role="log" aria-live="polite" aria-relevant="additions text">
            ${renderMessages(state.messages, options.selectionState)}
          </div>
        </div>
        <div class="conversation-chat-notice" data-ppt-workspace-notice>${renderPptRequirementsWorkspaceNotice(workspaceState)}</div>
        <form class="conversation-chat-composer" data-conversation-chat-form>
          <img class="conversation-chat-mascot" src="/mascot/laoji-mascot-seated-reading-transparent-v1.png" alt="" aria-hidden="true" />
          <label class="conversation-chat-input-label" for="conversation-chat-input-${escapeHtml(state.conversationId)}">
            <span class="visually-hidden">消息</span>
            <textarea id="conversation-chat-input-${escapeHtml(state.conversationId)}" name="message" data-conversation-chat-input rows="1" value="${escapeHtml(state.draft)}" placeholder="写下想与老己说的话" autocomplete="off" spellcheck="true" aria-describedby="conversation-chat-status-${escapeHtml(state.conversationId)}"${isSending ? " readonly aria-disabled=\"true\"" : ""}>${escapeHtml(state.draft)}</textarea>
          </label>
          <button class="conversation-chat-send" data-conversation-chat-send type="submit"${isSending || !hasDraft ? " disabled" : ""}>发送</button>
          <span id="conversation-chat-status-${escapeHtml(state.conversationId)}" class="conversation-chat-status-wrap">${statusNotice}<span class="conversation-chat-composer-help">Enter 发送，Shift+Enter 换行</span></span>
        </form>
      </section>`,
    taskPanel: renderPptRequirementsWorkspaceView(workspaceState),
  };
}

function renderErrorNotice(errorCode: string | null, settingsReturnTo = "#/conversation") {
  if (errorCode === "PLATFORM_CONFIGURATION_REQUIRED" || errorCode === "PLATFORM_EXHAUSTION") {
    const href = `#/settings/text-model?return=${encodeURIComponent(settingsReturnTo)}`;
    return `<p class="conversation-chat-status conversation-chat-status-error" role="alert">配置自己的 AI 模型后继续。<a href="${href}">配置 AI 模型</a></p>`;
  }
  if (errorCode === "PLATFORM_UNAVAILABLE") {
    return `<p class="conversation-chat-status conversation-chat-status-error" role="alert">当前会话和输入已保留，请稍后重试</p>`;
  }
  return `<p class="conversation-chat-status conversation-chat-status-error" role="alert">发送失败，输入仍保留，请重试</p>`;
}

export function mountConversationChatView(
  mainRoot: HTMLElement,
  taskRoot: HTMLElement | null,
  controller: ConversationChatController,
  options: ConversationChatMountOptions = {},
) {
  let disposed = false;
  let renderedState: ConversationChatState | null = null;
  let selectionState = options.selectionController?.getState();
  let workspaceState = options.workspaceStore?.getState() ?? { phase: "hidden" } as PptRequirementsWorkspaceState;
  let outlineState = options.outlineStore?.getState() ?? { phase: "hidden" } as PptOutlineWorkspaceState;
  const selectionMounts = new Map<string, () => void>();

  const disposeSelectionMounts = () => {
    selectionMounts.forEach((dispose) => dispose());
    selectionMounts.clear();
  };

  const syncSelectionMounts = (nextState: ConversationSelectionState = selectionState!) => {
    const selectionController = options.selectionController;
    if (!selectionController) return;
    const desired = new Set<string>();
    mainRoot.querySelectorAll<HTMLElement>(".conversation-chat-message-assistant[data-message-id]").forEach((message) => {
      const assistantMessageId = message.dataset.messageId;
      if (!assistantMessageId) return;
      const questions = selectionQuestionsForMessage(nextState, assistantMessageId);
      const slot = message.querySelector<HTMLElement>("[data-conversation-selection-slot]");
      if (questions.length === 0) {
        if (slot) slot.remove();
        selectionMounts.get(assistantMessageId)?.();
        selectionMounts.delete(assistantMessageId);
        return;
      }
      desired.add(assistantMessageId);
      const selectionSlot = slot ?? createSelectionSlot(message, assistantMessageId, nextState);
      if (!selectionMounts.has(assistantMessageId)) {
        selectionMounts.set(
          assistantMessageId,
          mountConversationSelectionView(selectionSlot, selectionController, {
            assistantMessageId,
            hydrate: false,
          }),
        );
      }
    });
    selectionMounts.forEach((dispose, assistantMessageId) => {
      if (desired.has(assistantMessageId)) return;
      dispose();
      selectionMounts.delete(assistantMessageId);
    });
  };

  const syncWorkspaceNotice = () => {
    const region = mainRoot.querySelector<HTMLElement>("[data-ppt-workspace-notice]");
    if (!region) return;
    region.innerHTML = renderPptRequirementsWorkspaceNotice(workspaceState);
    region.querySelector<HTMLButtonElement>("[data-ppt-workspace-retry]")?.addEventListener("click", () => {
      const context = workspaceState.phase === "error" ? workspaceState.context : null;
      if (context) options.onWorkspaceRetry?.(context);
    });
  };

  const syncTaskPanel = () => {
    if (!taskRoot) return;
    const taskPanel = taskRoot.closest<HTMLElement>(".desktop-task-panel");
    const shell = taskPanel?.closest<HTMLElement>(".desktop-app-shell")
      ?? taskRoot.closest<HTMLElement>(".desktop-app-shell");
    const taskPanelHtml = outlineState.phase === "ready"
      ? renderPptOutlineWorkspaceView(outlineState)
      : renderPptRequirementsWorkspaceView(workspaceState);
    if (taskPanelHtml) {
      shell?.style.removeProperty("--desktop-task-width");
      taskRoot.innerHTML = taskPanelHtml;
      taskPanel?.removeAttribute("hidden");
    } else {
      shell?.style.setProperty("--desktop-task-width", "0px");
      taskPanel?.setAttribute("hidden", "");
      taskRoot.innerHTML = "";
    }
    if ("querySelector" in taskRoot) {
      const requirementsForm = taskRoot.querySelector<HTMLFormElement>("[data-ppt-requirements-form]");
      const preset = taskRoot.querySelector<HTMLSelectElement>("[data-ppt-page-preset]");
      const minInput = taskRoot.querySelector<HTMLInputElement>("[data-ppt-page-min]");
      const maxInput = taskRoot.querySelector<HTMLInputElement>("[data-ppt-page-max]");
      preset?.addEventListener("change", () => {
        if (!minInput || !maxInput || preset.value === "custom") return;
        const [min, max] = preset.value.split("-").map(Number);
        minInput.value = String(min);
        maxInput.value = String(max);
      });
      requirementsForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const fields = new FormData(requirementsForm);
        const min = Number(fields.get("pageMin"));
        const max = Number(fields.get("pageMax"));
        if (Number.isSafeInteger(min) && Number.isSafeInteger(max) && min > 0 && max >= min) {
          options.onRequirementsSubmit?.({
            purpose: String(fields.get("purpose") ?? ""),
            audience: String(fields.get("audience") ?? ""),
            pageRange: { min, max },
            additionalRequirements: String(fields.get("additionalRequirements") ?? ""),
          });
        }
      });
      taskRoot.querySelectorAll<HTMLTextAreaElement>("[data-ppt-outline-text]").forEach((input) => {
        input.addEventListener("input", () => options.outlineStore?.editText(input.closest<HTMLElement>("[data-paragraph-id]")?.dataset.paragraphId ?? "", input.value));
        input.addEventListener("keydown", (event) => {
          const id = input.closest<HTMLElement>("[data-paragraph-id]")?.dataset.paragraphId;
          if (!id) return;
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); options.outlineStore?.split(id, input.selectionStart ?? input.value.length); }
          if (event.key === "Tab") { event.preventDefault(); event.shiftKey ? options.outlineStore?.outdent(id) : options.outlineStore?.indent(id); }
          if (event.key === "Backspace" && (input.selectionStart ?? 0) === 0 && (input.selectionEnd ?? 0) === 0) { const result = options.outlineStore?.backspaceAtStart(id); if (result) event.preventDefault(); }
        });
      });
      taskRoot.querySelector<HTMLButtonElement>("[data-ppt-outline-retry]")?.addEventListener("click", () => { void options.outlineStore?.retrySave(); });
      taskRoot.querySelector<HTMLButtonElement>("[data-ppt-outline-back]")?.addEventListener("click", () => options.onOutlineBack?.());
    }
  };

  const patchWorkspaceRegions = () => {
    syncWorkspaceNotice();
    syncTaskPanel();
  };

  const render = (nextState: ConversationChatState = controller.getState()) => {
    if (disposed) return;
    if (renderedState && isDraftOnlyChange(renderedState, nextState)) {
      patchDraftControls(mainRoot, nextState);
      renderedState = nextState;
      return;
    }

    disposeSelectionMounts();
    const rendered = renderConversationChatView({
      state: nextState,
      title: options.title,
      selectionState,
      settingsReturnTo: options.settingsReturnTo,
      workspaceState,
    });
    mainRoot.innerHTML = rendered.main;
    patchWorkspaceRegions();
    renderedState = nextState;
    syncSelectionMounts();

    const form = mainRoot.querySelector<HTMLFormElement>("[data-conversation-chat-form]");
    const input = mainRoot.querySelector<HTMLTextAreaElement>("[data-conversation-chat-input]");
    if (!form || !input) return;

    input.addEventListener("input", () => controller.setDraft(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void controller.send();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void controller.send();
    });
  };

  const unsubscribe = controller.subscribe(render);
  const unsubscribeSelection = options.selectionController?.subscribe((nextState) => {
    selectionState = nextState;
    syncSelectionMounts(nextState);
  });
  const unsubscribeWorkspace = options.workspaceStore?.subscribe((nextState) => {
    workspaceState = nextState;
    patchWorkspaceRegions();
  });
  const unsubscribeOutline = options.outlineStore?.subscribe((nextState) => { outlineState = nextState; patchWorkspaceRegions(); });
  render(controller.getState());
  void controller.hydrate();
  if (options.selectionController && options.hydrateSelection !== false) {
    void options.selectionController.hydrate();
  }

  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeSelection?.();
    unsubscribeWorkspace?.();
    unsubscribeOutline?.();
    disposeSelectionMounts();
  };
}

function isDraftOnlyChange(previous: ConversationChatState, next: ConversationChatState) {
  return previous.conversationId === next.conversationId
    && previous.revision === next.revision
    && previous.messages === next.messages
    && previous.status === next.status
    && previous.errorCode === next.errorCode
    && previous.draft !== next.draft;
}

function patchDraftControls(mainRoot: HTMLElement, state: ConversationChatState) {
  const send = mainRoot.querySelector<HTMLButtonElement>("[data-conversation-chat-send]");
  if (send) send.disabled = state.status === "sending" || state.draft.trim().length === 0;
}

function renderMessages(
  messages: readonly ConversationChatMessage[],
  selectionState?: ConversationSelectionState,
) {
  if (messages.length === 0) {
    return `<p class="conversation-chat-empty" data-conversation-chat-empty>还没有消息</p>`;
  }

  return messages.map((message) => `
    <article class="conversation-chat-message conversation-chat-message-${message.role}" data-message-id="${escapeHtml(message.id)}">
      ${message.role === "assistant" ? `<img class="conversation-chat-message-avatar" src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" />` : ""}
      <div class="conversation-chat-message-body">
        <span class="conversation-chat-message-role">${message.role === "user" ? "我" : message.role === "assistant" ? "老己" : "状态"}</span>
        <p>${escapeHtml(message.text)}</p>
        ${message.role === "assistant" && selectionState
          ? renderSelectionSlot(selectionState, message.id)
          : ""}
      </div>
    </article>`).join("");
}

function renderSelectionSlot(state: ConversationSelectionState, assistantMessageId: string) {
  if (selectionQuestionsForMessage(state, assistantMessageId).length === 0) return "";
  return `<div class="conversation-selection-slot" data-conversation-selection-slot="${escapeHtml(assistantMessageId)}">
    ${renderConversationSelectionView({ state: selectionStateForMessage(state, assistantMessageId) }).main}
  </div>`;
}

function createSelectionSlot(
  message: HTMLElement,
  assistantMessageId: string,
  state: ConversationSelectionState,
) {
  const slot = message.ownerDocument.createElement("div");
  slot.className = "conversation-selection-slot";
  slot.dataset.conversationSelectionSlot = assistantMessageId;
  slot.innerHTML = renderConversationSelectionView({
    state: selectionStateForMessage(state, assistantMessageId),
  }).main;
  message.querySelector<HTMLElement>(".conversation-chat-message-body")?.append(slot);
  return slot;
}
