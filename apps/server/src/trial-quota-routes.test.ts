import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerTrialQuotaRoutes } from "./trial-quota-routes";

describe("trial quota routes", () => {
  it("gets and claims the account-owned quota through idempotent routes", async () => {
    const app = Fastify({ logger: false });
    const calls: Array<{ operation: string; accountId: string }> = [];
    const runtime = {
      getStatus: async (accountId: string) => {
        calls.push({ operation: "get", accountId });
        return { status: "unclaimed" as const };
      },
      claim: async (accountId: string) => {
        calls.push({ operation: "claim", accountId });
        return { status: "claimed" as const };
      },
    };

    registerTrialQuotaRoutes(app, runtime, (headers) => String(headers["x-selfalone-account"] ?? ""));
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/account/trial-quota",
      headers: { "x-selfalone-account": "account-a" },
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/account/trial-quota/claim",
      headers: { "x-selfalone-account": "account-a" },
      payload: {},
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/account/trial-quota/claim",
      headers: { "x-selfalone-account": "account-a" },
      payload: {},
    });

    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ status: "unclaimed" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: "claimed" });
    expect(second.json()).toEqual(first.json());
    expect(calls).toEqual([
      { operation: "get", accountId: "account-a" },
      { operation: "claim", accountId: "account-a" },
      { operation: "claim", accountId: "account-a" },
    ]);
    await app.close();
  });
});
