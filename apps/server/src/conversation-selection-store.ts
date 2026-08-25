import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  applySelectionAnswer,
  createSelectionQuestion,
  SelectionCoreError,
  type ConversationSelectionQuestion,
  type ConversationSelectionOption,
  type SelectionAnswerInput,
  type SelectionApplyResult,
  type SelectionMode,
} from "./conversation-selection";

export type ConversationSelectionStoreOptions = {
  idFactory?: () => string;
};

export type CreateSelectionQuestionInput = {
  id?: string;
  prompt: string;
  mode: SelectionMode;
  options?: readonly ConversationSelectionOption[];
  requiresConfirmation?: boolean;
};

export type AnswerSelectionQuestionInput = SelectionAnswerInput & {
  accountId: string;
  conversationId: string;
  questionId: string;
  requestId: string;
  expectedVersion: number;
};

export type ConversationSelectionAnswerResult = {
  status: "pending" | "submitted";
  question: ConversationSelectionQuestion;
};

export type ConversationSelectionStoreErrorCode =
  | "SELECTION_NOT_FOUND"
  | "SELECTION_CONVERSATION_NOT_FOUND"
  | "SELECTION_REQUEST_ID_CONFLICT"
  | "SELECTION_STALE"
  | "ACCOUNT_ID_REQUIRED"
  | "CONVERSATION_ID_REQUIRED"
  | "QUESTION_ID_REQUIRED"
  | "REQUEST_ID_REQUIRED"
  | "SELECTION_VERSION_INVALID"
  | "SELECTION_DATA_INVALID"
  | "SELECTION_ID_CONFLICT";

export class ConversationSelectionStoreError extends Error {
  constructor(readonly code: ConversationSelectionStoreErrorCode | string) {
    super(code);
    this.name = "ConversationSelectionStoreError";
  }
}

type SelectionRow = {
  id: string;
  accountId: string;
  conversationId: string;
  version: number;
  prompt: string;
  mode: SelectionMode;
  requiresConfirmation: boolean;
  options: unknown;
  status: ConversationSelectionQuestion["status"];
  selectedValues: unknown;
  freeText: string | null;
  answer: unknown;
  answerRequestId: string | null;
  lastRequestId: string | null;
  lastRequestPayload: unknown;
};

export class ConversationSelectionStore {
  readonly #sql: Sql;
  readonly #idFactory: () => string;

  constructor(sql: Sql, options: ConversationSelectionStoreOptions = {}) {
    this.#sql = sql;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async createQuestion(
    accountId: string,
    conversationId: string,
    input: CreateSelectionQuestionInput,
  ): Promise<ConversationSelectionQuestion> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(conversationId, "CONVERSATION_ID_REQUIRED");
    const question = createSelectionQuestion({
      id: input.id ?? this.#idFactory(),
      conversationId,
      prompt: input.prompt,
      mode: input.mode,
      options: input.options,
      requiresConfirmation: input.requiresConfirmation,
    });

    try {
      await this.#sql.begin(async (transaction) => {
        const [conversation] = await transaction<{ id: string }[]>`
          SELECT id
          FROM conversations
          WHERE id = ${conversationId}
            AND account_id = ${accountId}
            AND deleted = false
          FOR UPDATE
        `;
        if (!conversation) throw new ConversationSelectionStoreError("SELECTION_CONVERSATION_NOT_FOUND");

        await transaction`
          UPDATE conversation_selection_questions
          SET status = 'stale', updated_at = now()
          WHERE account_id = ${accountId}
            AND conversation_id = ${conversationId}
            AND status = 'pending'
        `;
        await insertQuestion(transaction, accountId, question);
      });
    } catch (error) {
      if (error instanceof ConversationSelectionStoreError) throw error;
      if (isUniqueViolation(error)) {
        throw new ConversationSelectionStoreError("SELECTION_ID_CONFLICT");
      }
      throw error;
    }
    return cloneQuestion(question);
  }

  async getQuestion(
    accountId: string,
    conversationId: string,
    questionId: string,
  ): Promise<ConversationSelectionQuestion | null> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(conversationId, "CONVERSATION_ID_REQUIRED");
    assertIdentifier(questionId, "QUESTION_ID_REQUIRED");
    const [row] = await this.#sql<SelectionRow[]>`
      SELECT
        id,
        account_id AS "accountId",
        conversation_id AS "conversationId",
        version,
        prompt,
        mode,
        requires_confirmation AS "requiresConfirmation",
        options,
        status,
        selected_values AS "selectedValues",
        free_text AS "freeText",
        answer,
        answer_request_id AS "answerRequestId",
        last_request_id AS "lastRequestId",
        last_request_payload AS "lastRequestPayload"
      FROM conversation_selection_questions
      WHERE account_id = ${accountId}
        AND conversation_id = ${conversationId}
        AND id = ${questionId}
    `;
    return row ? cloneQuestion(parseQuestion(row)) : null;
  }

  async listQuestions(
    accountId: string,
    conversationId: string,
  ): Promise<ConversationSelectionQuestion[]> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(conversationId, "CONVERSATION_ID_REQUIRED");
    const rows = await this.#sql<SelectionRow[]>`
      SELECT
        id,
        account_id AS "accountId",
        conversation_id AS "conversationId",
        version,
        prompt,
        mode,
        requires_confirmation AS "requiresConfirmation",
        options,
        status,
        selected_values AS "selectedValues",
        free_text AS "freeText",
        answer,
        answer_request_id AS "answerRequestId",
        last_request_id AS "lastRequestId",
        last_request_payload AS "lastRequestPayload"
      FROM conversation_selection_questions
      WHERE account_id = ${accountId}
        AND conversation_id = ${conversationId}
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map((row) => cloneQuestion(parseQuestion(row)));
  }

  async answerQuestion(
    input: AnswerSelectionQuestionInput,
  ): Promise<ConversationSelectionAnswerResult> {
    assertIdentifier(input.accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(input.conversationId, "CONVERSATION_ID_REQUIRED");
    assertIdentifier(input.questionId, "QUESTION_ID_REQUIRED");
    assertIdentifier(input.requestId, "REQUEST_ID_REQUIRED");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new ConversationSelectionStoreError("SELECTION_VERSION_INVALID");
    }

    return this.#sql.begin(async (transaction) => {
      const [conversation] = await transaction<{ id: string }[]>`
        SELECT id
        FROM conversations
        WHERE id = ${input.conversationId}
          AND account_id = ${input.accountId}
          AND deleted = false
        FOR UPDATE
      `;
      if (!conversation) throw new ConversationSelectionStoreError("SELECTION_NOT_FOUND");
      const [row] = await selectForUpdate(transaction, input);
      if (!row) throw new ConversationSelectionStoreError("SELECTION_NOT_FOUND");
      const current = parseQuestion(row);
      const mutation = selectionMutationPayload(input);

      if (current.status === "stale") {
        throw new ConversationSelectionStoreError("SELECTION_STALE");
      }

      if (row.lastRequestId === input.requestId) {
        if (!sameMutation(row.lastRequestPayload, mutation)) {
          throw new ConversationSelectionStoreError("SELECTION_REQUEST_ID_CONFLICT");
        }
        if (current.status === "pending") {
          return { status: "pending", question: cloneQuestion(current) };
        }
        if (!current.answer) {
          throw new ConversationSelectionStoreError("SELECTION_STALE");
        }
        return { status: "submitted", question: cloneQuestion(current) };
      }

      if (current.answerRequestId) {
        if (current.answerRequestId !== input.requestId) {
          throw new ConversationSelectionStoreError("SELECTION_STALE");
        }
        if (!sameSubmittedAnswer(current, input) || current.status !== "submitted" || !current.answer) {
          throw new ConversationSelectionStoreError("SELECTION_REQUEST_ID_CONFLICT");
        }
        return { status: "submitted", question: cloneQuestion(current) };
      }

      if (current.status === "submitted") {
        throw new ConversationSelectionStoreError("SELECTION_STALE");
      }

      if (current.status !== "pending" || current.version !== input.expectedVersion) {
        throw new ConversationSelectionStoreError("SELECTION_STALE");
      }

      let applied: SelectionApplyResult;
      try {
        applied = applySelectionAnswer(current, input);
      } catch (error) {
        if (error instanceof SelectionCoreError) {
          throw new ConversationSelectionStoreError(error.code);
        }
        throw error;
      }

      const persisted = {
        ...applied.question,
        answerRequestId: applied.status === "submitted" ? input.requestId : null,
      };
      await updateQuestion(transaction, input, persisted, input.requestId, mutation);
      return {
        status: applied.status,
        question: cloneQuestion(persisted),
      };
    });
  }
}

async function selectForUpdate(
  transaction: TransactionSql,
  input: Pick<AnswerSelectionQuestionInput, "accountId" | "conversationId" | "questionId">,
) {
  return transaction<SelectionRow[]>`
    SELECT
      id,
      account_id AS "accountId",
      conversation_id AS "conversationId",
      version,
      prompt,
      mode,
      requires_confirmation AS "requiresConfirmation",
      options,
      status,
      selected_values AS "selectedValues",
      free_text AS "freeText",
      answer,
      answer_request_id AS "answerRequestId",
      last_request_id AS "lastRequestId",
      last_request_payload AS "lastRequestPayload"
    FROM conversation_selection_questions
    WHERE account_id = ${input.accountId}
      AND conversation_id = ${input.conversationId}
      AND id = ${input.questionId}
    FOR UPDATE
  `;
}

async function insertQuestion(
  transaction: TransactionSql,
  accountId: string,
  question: ConversationSelectionQuestion,
) {
  await transaction`
    INSERT INTO conversation_selection_questions (
      id, account_id, conversation_id, version, prompt, mode, requires_confirmation, options,
      status, selected_values, free_text, answer, answer_request_id, last_request_id, last_request_payload
    )
    VALUES (
      ${question.id},
      ${accountId},
      ${question.conversationId},
      ${question.version},
      ${question.prompt},
      ${question.mode},
      ${question.requiresConfirmation},
      ${transaction.json(question.options)},
      ${question.status},
      ${transaction.json(question.selectedValues)},
      ${question.freeText},
      ${null},
      ${null},
      ${null},
      ${null}
    )
  `;
}

async function updateQuestion(
  transaction: TransactionSql,
  input: Pick<AnswerSelectionQuestionInput, "accountId" | "conversationId" | "questionId">,
  question: ConversationSelectionQuestion,
  requestId: string,
  requestPayload: SelectionMutationPayload,
) {
  await transaction`
    UPDATE conversation_selection_questions
    SET version = ${question.version},
        status = ${question.status},
        selected_values = ${transaction.json(question.selectedValues)},
        free_text = ${question.freeText},
        answer = ${question.answer ? transaction.json(question.answer) : null},
        answer_request_id = ${question.answerRequestId},
        last_request_id = ${requestId},
        last_request_payload = ${transaction.json(requestPayload)},
        updated_at = now()
    WHERE account_id = ${input.accountId}
      AND conversation_id = ${input.conversationId}
      AND id = ${input.questionId}
  `;
}

function parseQuestion(row: SelectionRow): ConversationSelectionQuestion {
  if (
    !Array.isArray(row.options)
    || !Array.isArray(row.selectedValues)
    || typeof row.requiresConfirmation !== "boolean"
    || row.options.some((option) => !isOption(option))
    || row.selectedValues.some((value) => typeof value !== "string")
    || (row.answer !== null && !isAnswer(row.answer))
  ) {
    throw new ConversationSelectionStoreError("SELECTION_DATA_INVALID");
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    version: row.version,
    prompt: row.prompt,
    mode: row.mode,
    requiresConfirmation: row.requiresConfirmation,
    options: row.options,
    status: row.status,
    selectedValues: row.selectedValues,
    freeText: row.freeText,
    answer: row.answer,
    answerRequestId: row.answerRequestId,
  };
}

type SelectionMutationPayload = {
  values: string[];
  freeText: string | null;
  confirm: boolean;
};

function selectionMutationPayload(input: SelectionAnswerInput): SelectionMutationPayload {
  return {
    values: [...(input.values ?? [])].map((value) => value.trim()).filter(Boolean).sort(),
    freeText: input.freeText?.trim() || null,
    confirm: input.confirm === true,
  };
}

function sameSubmittedAnswer(question: ConversationSelectionQuestion, input: SelectionAnswerInput) {
  const expected = selectionMutationPayload(input);
  const persistedValues = question.answer ? [...question.answer.values].sort() : [];
  const submittedValues = [...expected.values].sort();
  return persistedValues.length === submittedValues.length
    && persistedValues.every((entry, index) => entry === submittedValues[index])
    && (question.answer?.freeText ?? null) === expected.freeText;
}

function sameMutation(value: unknown, expected: SelectionMutationPayload) {
  const candidate = typeof value === "string"
    ? parseMutationPayload(value)
    : value;
  if (
    !candidate
    || typeof candidate !== "object"
    || !Array.isArray((candidate as { values?: unknown }).values)
    || !(candidate as { values: unknown[] }).values.every((entry) => typeof entry === "string")
    || ((candidate as { freeText?: unknown }).freeText !== null
      && typeof (candidate as { freeText?: unknown }).freeText !== "string")
    || typeof (candidate as { confirm?: unknown }).confirm !== "boolean"
  ) {
    return false;
  }
  const candidateValues = [...(candidate as { values: string[] }).values].sort();
  return candidateValues.length === expected.values.length
    && candidateValues.every((entry, index) => entry === expected.values[index])
    && (candidate as { freeText: string | null }).freeText === expected.freeText
    && (candidate as { confirm: boolean }).confirm === expected.confirm;
}

function parseMutationPayload(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isOption(value: unknown): value is ConversationSelectionOption {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { value?: unknown }).value === "string"
    && typeof (value as { label?: unknown }).label === "string",
  );
}

function isAnswer(value: unknown): value is { values: string[]; freeText: string | null } {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray((value as { values?: unknown }).values)
    && (value as { values: unknown[] }).values.every((entry) => typeof entry === "string")
    && ((value as { freeText?: unknown }).freeText === null
      || typeof (value as { freeText?: unknown }).freeText === "string"),
  );
}

function cloneQuestion(question: ConversationSelectionQuestion) {
  return JSON.parse(JSON.stringify(question)) as ConversationSelectionQuestion;
}

function assertIdentifier(value: string, code: ConversationSelectionStoreErrorCode) {
  if (!value.trim()) throw new ConversationSelectionStoreError(code);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}
