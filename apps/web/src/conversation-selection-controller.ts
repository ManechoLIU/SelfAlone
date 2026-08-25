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
  type SelectionDraft,
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
  accountId: string;
  conversationId: string;
  client: ConversationSelectionControllerClient;
  requestIdFactory?: () => string;
  draftCache?: ConversationSelectionDraftCache;
};

export type ConversationSelectionDraftCache = {
  load(
    accountId: string,
    conversationId: string,
    questionId: string,
  ): Promise<SelectionDraft | null> | SelectionDraft | null;
  save(
    accountId: string,
    conversationId: string,
    questionId: string,
    draft: SelectionDraft,
  ): Promise<void> | void;
  clear(
    accountId: string,
    conversationId: string,
    questionId: string,
  ): Promise<void> | void;
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
  const draftCache = options.draftCache ?? emptyDraftCache;
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

  function saveDraftCache(questionId: string, draft: SelectionDraft) {
    try {
      void Promise.resolve(draftCache.save(
        options.accountId,
        options.conversationId,
        questionId,
        { values: [...draft.values], freeText: draft.freeText },
      )).catch(() => undefined);
    } catch {
      // A cache failure must not turn a usable in-memory draft into an error state.
    }
  }

  function clearDraftCache(questionId: string) {
    try {
      void Promise.resolve(draftCache.clear(
        options.accountId,
        options.conversationId,
        questionId,
      )).catch(() => undefined);
    } catch {
      // Cache cleanup is best effort; server state remains authoritative.
    }
  }

  async function loadDraftCache(question: ConversationSelectionQuestion) {
    try {
      const cached = await draftCache.load(
        options.accountId,
        options.conversationId,
        question.id,
      );
      if (!cached) return null;
      const allowedValues = new Set(question.options.map((option) => option.value));
      return {
        values: question.mode === "free"
          ? []
          : cached.values.filter((value) => allowedValues.has(value)),
        freeText: question.mode === "free" ? cached.freeText : question.freeText ?? "",
      } satisfies SelectionDraft;
    } catch {
      return null;
    }
  }

  async function persist(
    question: ConversationSelectionQuestion,
    input: Omit<AnswerConversationSelectionInput, "requestId" | "expectedVersion"> & { requestId?: string },
  ) {
    const id = input.requestId ?? retryRequestIds.get(question.id) ?? requestId();
    retryRequestIds.set(question.id, id);
    saveDraftCache(question.id, selectionDraftFor(state, question.id));
    localEpoch += 1;
    publish(beginSelectionSave(state));
    try {
      const result = await options.client.answerQuestion(options.conversationId, question.id, {
        ...input,
        requestId: id,
        expectedVersion: question.version,
        confirm: input.confirm ?? false,
      });
      retryRequestIds.delete(question.id);
      if (result.question.status !== "pending") clearDraftCache(question.id);
      localEpoch += 1;
      publish(applySelectionResult(state, result));
      return result;
    } catch (error) {
      const code = selectionErrorCode(error);
      if (code === "SELECTION_STALE") {
        retryRequestIds.delete(question.id);
        clearDraftCache(question.id);
      }
      publish(applySelectionError(state, code));
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
        const hydratedQuestions = await Promise.all(questions.map(async (question) => {
          if (question.status !== "pending") {
            clearDraftCache(question.id);
            return question;
          }
          const cached = await loadDraftCache(question);
          if (!cached) return question;
          return {
            ...question,
            selectedValues: [...cached.values],
            freeText: question.mode === "free" ? cached.freeText : question.freeText,
          };
        }));
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
        publish(applySelectionSnapshot(state, hydratedQuestions));
      } catch (error) {
        if (requestEpoch !== localEpoch || requestGeneration !== hydrateGeneration) return state;
        publish(applySelectionError(state, selectionErrorCode(error)));
      }
      return state;
    },

    async createQuestion(input) {
      try {
        const question = await options.client.createQuestion(options.conversationId, input);
        const superseded = state.questions.map((candidate) => {
          if (candidate.status !== "pending") return candidate;
          clearDraftCache(candidate.id);
          return { ...candidate, status: "stale" as const };
        });
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
      const confirm = question.mode === "single" && !question.requiresConfirmation;
      return persist(question, { values: draft.values, confirm });
    },

    setFreeText(questionId, value) {
      if (state.status === "saving") return;
      const nextState = setSelectionFreeText(state, questionId, value);
      if (nextState === state) return;
      localEpoch += 1;
      publish(nextState);
      saveDraftCache(questionId, selectionDraftFor(nextState, questionId));
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

const emptyDraftCache: ConversationSelectionDraftCache = {
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
};

function selectionErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "SELECTION_REQUEST_FAILED";
}
