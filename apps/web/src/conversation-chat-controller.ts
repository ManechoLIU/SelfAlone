import {
  applyConversationSendResult,
  applyConversationSnapshot,
  beginConversationSend,
  createConversationChatState,
  updateConversationDraft,
  type ConversationChatSendResult,
  type ConversationChatSession,
  type ConversationChatState,
} from "./conversation-chat-state";

export type ConversationChatControllerClient = {
  getSession(conversationId: string): Promise<ConversationChatSession>;
  sendText(
    conversationId: string,
    input: { requestId?: string; text: string },
  ): Promise<ConversationChatSendResult>;
};

export type ConversationChatControllerOptions = {
  conversationId: string;
  client: ConversationChatControllerClient;
  requestIdFactory?: () => string;
};

export type ConversationChatStateListener = (state: ConversationChatState) => void;

export type ConversationChatController = {
  getState(): ConversationChatState;
  subscribe(listener: ConversationChatStateListener): () => void;
  setDraft(draft: string): void;
  hydrate(): Promise<ConversationChatState>;
  send(): Promise<ConversationChatSendResult | undefined>;
};

export function createConversationChatController(
  options: ConversationChatControllerOptions,
): ConversationChatController {
  let state = createConversationChatState(options.conversationId);
  const listeners = new Set<ConversationChatStateListener>();

  function publish(nextState: ConversationChatState) {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  function requestId() {
    if (options.requestIdFactory) return options.requestIdFactory();
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `conversation-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setDraft(draft) {
      if (state.status === "sending") return;
      publish(updateConversationDraft(state, draft));
    },

    async hydrate() {
      try {
        const session = await options.client.getSession(options.conversationId);
        const nextState = applyConversationSnapshot(state, session);
        publish(nextState);
      } catch (error) {
        publish({
          ...state,
          status: "error",
          errorCode: conversationErrorCode(error),
        });
      }
      return state;
    },

    async send() {
      if (state.status === "sending") return undefined;
      const text = state.draft;
      if (!text.trim()) return undefined;

      const id = state.retryRequestId && state.retryText === text
        ? state.retryRequestId
        : requestId();
      publish(beginConversationSend(state, id));
      try {
        const result = await options.client.sendText(options.conversationId, {
          requestId: id,
          text,
        });
        publish(applyConversationSendResult(state, result));
        return result;
      } catch (error) {
        publish({
          ...state,
          status: "error",
          errorCode: conversationErrorCode(error),
        });
        return undefined;
      }
    },
  };
}

function conversationErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "CONVERSATION_REQUEST_FAILED";
}
