import "./conversation-chat.css";
import { escapeHtml } from "./ui/desktop-shell";
import type { ConversationChatController } from "./conversation-chat-controller";
import type { ConversationChatMessage, ConversationChatState } from "./conversation-chat-state";

export type ConversationChatViewOptions = {
  state: ConversationChatState;
  title?: string;
};

export type ConversationChatViewResult = {
  main: string;
  taskPanel: string;
};

export type ConversationChatMountOptions = {
  title?: string;
};

export function renderConversationChatView(options: ConversationChatViewOptions): ConversationChatViewResult {
  const { state } = options;
  const title = options.title?.trim() || "当前对话";
  const isSending = state.status === "sending";
  const hasDraft = state.draft.trim().length > 0;
  const statusLabel = isSending ? "正在发送" : state.status === "error" ? "需要重试" : "空闲";
  const statusNotice = state.status === "error"
    ? `<p class="conversation-chat-status conversation-chat-status-error" role="alert">发送失败，输入仍保留${state.errorCode ? `（${escapeHtml(state.errorCode)}）` : ""}</p>`
    : isSending
      ? `<p class="conversation-chat-status" role="status">正在发送…</p>`
      : `<p class="conversation-chat-status" role="status">就绪</p>`;

  return {
    main: `
      <section class="conversation-chat-view" data-conversation-chat="${escapeHtml(state.conversationId)}" aria-labelledby="conversation-chat-title" aria-busy="${isSending ? "true" : "false"}">
        <h1 id="conversation-chat-title" class="visually-hidden">${escapeHtml(title)}</h1>
        <span class="conversation-chat-state-label visually-hidden ${isSending ? "is-sending" : state.status === "error" ? "is-error" : "is-idle"}" role="status">${statusLabel}</span>
        <div class="conversation-chat-scroll">
          <div class="conversation-chat-stream" data-conversation-chat-messages role="log" aria-live="polite" aria-relevant="additions text">
            ${renderMessages(state.messages)}
          </div>
        </div>
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
    taskPanel: "",
  };
}

export function mountConversationChatView(
  mainRoot: HTMLElement,
  taskRoot: HTMLElement | null,
  controller: ConversationChatController,
  options: ConversationChatMountOptions = {},
) {
  let disposed = false;
  let renderedState: ConversationChatState | null = null;

  const render = (nextState: ConversationChatState = controller.getState()) => {
    if (disposed) return;
    if (renderedState && isDraftOnlyChange(renderedState, nextState)) {
      patchDraftControls(mainRoot, nextState);
      renderedState = nextState;
      return;
    }

    const rendered = renderConversationChatView({ state: nextState, title: options.title });
    mainRoot.innerHTML = rendered.main;
    if (taskRoot) {
      const taskPanel = taskRoot.closest<HTMLElement>(".desktop-task-panel");
      const shell = taskPanel?.closest<HTMLElement>(".desktop-app-shell")
        ?? taskRoot.closest<HTMLElement>(".desktop-app-shell");
      if (rendered.taskPanel) {
        shell?.style.removeProperty("--desktop-task-width");
        taskRoot.innerHTML = rendered.taskPanel;
      } else {
        shell?.style.setProperty("--desktop-task-width", "0px");
        taskPanel?.remove();
      }
    }
    renderedState = nextState;

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
  render(controller.getState());
  void controller.hydrate();

  return () => {
    disposed = true;
    unsubscribe();
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

function renderMessages(messages: readonly ConversationChatMessage[]) {
  if (messages.length === 0) {
    return `<p class="conversation-chat-empty" data-conversation-chat-empty>还没有消息</p>`;
  }

  return messages.map((message) => `
    <article class="conversation-chat-message conversation-chat-message-${message.role}" data-message-id="${escapeHtml(message.id)}">
      ${message.role === "assistant" ? `<img class="conversation-chat-message-avatar" src="/avatar/laoji-avatar-qingci-chibi-v2.png" alt="老己" />` : ""}
      <div class="conversation-chat-message-body">
        <span class="conversation-chat-message-role">${message.role === "user" ? "我" : message.role === "assistant" ? "老己" : "状态"}</span>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </article>`).join("");
}
