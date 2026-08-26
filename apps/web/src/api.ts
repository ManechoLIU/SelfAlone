import type { TextModelCredentialResponse, TextModelProvider } from "@selfalone/contracts";
import type { TextModelCredential } from "./model-config";

export type ApiErrorPayload = {
  code?: unknown;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function hasJsonBody(body: BodyInit | null | undefined) {
  return body !== null
    && body !== undefined
    && !(body instanceof FormData)
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !(body instanceof URLSearchParams);
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorCode(body: unknown, status: number) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as ApiErrorPayload).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return `HTTP_${status}`;
}

export async function requestJson<T>(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (hasJsonBody(init.body) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "same-origin",
  });
  const body = await readBody(response);
  if (!response.ok) throw new ApiError(errorCode(body, response.status), response.status);
  return body as T;
}

export async function requestNoContent(input: RequestInfo | URL, init: RequestInit = {}) {
  await requestJson<unknown>(input, init);
}

type LegacyTextModelCredentialResponse =
  | TextModelCredentialResponse
  | { configured: false }
  | {
      status: "not_configured" | "verified";
      provider: TextModelProvider | null;
      keyHint: string | null;
      workspaceId: string | null;
      verifiedAt: string | null;
      catalogVersion: string;
    };

function mapTextModelCredential(payload: LegacyTextModelCredentialResponse | undefined): TextModelCredential | null {
  if (!payload || (typeof payload === "object" && "configured" in payload && payload.configured === false)) {
    return null;
  }
  if ("keyHint" in payload) {
    if (payload.status === "not_configured" || !payload.provider || !payload.keyHint || !payload.verifiedAt) {
      return null;
    }
    return {
      provider: payload.provider,
      maskedApiKey: payload.keyHint,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      verifiedAt: payload.verifiedAt,
      catalogVersion: payload.catalogVersion,
      status: "verified",
    };
  }
  return payload as TextModelCredential;
}

export async function getTextModelCredential(): Promise<TextModelCredential | null> {
  const payload = await requestJson<LegacyTextModelCredentialResponse>("/api/v1/model-credentials/text");
  return mapTextModelCredential(payload);
}

export type SaveTextModelCredentialInput = {
  provider: TextModelProvider;
  apiKey: string;
  workspaceId?: string;
};

export async function saveTextModelCredential(input: SaveTextModelCredentialInput) {
  const body: SaveTextModelCredentialInput = {
    provider: input.provider,
    apiKey: input.apiKey,
  };
  if (input.provider === "qwen" && input.workspaceId?.trim()) body.workspaceId = input.workspaceId.trim();
  const payload = await requestJson<LegacyTextModelCredentialResponse>("/api/v1/model-credentials/text", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return mapTextModelCredential(payload);
}

export async function deleteTextModelCredential() {
  await requestNoContent("/api/v1/model-credentials/text", { method: "DELETE" });
}
