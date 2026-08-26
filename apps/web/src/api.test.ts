import { describe, expect, it, vi } from "vitest";
import {
  deleteTextModelCredential,
  getTextModelCredential,
  requestJson,
  requestNoContent,
  saveTextModelCredential,
} from "./api";

describe("same-origin API client", () => {
  it("sends cookies for auth and parses structured errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ account: { id: "account-1", email: "reader@example.com" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(requestJson("/api/v1/account")).resolves.toEqual({
      account: { id: "account-1", email: "reader@example.com" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/account",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    fetchMock.mockRestore();
  });

  it("exposes the server error code while keeping the response body out of UI state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_CREDENTIALS", detail: "secret" }), {
        status: 401,
      }),
    );
    await expect(requestJson("/api/v1/auth/email/login", { method: "POST" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
    fetchMock.mockRestore();
  });

  it("supports a 204 logout response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(requestNoContent("/api/v1/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    fetchMock.mockRestore();
  });

  it("keeps model credential transport closed to endpoint and model overrides", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "verified",
        provider: "deepseek",
        maskedApiKey: "••••••••9876",
        verifiedAt: "2026-08-26T00:00:00.000Z",
        catalogVersion: "text-models-v1",
      }), { status: 200 }),
    );
    await expect(saveTextModelCredential({
      provider: "deepseek",
      apiKey: "fake-browser-key",
      workspaceId: "ignored",
    })).resolves.toMatchObject({ maskedApiKey: "••••••••9876" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(JSON.stringify({ provider: "deepseek", apiKey: "fake-browser-key" }));
    expect(String(request.body)).not.toContain("endpoint");
    expect(String(request.body)).not.toContain("model");
    fetchMock.mockRestore();
  });

  it("maps an unconfigured response and uses DELETE for revoke", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(null), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(getTextModelCredential()).resolves.toBeNull();
    await expect(deleteTextModelCredential()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
    fetchMock.mockRestore();
  });
});
