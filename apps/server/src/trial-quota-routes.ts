import type { FastifyInstance } from "fastify";
import { resolveAccountOwner } from "./account-owner";
import type { TrialQuotaStore } from "./trial-quota-store";

export type TrialQuotaRouteRuntime = Pick<TrialQuotaStore, "getStatus" | "claim">;
export type TrialQuotaAccountResolver = (headers: Record<string, unknown>) => string;

export function registerTrialQuotaRoutes(
  app: FastifyInstance,
  runtime: TrialQuotaRouteRuntime,
  resolveAccountId: TrialQuotaAccountResolver = resolveAccountOwner,
) {
  app.get("/api/v1/account/trial-quota", async (request) => {
    return runtime.getStatus(resolveAccountId(request.headers as Record<string, unknown>));
  });

  app.post("/api/v1/account/trial-quota/claim", async (request) => {
    return runtime.claim(resolveAccountId(request.headers as Record<string, unknown>));
  });
}
