import type {
  ConversationSelectionAnswerResult,
  ConversationSelectionQuestion,
  SelectionMode,
  ConversationSelectionOption,
} from "./conversation-selection-state";

export type CreateConversationSelectionInput = {
  id?: string;
  prompt: string;
  mode: SelectionMode;
  options: readonly ConversationSelectionOption[];
  requiresConfirmation?: boolean;
};

export type AnswerConversationSelectionInput = {
  requestId: string;
  expectedVersion: number;
  values?: readonly string[];
  freeText?: string;
  confirm?: boolean;
};

export type ConversationSelectionClientOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  headers?: HeadersInit;
};

export class ConversationSelectionClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ConversationSelectionClientError";
  }
}

export function createConversationSelectionClient(options: ConversationSelectionClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";
  const headers = options.headers;

  return {
    async listQuestions(conversationId: string): Promise<ConversationSelectionQuestion[]> {
      const response = await request<{ questions: ConversationSelectionQuestion[] }>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/selection-questions`,
        { headers },
      );
      return response.questions;
    },

    async createQuestion(
      conversationId: string,
      input: CreateConversationSelectionInput,
    ): Promise<ConversationSelectionQuestion> {
      const response = await request<{ question: ConversationSelectionQuestion }>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/selection-questions`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            id: input.id,
            prompt: input.prompt,
            mode: input.mode,
            options: input.options,
            requiresConfirmation: input.requiresConfirmation ?? false,
          }),
        },
      );
      return response.question;
    },

    async getQuestion(
      conversationId: string,
      questionId: string,
    ): Promise<ConversationSelectionQuestion> {
      const response = await request<{ question: ConversationSelectionQuestion }>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/selection-questions/${encodeURIComponent(questionId)}`,
        { headers },
      );
      return response.question;
    },

    async answerQuestion(
      conversationId: string,
      questionId: string,
      input: AnswerConversationSelectionInput,
    ): Promise<ConversationSelectionAnswerResult> {
      return request<ConversationSelectionAnswerResult>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/selection-questions/${encodeURIComponent(questionId)}/answer`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            ...input,
            values: input.values,
            confirm: input.confirm ?? false,
          }),
        },
      );
    },
  };
}

async function request<T>(
  fetcher: typeof globalThis.fetch,
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetcher(url, options);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = body && typeof body === "object" && "code" in body
      ? String((body as { code: unknown }).code)
      : "SELECTION_REQUEST_FAILED";
    throw new ConversationSelectionClientError(response.status, code);
  }
  return body as T;
}
