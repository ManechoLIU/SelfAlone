export type SelectionMode = "single" | "multi" | "free";

export type ConversationSelectionOption = {
  value: string;
  label: string;
};

export type ConversationSelectionStatus = "pending" | "submitted" | "stale";

export type ConversationSelectionAnswer = {
  values: readonly string[];
  freeText: string | null;
};

export type ConversationSelectionQuestion = {
  id: string;
  conversationId: string;
  version: number;
  prompt: string;
  mode: SelectionMode;
  requiresConfirmation: boolean;
  options: readonly ConversationSelectionOption[];
  status: ConversationSelectionStatus;
  selectedValues: readonly string[];
  freeText: string | null;
  answer: ConversationSelectionAnswer | null;
  answerRequestId: string | null;
};

export type SelectionDraft = {
  values: readonly string[];
  freeText: string;
};

export type ConversationSelectionState = {
  conversationId: string;
  questions: readonly ConversationSelectionQuestion[];
  activeQuestionId: string | null;
  drafts: Readonly<Record<string, SelectionDraft>>;
  status: "idle" | "loading" | "saving" | "error";
  errorCode: string | null;
};

export type ConversationSelectionAnswerResult = {
  status: "pending" | "submitted";
  question: ConversationSelectionQuestion;
};

export function createConversationSelectionState(conversationId: string): ConversationSelectionState {
  return {
    conversationId,
    questions: [],
    activeQuestionId: null,
    drafts: {},
    status: "idle",
    errorCode: null,
  };
}

export function applySelectionSnapshot(
  state: ConversationSelectionState,
  questions: readonly ConversationSelectionQuestion[],
): ConversationSelectionState {
  const nextQuestions = questions.map(cloneQuestion);
  const drafts: Record<string, SelectionDraft> = {};
  for (const question of nextQuestions) {
    drafts[question.id] = {
      values: [...question.selectedValues],
      freeText: question.freeText ?? "",
    };
  }
  return {
    ...state,
    questions: nextQuestions,
    activeQuestionId: [...nextQuestions].reverse().find((question) => question.status === "pending")?.id ?? null,
    drafts,
    status: "idle",
    errorCode: null,
  };
}

export function selectionDraftFor(
  state: ConversationSelectionState,
  questionId: string,
): SelectionDraft {
  return state.drafts[questionId] ?? { values: [], freeText: "" };
}

export function toggleSelectionOption(
  state: ConversationSelectionState,
  questionId: string,
  value: string,
): ConversationSelectionState {
  const question = state.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.status !== "pending" || question.mode === "free") return state;
  if (!question.options.some((option) => option.value === value)) return state;

  const current = selectionDraftFor(state, questionId);
  const values = question.mode === "single"
    ? [value]
    : current.values.includes(value)
      ? current.values.filter((candidate) => candidate !== value)
      : [...current.values, value];
  return updateDraft(state, questionId, { values, freeText: current.freeText });
}

export function setSelectionFreeText(
  state: ConversationSelectionState,
  questionId: string,
  freeText: string,
): ConversationSelectionState {
  const question = state.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.status !== "pending" || question.mode !== "free") return state;
  const current = selectionDraftFor(state, questionId);
  return updateDraft(state, questionId, { values: current.values, freeText });
}

export function beginSelectionHydration(state: ConversationSelectionState) {
  return { ...state, status: "loading" as const, errorCode: null };
}

export function beginSelectionSave(state: ConversationSelectionState) {
  return { ...state, status: "saving" as const, errorCode: null };
}

export function applySelectionError(
  state: ConversationSelectionState,
  errorCode: string,
): ConversationSelectionState {
  return { ...state, status: "error", errorCode };
}

export function applySelectionResult(
  state: ConversationSelectionState,
  result: ConversationSelectionAnswerResult,
): ConversationSelectionState {
  const question = cloneQuestion(result.question);
  const existingIndex = state.questions.findIndex((candidate) => candidate.id === question.id);
  const questions = existingIndex < 0
    ? [...state.questions, question]
    : state.questions.map((candidate, index) => index === existingIndex ? question : candidate);
  const drafts = { ...state.drafts };
  if (question.status === "pending") {
    drafts[question.id] = {
      values: [...question.selectedValues],
      freeText: question.freeText ?? "",
    };
  } else {
    delete drafts[question.id];
  }
  return {
    ...state,
    questions,
    activeQuestionId: [...questions].reverse().find((candidate) => candidate.status === "pending")?.id ?? null,
    drafts,
    status: "idle",
    errorCode: null,
  };
}

function updateDraft(
  state: ConversationSelectionState,
  questionId: string,
  draft: SelectionDraft,
): ConversationSelectionState {
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [questionId]: { values: [...draft.values], freeText: draft.freeText },
    },
    errorCode: null,
  };
}

function cloneQuestion(question: ConversationSelectionQuestion) {
  return {
    ...question,
    options: question.options.map((option) => ({ ...option })),
    selectedValues: [...question.selectedValues],
    answer: question.answer
      ? { values: [...question.answer.values], freeText: question.answer.freeText }
      : null,
  };
}
