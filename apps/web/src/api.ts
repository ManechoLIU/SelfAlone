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
  if (response.status === 204) return null;
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
