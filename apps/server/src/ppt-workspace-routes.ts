import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAccountOwner } from "./account-owner";
import {
  PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX,
  PPT_WORKSPACE_INTEGER_MAX,
  PPT_WORKSPACE_PAGE_COUNT_MAX,
  PptWorkspaceStoreError,
  type PptWorkspaceStore,
} from "./ppt-workspace-store";

export type PptWorkspaceRouteRuntime = Pick<
  PptWorkspaceStore,
  "createFromSentIntent" | "getWorkspace" | "saveRequirements" | "replaceSource"
>;

export const pptWorkspaceIdentifier = z.string().trim().min(1).max(256);
const pageCount = z.number().int().positive().max(PPT_WORKSPACE_PAGE_COUNT_MAX);
const storedVersion = z.number().int().positive().max(PPT_WORKSPACE_INTEGER_MAX);
const incrementableVersion = z.number()
  .int()
  .positive()
  .max(PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX);
const createParameters = z.object({ conversationId: pptWorkspaceIdentifier }).strict();
const draftParameters = z.object({ draftId: pptWorkspaceIdentifier }).strict();
const createBody = z.object({
  requestId: pptWorkspaceIdentifier,
  bookId: pptWorkspaceIdentifier,
}).strict();
const pageRange = z.object({
  min: pageCount,
  max: pageCount,
}).strict().superRefine((value, context) => {
  if (value.min > value.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max"],
      message: "max must be greater than or equal to min",
    });
  }
});
export const pptWorkspaceRequirementsBody = z.object({
  expectedVersion: incrementableVersion,
  purpose: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(1).max(120),
  pageRange,
  additionalRequirements: z.string().trim().max(2_000),
}).strict();
const sourceBody = z.object({
  expectedVersion: storedVersion,
  bookId: pptWorkspaceIdentifier,
}).strict();

export const m0LegacyRequirementsBody = z.object({
  expectedVersion: incrementableVersion,
  requirements: z.string().trim().min(1).max(2_000),
}).strict();

type RegisterPptWorkspaceRouteOptions = {
  registerRequirements?: boolean;
};

export function registerPptWorkspaceRoutes(
  app: FastifyInstance,
  runtime: PptWorkspaceRouteRuntime,
  resolveAccountId = resolveAccountOwner,
  options: RegisterPptWorkspaceRouteOptions = {},
) {
  app.post("/api/v1/conversations/:conversationId/ppt-drafts", async (request, reply) => {
    try {
      const { conversationId } = createParameters.parse(request.params);
      const body = createBody.parse(request.body);
      const result = await runtime.createFromSentIntent({
        accountId: resolveAccountId(request.headers),
        conversationId,
        requestId: body.requestId,
        bookId: body.bookId,
      });
      return reply.code(result.status === "created" ? 201 : 200).send(result);
    } catch (error) {
      return sendPptWorkspaceError(error, reply);
    }
  });

  app.get("/api/v1/ppt-drafts/:draftId/workspace", async (request, reply) => {
    try {
      const { draftId } = draftParameters.parse(request.params);
      const workspace = await runtime.getWorkspace(resolveAccountId(request.headers), draftId);
      if (!workspace) return reply.code(404).send({ code: "PPT_WORKSPACE_NOT_FOUND" });
      return reply.send({ workspace });
    } catch (error) {
      return sendPptWorkspaceError(error, reply);
    }
  });

  if (options.registerRequirements !== false) {
    app.put("/api/v1/ppt-drafts/:draftId/requirements", async (request, reply) => {
      try {
        const { draftId } = draftParameters.parse(request.params);
        const body = pptWorkspaceRequirementsBody.parse(request.body);
        const workspace = await runtime.saveRequirements({
          accountId: resolveAccountId(request.headers),
          draftId,
          expectedVersion: body.expectedVersion,
          requirements: {
            purpose: body.purpose,
            audience: body.audience,
            pageRange: body.pageRange,
            additionalRequirements: body.additionalRequirements,
          },
        });
        return reply.send({ workspace });
      } catch (error) {
        return sendPptWorkspaceError(error, reply);
      }
    });
  }

  app.put("/api/v1/ppt-drafts/:draftId/source", async (request, reply) => {
    try {
      const { draftId } = draftParameters.parse(request.params);
      const body = sourceBody.parse(request.body);
      const workspace = await runtime.replaceSource({
        accountId: resolveAccountId(request.headers),
        draftId,
        expectedVersion: body.expectedVersion,
        bookId: body.bookId,
      });
      return reply.send({ workspace });
    } catch (error) {
      return sendPptWorkspaceError(error, reply);
    }
  });
}

export function sendPptWorkspaceError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "INVALID_REQUEST" });
  }
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "ACCOUNT_REQUIRED") {
    return reply.code(401).send({ code: message });
  }
  if (message === "ACCOUNT_FORBIDDEN") {
    return reply.code(403).send({ code: message });
  }
  if (!(error instanceof PptWorkspaceStoreError)) {
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  }
  if (error.code === "PPT_WORKSPACE_NOT_FOUND") {
    return reply.code(404).send({ code: error.code });
  }
  if (error.code === "PPT_INTENT_NOT_SENT") {
    return reply.code(422).send({ code: error.code });
  }
  if (error.code === "PPT_WORKSPACE_INVALID_REQUIREMENTS") {
    return reply.code(400).send({ code: error.code });
  }
  if (
    error.code === "PPT_WORKSPACE_STALE"
    || error.code === "PPT_INTENT_CONFLICT"
    || error.code === "PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION"
    || error.code === "PPT_WORKSPACE_STAGE_UNSUPPORTED"
  ) {
    return reply.code(409).send({ code: error.code });
  }
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}
