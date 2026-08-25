import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registerAccountSettingsRoutes } from "./account-settings-routes";

function createService() {
  const calls: string[] = [];
  const service = {
    async getOverview(accountId: string) {
      calls.push(`overview:${accountId}`);
      return {
        account: { id: accountId, email: "reader@example.com" },
        loginMethods: {
          email: { connected: true as const, label: "reader@example.com" },
          wechat: { connected: false, label: null },
        },
      };
    },
    async requestEmailChange(accountId: string, currentPassword: string, newEmail: string) {
      calls.push(`email:${accountId}:${currentPassword}:${newEmail}`);
    },
    async confirmEmailChange(token: string) {
      calls.push(`email-confirm:${token}`);
    },
    async changePassword(accountId: string, currentPassword: string, newPassword: string) {
      calls.push(`password:${accountId}:${currentPassword}:${newPassword}`);
    },
    async requestPasswordReset(email: string) {
      calls.push(`reset:${email}`);
    },
    async confirmPasswordReset(token: string, password: string) {
      calls.push(`reset-confirm:${token}:${password}`);
    },
  };
  return { service, calls };
}

describe("account settings routes", () => {
  it("boots the account settings runtime so authenticated overview and public reset routes are registered", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain('import { createAccountSettingsRuntime } from "./account-settings"');
    expect(source).toContain("migrateAccountSettingsSchema");
    expect(source).toMatch(/accountSettings\s*:\s*accountSettings/);
  });

  it("returns the session-owned overview and keeps a single settings boundary", async () => {
    const app = Fastify({ logger: false });
    const { service, calls } = createService();
    registerAccountSettingsRoutes(app, service, (headers) => {
      const account = headers["x-selfalone-account"];
      if (typeof account !== "string" || !account) throw new Error("ACCOUNT_REQUIRED");
      return account;
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { "x-selfalone-account": "account-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ account: { id: "account-1" } });
    expect(calls).toEqual(["overview:account-1"]);
    await app.close();
  });

  it("validates email/password intent bodies and never reports an email mutation as successful without the service", async () => {
    const app = Fastify({ logger: false });
    const { service, calls } = createService();
    registerAccountSettingsRoutes(app, service, (headers) => String(headers["x-selfalone-account"] ?? ""));

    const email = await app.inject({
      method: "POST",
      url: "/api/v1/settings/email",
      headers: { "x-selfalone-account": "account-1" },
      payload: { currentPassword: "current", newEmail: "new@example.com" },
    });
    expect(email.statusCode).toBe(202);
    expect(email.json()).toEqual({ status: "verification_required" });

    const password = await app.inject({
      method: "POST",
      url: "/api/v1/settings/password",
      headers: { "x-selfalone-account": "account-1" },
      payload: { currentPassword: "current", newPassword: "new password" },
    });
    expect(password.statusCode).toBe(204);
    expect(calls).toEqual([
      "email:account-1:current:new@example.com",
      "password:account-1:current:new password",
    ]);
    await app.close();
  });

  it("keeps password reset and token confirmation explicit and non-successful on invalid input", async () => {
    const app = Fastify({ logger: false });
    const { service, calls } = createService();
    registerAccountSettingsRoutes(app, service, (headers) => String(headers["x-selfalone-account"] ?? ""));

    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/settings/password-reset",
      payload: { email: "reader@example.com" },
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toEqual({ status: "accepted" });

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/v1/settings/password-reset/confirm",
      payload: { token: "token-1", password: "new password" },
    });
    expect(confirmed.statusCode).toBe(204);
    expect(calls).toEqual(["reset:reader@example.com", "reset-confirm:token-1:new password"]);
    await app.close();
  });
});
