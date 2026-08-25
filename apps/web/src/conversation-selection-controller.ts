import {
  applySelectionError,
  applySelectionResult,
  applySelectionSnapshot,
  beginSelectionHydration,
  beginSelectionSave,
  createConversationSelectionState,
  selectionDraftFor,
  setSelectionFreeText,
  toggleSelectionOption,
  type ConversationSelectionAnswerResult,
  type ConversationSelectionQuestion,
  type ConversationSelectionState,
} from "./conversation-selection-state";
import type {
  AnswerConversationSelectionInput,
  CreateConversationSelectionInput,
} from "./conversation-selection-client";

export type ConversationSelectionControllerClient = {
  listQuestions(conversationId: string): Promise<ConversationSelectionQuestion[]>;
  createQuestion(
    conversationId: string,
    input: CreateConversationSelectionInput,
  ): Promise<ConversationSelectionQuestion>;
  answerQuestion(
    conversationId: string,
    questionId: string,
    input: AnswerConversationSelectionInput,
  ): Promise<ConversationSelectionAnswerResult>;
};

export type ConversationSelectionControllerOptions = {
  conversationId: string;
  client: ConversationSelectionControllerClient;
  requestIdFactory?: () => string;
};

export type ConversationSelectionStateListener = (state: ConversationSelectionState) => void;

export type ConversationSelectionController = {
  getState(): ConversationSelectionState;
  subscribe(listener: ConversationSelectionStateListener): () => void;
  hydrate(): Promise<ConversationSelectionState>;
  createQuestion(input: CreateConversationSelectionInput): Promise<ConversationSelectionQuestion | undefined>;
  selectOption(questionId: string, value: string): Promise<ConversationSelectionAnswerResult | undefined>;
  setFreeText(questionId: string, value: string): void;
  confirm(questionId: string): Promise<ConversationSelectionAnswerResult | undefined>;
};

export function createConversationSelectionController(
  options: ConversationSelectionControllerOptions,
): ConversationSelectionController {
  let state = createConversationSelectionState(options.conversationId);
  const listeners = new Set<ConversationSelectionStateListener>();
  const retryRequestIds = new Map<string, string>();
  let localEpoch = 0;
  let hydrateGeneration = 0;

  function publish(nextState: ConversationSelectionState) {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  function requestId() {
    if (options.requestIdFactory) return options.requestIdFactory();
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `selection-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function persist(
    question: ConversationSelectionQuestion,
    input: Omit<AnswerConversationSelectionInput, "requestId" | "expectedVersion"> & { requestId?: string },
  ) {
    const id = input.requestId ?? retryRequestIds.get(question.id) ?? requestId();
    retryRequestIds.set(question.id, id);
    localEpoch += 1;
    publish(beginSelectionSave(state));
    try {
      const result = await options.client.answerQuestion(options.conversationId, question.id, {
        ...input,
        requestId: id,
        expectedVersion: question.version,
        confirm: input.confirm ?? false,
      });
      if (result.status === "submitted") retryRequestIds.delete(question.id);
      localEpoch += 1;
      publish(applySelectionResult(state, result));
      return result;
    } catch (error) {
      publish(applySelectionError(state, selectionErrorCode(error)));
      return undefined;
    }
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async hydrate() {
      const requestEpoch = localEpoch;
      const requestGeneration = ++hydrateGeneration;
      publish(beginSelectionHydration(state));
      try {
        const questions = await options.client.listQuestions(options.conversationId);
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
        publish(applySelectionSnapshot(state, questions));
      } catch (error) {
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
        publish(applySelectionError(state, selectionErrorCode(error)));
      }
      return state;
    },

    async createQuestion(input) {
      try {
        const question = await options.client.createQuestion(options.conversationId, input);
        const superseded = state.questions.map((candidate) => candidate.status === "pending"
          ? { ...candidate, status: "stale" as const }
          : candidate);
        publish(applySelectionSnapshot(state, [...superseded, question]));
        return question;
      } catch (error) {
        publish(applySelectionError(state, selectionErrorCode(error)));
        return undefined;
      }
    },

    async selectOption(questionId, value) {
      if (state.status === "saving") return undefined;
      const question = state.questions.find((candidate) => candidate.id === questionId);
      if (!question || question.status !== "pending" || question.mode === "free") return undefined;
      const nextState = toggleSelectionOption(state, questionId, value);
      if (nextState === state) return undefined;
      localEpoch += 1;
      publish(nextState);
      const draft = selectionDraftFor(nextState, questionId);
      return persist(question, { values: draft.values, confirm: question.mode === "single" });
    },

    setFreeText(questionId, value) {
      if (state.status === "saving") return;
      const nextState = setSelectionFreeText(state, questionId, value);
      if (nextState === state) return;
      localEpoch += 1;
      publish(nextState);
    },

    async confirm(questionId) {
      if (state.status === "saving") return undefined;
      const question = state.questions.find((candidate) => candidate.id === questionId);
      if (!question || question.status !== "pending") return undefined;
      const draft = selectionDraftFor(state, questionId);
      return persist(question, {
        values: draft.values,
        freeText: question.mode === "free" ? draft.freeText : undefined,
        confirm: true,
      });
    },
  };
}

function selectionErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "SELECTION_REQUEST_FAILED";
}
