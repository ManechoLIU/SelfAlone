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
import type { ConversationNoteIntent } from "@selfalone/contracts";

export type ConversationChatControllerClient = {
  getSession(conversationId: string): Promise<ConversationChatSession>;
  sendText(
    conversationId: string,
    input: { requestId?: string; text: string; noteIntent?: ConversationNoteIntent },
  ): Promise<ConversationChatSendResult>;
};

export type ConversationChatControllerOptions = {
  conversationId: string;
  client: ConversationChatControllerClient;
  requestIdFactory?: () => string;
  noteIntentFactory?: (draft: string) => ConversationNoteIntent | undefined;
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  onDraftCommit?: (sentText: string, noteIntent?: ConversationNoteIntent) => string | undefined;
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
  const initialDraft = options.initialDraft ?? "";
  if (initialDraft) state = updateConversationDraft(state, initialDraft);
  const listeners = new Set<ConversationChatStateListener>();
  let localEpoch = initialDraft ? 1 : 0;
  let hydrateGeneration = 0;
  let initialDraftPending = Boolean(initialDraft);
  let handoffDraftActive = Boolean(initialDraft) || Boolean(options.onDraftChange);
  let retryNoteIntentText: string | null = null;
  let retryNoteIntent: ConversationNoteIntent | undefined;

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
      if (draft !== initialDraft) initialDraftPending = false;
      if (state.retryRequestId === null || state.retryText !== draft) {
        retryNoteIntentText = null;
        retryNoteIntent = undefined;
      }
      localEpoch += 1;
      publish(updateConversationDraft(state, draft));
      if (handoffDraftActive) options.onDraftChange?.(draft);
    },

    async hydrate() {
      const requestEpoch = localEpoch;
      const requestGeneration = ++hydrateGeneration;
      try {
        const session = await options.client.getSession(options.conversationId);
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
        let nextState = applyConversationSnapshot(state, session);
        if (nextState.retryText !== retryNoteIntentText) {
          retryNoteIntentText = null;
          retryNoteIntent = undefined;
        }
        const serverDraft = session.draft?.text;
        if (typeof serverDraft === "string" && serverDraft.length > 0) {
          initialDraftPending = false;
          handoffDraftActive = false;
        } else if (initialDraftPending && state.draft === initialDraft && state.revision === null) {
          nextState = updateConversationDraft(nextState, initialDraft);
          initialDraftPending = false;
        }
        publish(nextState);
      } catch (error) {
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
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

      const canRetrySameRequest = state.retryRequestId !== null && state.retryText === text;
      const id = canRetrySameRequest
        ? state.retryRequestId!
        : requestId();
      if (!canRetrySameRequest || retryNoteIntentText !== text) {
        retryNoteIntentText = text;
        retryNoteIntent = options.noteIntentFactory?.(text);
      }
      const noteIntent = retryNoteIntentText === text ? retryNoteIntent : undefined;
      initialDraftPending = false;
      localEpoch += 1;
      publish(beginConversationSend(state, id));
      try {
        const result = await options.client.sendText(options.conversationId, {
          requestId: id,
          text,
          ...(noteIntent ? { noteIntent } : {}),
        });
        localEpoch += 1;
        const nextState = applyConversationSendResult(state, result);
        publish(nextState);
        if (result.status === "completed") {
          const restoredDraft = options.onDraftCommit?.(text, noteIntent);
          if (restoredDraft !== undefined) {
            handoffDraftActive = true;
            publish(updateConversationDraft(nextState, restoredDraft));
          } else {
            handoffDraftActive = false;
          }
        }
        return result;
      } catch (error) {
        localEpoch += 1;
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
