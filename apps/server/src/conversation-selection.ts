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
  assistantMessageId: string;
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

export type SelectionAnswerInput = {
  values?: readonly string[];
  freeText?: string;
  confirm?: boolean;
};

export type SelectionApplyResult = {
  status: "pending" | "submitted";
  question: ConversationSelectionQuestion;
};

export type SelectionCoreErrorCode =
  | "SELECTION_STALE"
  | "SELECTION_ID_REQUIRED"
  | "SELECTION_CONVERSATION_REQUIRED"
  | "SELECTION_MESSAGE_REQUIRED"
  | "SELECTION_PROMPT_REQUIRED"
  | "SELECTION_OPTION_REQUIRED"
  | "SELECTION_OPTION_INVALID"
  | "SELECTION_OPTION_DUPLICATE"
  | "SELECTION_VALUE_INVALID"
  | "SELECTION_INPUT_REQUIRED";

export class SelectionCoreError extends Error {
  constructor(readonly code: SelectionCoreErrorCode) {
    super(code);
    this.name = "SelectionCoreError";
  }
}

export function createSelectionQuestion(input: {
  id: string;
  conversationId: string;
  assistantMessageId: string;
  prompt: string;
  mode: SelectionMode;
  options?: readonly ConversationSelectionOption[];
  requiresConfirmation?: boolean;
}): ConversationSelectionQuestion {
  const id = input.id.trim();
  const conversationId = input.conversationId.trim();
  const assistantMessageId = input.assistantMessageId.trim();
  const prompt = input.prompt.trim();
  if (!id) throw new SelectionCoreError("SELECTION_ID_REQUIRED");
  if (!conversationId) throw new SelectionCoreError("SELECTION_CONVERSATION_REQUIRED");
  if (!assistantMessageId) throw new SelectionCoreError("SELECTION_MESSAGE_REQUIRED");
  if (!prompt) throw new SelectionCoreError("SELECTION_PROMPT_REQUIRED");

  const options = normalizeOptions(input.options ?? []);
  if (input.mode !== "free" && options.length === 0) {
    throw new SelectionCoreError("SELECTION_OPTION_REQUIRED");
  }
  if (input.mode === "free" && options.length > 0) {
    throw new SelectionCoreError("SELECTION_OPTION_INVALID");
  }

  return {
    id,
    conversationId,
    assistantMessageId,
    version: 1,
    prompt,
    mode: input.mode,
    requiresConfirmation: input.requiresConfirmation ?? false,
    options,
    status: "pending",
    selectedValues: [],
    freeText: null,
    answer: null,
    answerRequestId: null,
  };
}

export function applySelectionAnswer(
  question: ConversationSelectionQuestion,
  input: SelectionAnswerInput,
): SelectionApplyResult {
  if (question.status !== "pending") {
    throw new SelectionCoreError("SELECTION_STALE");
  }

  const values = normalizeValues(input.values ?? []);
  const allowedValues = new Set(question.options.map((option) => option.value));
  if (values.some((value) => !allowedValues.has(value))) {
    throw new SelectionCoreError("SELECTION_VALUE_INVALID");
  }

  if (question.mode === "single") {
    if (values.length !== 1) throw new SelectionCoreError("SELECTION_INPUT_REQUIRED");
    if (question.requiresConfirmation && input.confirm !== true) {
      return pending(question, values, null);
    }
    return submitted(question, values, null);
  }

  if (question.mode === "multi") {
    if (input.confirm && values.length === 0) {
      throw new SelectionCoreError("SELECTION_INPUT_REQUIRED");
    }
    const next = pending(question, values, null);
    return input.confirm ? submitted(next.question, values, null) : next;
  }

  const freeText = input.freeText?.trim() ?? "";
  if (input.confirm && !freeText) {
    throw new SelectionCoreError("SELECTION_INPUT_REQUIRED");
  }
  const next = pending(question, [], freeText || null);
  return input.confirm ? submitted(next.question, [], freeText) : next;
}

function pending(
  question: ConversationSelectionQuestion,
  values: readonly string[],
  freeText: string | null,
): SelectionApplyResult {
  return {
    status: "pending",
    question: {
      ...question,
      version: question.version + 1,
      selectedValues: [...values],
      freeText,
      answer: null,
      answerRequestId: null,
    },
  };
}

function submitted(
  question: ConversationSelectionQuestion,
  values: readonly string[],
  freeText: string | null,
): SelectionApplyResult {
  return {
    status: "submitted",
    question: {
      ...question,
      version: question.version + 1,
      status: "submitted",
      selectedValues: [...values],
      freeText,
      answer: { values: [...values], freeText },
      answerRequestId: null,
    },
  };
}

function normalizeOptions(options: readonly ConversationSelectionOption[]) {
  const normalized = options.map((option) => ({
    value: option.value.trim(),
    label: option.label.trim(),
  }));
  if (normalized.some((option) => !option.value || !option.label)) {
    throw new SelectionCoreError("SELECTION_OPTION_INVALID");
  }
  const values = new Set<string>();
  for (const option of normalized) {
    if (values.has(option.value)) throw new SelectionCoreError("SELECTION_OPTION_DUPLICATE");
    values.add(option.value);
  }
  return normalized;
}

function normalizeValues(values: readonly string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new SelectionCoreError("SELECTION_OPTION_DUPLICATE");
  }
  return normalized;
}
