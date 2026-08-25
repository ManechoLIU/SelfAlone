import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountSettingsRuntime } from "./account-settings";

export type AccountSettingsService = Pick<
  AccountSettingsRuntime,
  | "getOverview"
  | "requestEmailChange"
  | "confirmEmailChange"
  | "changePassword"
  | "requestPasswordReset"
  | "confirmPasswordReset"
>;

export type AccountOwnerResolver = (headers: Record<string, unknown>) => string;

export function registerAccountSettingsRoutes(
  app: FastifyInstance,
  service: AccountSettingsService,
  resolveOwner: AccountOwnerResolver,
) {
  const emailChangeBody = z.object({
    currentPassword: z.string().min(1).max(256),
    newEmail: z.string().min(1).max(254),
  });
  const passwordBody = z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  });
  const tokenBody = z.object({
    token: z.string().min(1).max(512),
    password: z.string().min(1).max(256),
  });

  app.get("/api/v1/settings", async (request) => {
    const accountId = resolveOwner(request.headers as Record<string, unknown>);
    return service.getOverview(accountId);
  });

  app.post("/api/v1/settings/email", async (request, reply) => {
    const accountId = resolveOwner(request.headers as Record<string, unknown>);
    const body = emailChangeBody.parse(request.body);
    await service.requestEmailChange(accountId, body.currentPassword, body.newEmail);
    return reply.code(202).send({ status: "verification_required" });
  });

  app.post("/api/v1/settings/email/confirm", async (request, reply) => {
    const body = z.object({ token: z.string().min(1).max(512) }).parse(request.body);
    await service.confirmEmailChange(body.token);
    return reply.code(204).send();
  });

  app.post("/api/v1/settings/password", async (request, reply) => {
    const accountId = resolveOwner(request.headers as Record<string, unknown>);
    const body = passwordBody.parse(request.body);
    await service.changePassword(accountId, body.currentPassword, body.newPassword);
    return reply.code(204).send();
  });

  // Password reset is intentionally public; the runtime does not disclose
  // whether an address exists and only sends through an authorized provider.
  app.post("/api/v1/settings/password-reset", async (request, reply) => {
    const body = z.object({ email: z.string().min(1).max(254) }).parse(request.body);
    await service.requestPasswordReset(body.email);
    return reply.code(202).send({ status: "accepted" });
  });

  app.post("/api/v1/settings/password-reset/confirm", async (request, reply) => {
    const body = tokenBody.parse(request.body);
    await service.confirmPasswordReset(body.token, body.password);
    return reply.code(204).send();
  });
}
