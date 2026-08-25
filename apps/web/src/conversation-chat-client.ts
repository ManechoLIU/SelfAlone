import type {
  ConversationChatSendResult,
  ConversationChatSession,
} from "./conversation-chat-state";
import type { TrialQuotaStatus } from "@selfalone/contracts";

export class ConversationChatClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ConversationChatClientError";
  }
}

export type ConversationChatClientOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  headers?: HeadersInit;
};

export function createConversationChatClient(options: ConversationChatClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";
  const headers = options.headers;

  return {
    async listSessions(options: { query?: string } = {}): Promise<ConversationChatSession[]> {
      const query = options.query?.trim() ?? "";
      const suffix = query ? `?query=${encodeURIComponent(query)}` : "";
      const response = await request<{ conversations: ConversationChatSession[] }>(
        fetcher,
        `${baseUrl}/api/v1/conversations${suffix}`,
        { headers },
      );
      return response.conversations;
    },

    async createSession(id?: string): Promise<ConversationChatSession> {
      const response = await request<{ session: ConversationChatSession }>(
        fetcher,
        `${baseUrl}/api/v1/conversations`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(id ? { id } : {}),
        },
      );
      return response.session;
    },

    async getTrialQuota(): Promise<TrialQuotaStatus> {
      return request<TrialQuotaStatus>(
        fetcher,
        `${baseUrl}/api/v1/account/trial-quota`,
        { headers },
      );
    },

    async claimTrialQuota(): Promise<TrialQuotaStatus> {
      return request<TrialQuotaStatus>(
        fetcher,
        `${baseUrl}/api/v1/account/trial-quota/claim`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        },
      );
    },

    async getSession(conversationId: string): Promise<ConversationChatSession> {
      const response = await request<{ session: ConversationChatSession }>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}`,
        { headers },
      );
      return response.session;
    },

    async sendText(
      conversationId: string,
      input: { requestId?: string; text: string },
    ): Promise<ConversationChatSendResult> {
      return request<ConversationChatSendResult>(
        fetcher,
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(input),
          allowFailedResult: true,
        },
      );
    },
  };
}

async function request<T>(
  fetcher: typeof globalThis.fetch,
  url: string,
  options: RequestInit & { allowFailedResult?: boolean } = {},
): Promise<T> {
  const { allowFailedResult, ...init } = options;
  const response = await fetcher(url, init);
  const body = await response.json() as unknown;
  if (!response.ok && !(allowFailedResult && isFailedResult(body))) {
    const code = body && typeof body === "object" && "code" in body
      ? String((body as { code: unknown }).code)
      : "CONVERSATION_REQUEST_FAILED";
    throw new ConversationChatClientError(response.status, code);
  }
  return body as T;
}

function isFailedResult(value: unknown): value is { status: "failed" } {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "failed");
}
