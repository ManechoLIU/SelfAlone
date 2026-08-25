import { describe, expect, it, vi } from "vitest";
import { requestJson, requestNoContent } from "./api";

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
});
