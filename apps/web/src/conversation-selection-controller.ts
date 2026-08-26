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
  getQuestion?: (
    conversationId: string,
    questionId: string,
  ) => Promise<ConversationSelectionQuestion>;
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

type SelectionMutation = {
  requestId: string;
  expectedVersion: number;
  values: readonly string[];
  freeText?: string;
  confirm: boolean;
};

type ConversationSelectionControllerState = ConversationSelectionState & {
  recoveryQuestionId?: string;
};

export type ConversationSelectionController = {
  getState(): ConversationSelectionControllerState;
  subscribe(listener: ConversationSelectionStateListener): () => void;
  hydrate(): Promise<ConversationSelectionState>;
  createQuestion(input: CreateConversationSelectionInput): Promise<ConversationSelectionQuestion | undefined>;
  selectOption(questionId: string, value: string): Promise<ConversationSelectionAnswerResult | undefined>;
  setFreeText(questionId: string, value: string): void;
  confirm(questionId: string): Promise<ConversationSelectionAnswerResult | undefined>;
  retry(questionId: string): Promise<ConversationSelectionAnswerResult | undefined>;
};

export function createConversationSelectionController(
  options: ConversationSelectionControllerOptions,
): ConversationSelectionController {
  let state: ConversationSelectionControllerState = createConversationSelectionState(options.conversationId);
  const listeners = new Set<ConversationSelectionStateListener>();
  const ambiguousMutations = new Map<string, SelectionMutation>();
  const mutationGenerations = new Map<string, number>();
  const draftCache = options.draftCache ?? emptyDraftCache;
  let localEpoch = 0;
  let hydrateGeneration = 0;

  function publish(nextState: ConversationSelectionControllerState) {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  function clearRecovery(nextState: ConversationSelectionState): ConversationSelectionControllerState {
    const { recoveryQuestionId: _recoveryQuestionId, ...withoutRecovery } = nextState as ConversationSelectionControllerState;
    return withoutRecovery;
  }

  function markRecovery(nextState: ConversationSelectionState, questionId: string): ConversationSelectionControllerState {
    return { ...nextState, recoveryQuestionId: questionId };
  }

  function beginMutationAttempt(questionId: string) {
    const nextGeneration = (mutationGenerations.get(questionId) ?? 0) + 1;
    mutationGenerations.set(questionId, nextGeneration);
    return nextGeneration;
  }

  function isCurrentMutationAttempt(questionId: string, generation: number) {
    return mutationGenerations.get(questionId) === generation;
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

  async function reconcileQuestion(questionId: string, generation: number) {
    try {
      const question = options.client.getQuestion
        ? await options.client.getQuestion(options.conversationId, questionId)
        : (await options.client.listQuestions(options.conversationId)).find((candidate) => candidate.id === questionId);
      if (!question) throw new Error("SELECTION_NOT_FOUND");
      if (!isCurrentMutationAttempt(questionId, generation)) return undefined;

      const currentDraft = selectionDraftFor(state, questionId);
      const questions = state.questions.map((candidate) => candidate.id === questionId ? question : candidate);
      const nextDrafts = { ...state.drafts };
      if (question.status === "pending") {
        nextDrafts[questionId] = {
          values: [...currentDraft.values],
          freeText: currentDraft.freeText,
        };
      } else {
        delete nextDrafts[questionId];
      }
      const activeQuestionId = question.status === "pending"
        ? questionId
        : [...questions].reverse().find((candidate) => candidate.status === "pending")?.id ?? null;
      publish(clearRecovery({
        ...state,
        questions,
        drafts: nextDrafts,
        activeQuestionId,
        status: "idle",
        errorCode: null,
      }));
      return question;
    } catch (error) {
      if (!isCurrentMutationAttempt(questionId, generation)) return undefined;
      publish(applySelectionError(clearRecovery(state), selectionErrorCode(error)));
      return undefined;
    }
  }

  async function persist(
    question: ConversationSelectionQuestion,
    input: Omit<AnswerConversationSelectionInput, "requestId" | "expectedVersion"> & { requestId?: string },
  ) {
    const draft = selectionDraftFor(state, question.id);
    const confirm = input.confirm ?? false;
    if (confirm && !isValidConfirmation(question, draft)) return undefined;
    const generation = beginMutationAttempt(question.id);

    const recovery = ambiguousMutations.get(question.id);
    const desiredMutation = {
      values: [...(input.values ?? [])],
      freeText: question.mode === "free" ? input.freeText ?? "" : undefined,
      confirm,
    };
    let currentQuestion = question;
    let expectedVersion = question.version;
    let id = input.requestId;
    const exactRetry = recovery
      && recovery.expectedVersion === question.version
      && sameMutation(recovery, desiredMutation);

    if (exactRetry) {
      id = recovery.requestId;
      expectedVersion = recovery.expectedVersion;
    } else if (recovery) {
      const reconciled = await reconcileQuestion(question.id, generation);
      if (!reconciled) return undefined;
      currentQuestion = reconciled;
      if (currentQuestion.status !== "pending") {
        ambiguousMutations.delete(question.id);
        clearDraftCache(question.id);
        return undefined;
      }
      expectedVersion = currentQuestion.version;
      id = undefined;
    }

    if (!isCurrentMutationAttempt(question.id, generation)) return undefined;

    const mutation: SelectionMutation = {
      requestId: id ?? requestId(),
      expectedVersion,
      values: desiredMutation.values,
      freeText: desiredMutation.freeText,
      confirm: desiredMutation.confirm,
    };
    ambiguousMutations.delete(question.id);
    if (!isCurrentMutationAttempt(question.id, generation)) return undefined;
    saveDraftCache(question.id, draft);
    localEpoch += 1;
    publish(beginSelectionSave(clearRecovery(state)));
    try {
      const result = await options.client.answerQuestion(options.conversationId, currentQuestion.id, {
        values: mutation.values,
        freeText: mutation.freeText,
        confirm: mutation.confirm,
        requestId: mutation.requestId,
        expectedVersion: mutation.expectedVersion,
      });
      if (!isCurrentMutationAttempt(question.id, generation)) return undefined;
      if (result.question.status !== "pending") clearDraftCache(question.id);
      localEpoch += 1;
      publish(clearRecovery(applySelectionResult(state, result)));
      return result;
    } catch (error) {
      if (!isCurrentMutationAttempt(question.id, generation)) return undefined;
      const code = selectionErrorCode(error);
      if (code === "SELECTION_STALE") {
        clearDraftCache(question.id);
        publish(applySelectionError(clearRecovery(state), code));
      } else {
        ambiguousMutations.set(question.id, mutation);
        publish(markRecovery(applySelectionError(state, code), question.id));
      }
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
        publish(clearRecovery(applySelectionSnapshot(state, hydratedQuestions)));
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
          ambiguousMutations.delete(candidate.id);
          return { ...candidate, status: "stale" as const };
        });
        publish(clearRecovery(applySelectionSnapshot(state, [...superseded, question])));
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
      beginMutationAttempt(questionId);
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

    async retry(questionId) {
      if (state.status === "saving") return undefined;
      const question = state.questions.find((candidate) => candidate.id === questionId);
      const recovery = ambiguousMutations.get(questionId);
      if (!question || question.status !== "pending" || !recovery) return undefined;
      const draft = selectionDraftFor(state, questionId);
      return persist(question, {
        values: draft.values,
        freeText: question.mode === "free" ? draft.freeText : undefined,
        confirm: recovery.confirm,
      });
    },
  };
}

const emptyDraftCache: ConversationSelectionDraftCache = {
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
};

function sameMutation(
  left: Pick<SelectionMutation, "values" | "freeText" | "confirm">,
  right: Pick<SelectionMutation, "values" | "freeText" | "confirm">,
) {
  return left.confirm === right.confirm
    && left.freeText === right.freeText
    && left.values.length === right.values.length
    && left.values.every((value, index) => value === right.values[index]);
}

function isValidConfirmation(
  question: ConversationSelectionQuestion,
  draft: SelectionDraft,
) {
  if (question.mode === "free") return draft.freeText.trim().length > 0;
  if (question.mode === "multi") return draft.values.length > 0;
  return draft.values.length === 1;
}

function selectionErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "SELECTION_REQUEST_FAILED";
}
