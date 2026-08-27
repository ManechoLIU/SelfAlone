import { describe, expect, it, vi } from "vitest";
import {
  MiniAuthError,
  createMiniAuthClient,
  type MiniAuthHttpRequest,
  type MiniAuthHttpResponse,
} from "./auth";

const sessionToken = "opaque-mini-session-token-1234567890";
const expiresAt = "2030-03-04T05:06:07.000Z";

function response(body: unknown, status = 200): MiniAuthHttpResponse {
  return { status, body };
}

describe("miniapp WeChat auth adapter", () => {
  it("exchanges an injected wx.login code using the fixed miniapp auth route", async () => {
    const requests: MiniAuthHttpRequest[] = [];
    const wxLogin = vi.fn(async () => ({ code: "wx-code" }));
    const transport = vi.fn(async (request: MiniAuthHttpRequest) => {
      requests.push(request);
      return response({
        account: { id: "account-a", email: null },
        sessionToken,
        expiresAt,
      });
    });
    const client = createMiniAuthClient({
      baseUrl: "https://api.example.test/",
      wxLogin,
      transport,
    });

    await expect(client.login()).resolves.toEqual({
      account: { id: "account-a", email: null },
      sessionToken,
      expiresAt: Date.parse(expiresAt),
    });
    expect(wxLogin).toHaveBeenCalledOnce();
    expect(requests).toEqual([{
      url: "https://api.example.test/api/v1/auth/wechat/miniapp",
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: { code: "wx-code" },
    }]);
  });

  it("fails closed before wx.login or transport when no API base is configured", async () => {
    const wxLogin = vi.fn(async () => ({ code: "wx-code" }));
    const transport = vi.fn(async () => response({}));
    const client = createMiniAuthClient({ wxLogin, transport });

    await expect(client.login()).rejects.toEqual(
      new MiniAuthError(0, "AUTH_API_UNAVAILABLE", false),
    );
    expect(wxLogin).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not treat a failed or malformed exchange as a successful session", async () => {
    const wxLogin = vi.fn(async () => ({ code: "wx-code" }));
    const failedClient = createMiniAuthClient({
      baseUrl: "https://api.example.test",
      wxLogin,
      transport: async () => response({ code: "AUTH_REQUIRED" }, 401),
    });
    await expect(failedClient.login()).rejects.toEqual(
      new MiniAuthError(401, "AUTH_REQUIRED", false),
    );

    const malformedClient = createMiniAuthClient({
      baseUrl: "https://api.example.test",
      wxLogin,
      transport: async () => response({ account: { id: "account-a", email: null } }),
    });
    await expect(malformedClient.login()).rejects.toEqual(
      new MiniAuthError(200, "AUTH_RESPONSE_INVALID", false),
    );
  });

  it("normalizes the server's ISO expiry value for the local session store", async () => {
    const expiresAt = "2030-01-01T00:00:00.000Z";
    const client = createMiniAuthClient({
      baseUrl: "https://api.example.test",
      wxLogin: async () => ({ code: "wx-code" }),
      transport: async () => response({
        account: { id: "account-a", email: null },
        sessionToken,
        expiresAt,
      }),
    });

    await expect(client.login()).resolves.toMatchObject({
      sessionToken,
      expiresAt: Date.parse(expiresAt),
    });
  });

  it("surfaces wx.login failure without making an auth request", async () => {
    const transport = vi.fn(async () => response({}));
    const client = createMiniAuthClient({
      baseUrl: "https://api.example.test",
      wxLogin: async () => { throw new Error("cancelled"); },
      transport,
    });

    await expect(client.login()).rejects.toEqual(
      new MiniAuthError(0, "WX_LOGIN_FAILED", true),
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
