export type ConversationApiDraft = {
  text: string;
  attachments: readonly string[];
};

export type ConversationApiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  requestId?: string;
};

export type ConversationApiSession = {
  id: string;
  revision: number;
  draft: ConversationApiDraft | null;
  context: readonly ConversationApiMessage[];
  activeRun: {
    requestId: string;
    kind: "response" | "task";
    status: "running";
    startedRevision: number;
    taskId?: string;
  } | null;
  tasks: readonly unknown[];
  works: readonly unknown[];
  deleted: boolean;
};

export type ConversationApiSendResult =
  | {
      status: "completed";
      session: ConversationApiSession;
      reply: string;
    }
  | {
      status: "failed";
      session: ConversationApiSession;
      errorCode: string;
      retainedDraft: ConversationApiDraft;
    };

export type ConversationHttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: unknown;
};

export type ConversationHttpResponse = {
  status: number;
  body: unknown;
};

export type ConversationTransport = (
  request: ConversationHttpRequest,
) => Promise<ConversationHttpResponse>;

export type ConversationApiOptions = {
  baseUrl?: string;
  /** M2-F1 supplies the exact session header; this adapter does not invent one. */
  authHeaders?: Readonly<Record<string, string>>;
  /** Alias kept for parity with the desktop client seam. */
  headers?: Readonly<Record<string, string>>;
  transport?: ConversationTransport;
};

export type ConversationApiClient = {
  getSession(conversationId: string): Promise<ConversationApiSession>;
  createSession(id?: string): Promise<ConversationApiSession>;
  hydrateOrCreateSession(conversationId?: string): Promise<ConversationApiSession>;
  sendText(
    conversationId: string,
    input: { requestId: string; text: string },
  ): Promise<ConversationApiSendResult>;
};

export type ConversationApiErrorCode =
  | "CONVERSATION_API_UNAVAILABLE"
  | "CONVERSATION_NETWORK_FAILED"
  | "CONVERSATION_REQUEST_FAILED"
  | string;

export class ConversationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ConversationApiErrorCode,
    readonly retryable = status === 0 || status >= 500,
  ) {
    super(code);
    this.name = "ConversationApiError";
  }
}

/**
 * Thin client for the already-stable conversation HTTP routes. Authentication
 * is deliberately injected by the M2-F1 bridge; no token is translated into
 * a guessed header here.
 */
export function createConversationApiClient(
  options: ConversationApiOptions = {},
): ConversationApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const authHeaders = cleanHeaders(options.authHeaders ?? options.headers);
  const transport = options.transport ?? createWxConversationTransport();

  async function request<T>(
    path: string,
    method: ConversationHttpRequest["method"],
    body?: unknown,
    allowFailedResult = false,
  ): Promise<T> {
    if (!baseUrl || !Object.keys(authHeaders).length) {
      throw new ConversationApiError(0, "CONVERSATION_API_UNAVAILABLE", false);
    }

    let response: ConversationHttpResponse;
    try {
      response = await transport({
        url: `${baseUrl}${path}`,
        method,
        headers: {
          ...authHeaders,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof ConversationApiError) throw error;
      throw new ConversationApiError(0, "CONVERSATION_NETWORK_FAILED", true);
    }

    if (response.status >= 200 && response.status < 300) return response.body as T;
    if (allowFailedResult && isFailedResult(response.body)) return response.body as T;

    throw new ConversationApiError(
      response.status,
      responseCode(response.body),
      response.status === 0 || response.status >= 500,
    );
  }

  async function getSession(conversationId: string) {
    return request<{ session: ConversationApiSession }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      "GET",
    ).then((payload) => payload.session);
  }

  async function createSession(id?: string) {
    return request<{ session: ConversationApiSession }>(
      "/api/v1/conversations",
      "POST",
      id ? { id } : {},
    ).then((payload) => payload.session);
  }

  async function hydrateOrCreateSession(conversationId?: string) {
    if (conversationId?.trim()) {
      try {
        return await getSession(conversationId);
      } catch (error) {
        if (!(error instanceof ConversationApiError) || error.status !== 404) throw error;
      }
    }
    return createSession();
  }

  function sendText(conversationId: string, input: { requestId: string; text: string }) {
    return request<ConversationApiSendResult>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      "POST",
      { requestId: input.requestId, text: input.text },
      true,
    );
  }

  return { getSession, createSession, hydrateOrCreateSession, sendText };
}

export function createWxConversationTransport(): ConversationTransport {
  return (request) => new Promise((resolve, reject) => {
    wx.request({
      url: request.url,
      method: request.method,
      header: { ...request.headers },
      ...(request.body === undefined ? {} : { data: request.body }),
      success: (response) => resolve({ status: response.statusCode, body: response.data }),
      fail: () => reject(new ConversationApiError(0, "CONVERSATION_NETWORK_FAILED", true)),
    });
  });
}

function normalizeBaseUrl(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.replace(/\/+$/, "");
}

function cleanHeaders(value: Readonly<Record<string, string>> | undefined) {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, headerValue]) => typeof headerValue === "string" && headerValue.trim()),
  );
}

function isFailedResult(value: unknown): value is Extract<ConversationApiSendResult, { status: "failed" }> {
  return Boolean(
    value
      && typeof value === "object"
      && (value as { status?: unknown }).status === "failed",
  );
}

function responseCode(value: unknown): string {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "CONVERSATION_REQUEST_FAILED";
}
