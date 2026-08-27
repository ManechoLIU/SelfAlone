export type MiniAuthAccount = {
  id: string;
  email: string | null;
};

export type MiniAuthResult = {
  account: MiniAuthAccount;
  sessionToken: string;
  /** Epoch milliseconds used by the local session store; the API sends ISO. */
  expiresAt: number;
};

export type MiniAuthHttpRequest = {
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: unknown;
};

export type MiniAuthHttpResponse = {
  status: number;
  body: unknown;
};

export type MiniAuthTransport = (
  request: MiniAuthHttpRequest,
) => Promise<MiniAuthHttpResponse>;

export type MiniWxLogin = () => Promise<{ code: string }>;

export type MiniAuthClientOptions = {
  /** Explicitly supplied by the host composition; no domain is inferred. */
  baseUrl?: string;
  transport?: MiniAuthTransport;
  wxLogin?: MiniWxLogin;
};

export type MiniAuthClient = {
  login(): Promise<MiniAuthResult>;
};

export class MiniAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable = status === 0 || status >= 500,
  ) {
    super(code);
    this.name = "MiniAuthError";
  }
}

const authPath = "/api/v1/auth/wechat/miniapp";
const minimumOpaqueTokenLength = 24;

export function createMiniAuthClient(
  options: MiniAuthClientOptions = {},
): MiniAuthClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const transport = options.transport ?? createWxAuthTransport();
  const wxLogin = options.wxLogin ?? createWxLogin();

  async function login(): Promise<MiniAuthResult> {
    if (!baseUrl) {
      throw new MiniAuthError(0, "AUTH_API_UNAVAILABLE", false);
    }

    let loginResult: { code: string };
    try {
      loginResult = await wxLogin();
    } catch {
      throw new MiniAuthError(0, "WX_LOGIN_FAILED", true);
    }
    const code = typeof loginResult?.code === "string" ? loginResult.code.trim() : "";
    if (!code) throw new MiniAuthError(0, "WX_LOGIN_CODE_MISSING", false);

    let response: MiniAuthHttpResponse;
    try {
      response = await transport({
        url: `${baseUrl}${authPath}`,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: { code },
      });
    } catch (error) {
      if (error instanceof MiniAuthError) throw error;
      throw new MiniAuthError(0, "AUTH_NETWORK_FAILED", true);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new MiniAuthError(
        response.status,
        responseCode(response.body),
        response.status === 0 || response.status >= 500,
      );
    }

    const result = parseAuthResult(response.body);
    if (!result) throw new MiniAuthError(response.status, "AUTH_RESPONSE_INVALID", false);
    return result;
  }

  return { login };
}

export function createWxLogin(): MiniWxLogin {
  return () => new Promise((resolve, reject) => {
    wx.login({
      success: (result) => resolve({ code: result.code }),
      fail: () => reject(new MiniAuthError(0, "WX_LOGIN_FAILED", true)),
    });
  });
}

export function createWxAuthTransport(): MiniAuthTransport {
  return (request) => new Promise((resolve, reject) => {
    wx.request({
      url: request.url,
      method: request.method,
      header: { ...request.headers },
      data: request.body,
      success: (response) => resolve({ status: response.statusCode, body: response.data }),
      fail: () => reject(new MiniAuthError(0, "AUTH_NETWORK_FAILED", true)),
    });
  });
}

function parseAuthResult(value: unknown): MiniAuthResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    account?: unknown;
    sessionToken?: unknown;
    expiresAt?: unknown;
  };
  if (!candidate.account || typeof candidate.account !== "object") return null;
  const account = candidate.account as { id?: unknown; email?: unknown };
  if (typeof account.id !== "string" || !account.id.trim()) return null;
  if (account.email !== null && typeof account.email !== "string") return null;
  if (
    typeof candidate.sessionToken !== "string"
    || candidate.sessionToken.length < minimumOpaqueTokenLength
  ) return null;
  const expiresAt = parseApiExpiry(candidate.expiresAt);
  if (expiresAt === null) return null;
  return {
    account: { id: account.id, email: account.email },
    sessionToken: candidate.sessionToken,
    expiresAt,
  };
}

function parseApiExpiry(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const epochMilliseconds = Date.parse(value);
  return Number.isFinite(epochMilliseconds) && epochMilliseconds > 0
    ? epochMilliseconds
    : null;
}

function normalizeBaseUrl(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.replace(/\/+$/, "");
}

function responseCode(value: unknown): string {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "AUTH_REQUEST_FAILED";
}
