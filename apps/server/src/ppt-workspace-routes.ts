import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAccountOwner } from "./account-owner";
import {
  PPT_WORKSPACE_INTEGER_MAX,
  PptWorkspaceStoreError,
  type PptWorkspaceStore,
} from "./ppt-workspace-store";

export type PptWorkspaceRouteRuntime = Pick<
  PptWorkspaceStore,
  "createFromSentIntent" | "getWorkspace" | "saveRequirements" | "replaceSource"
>;

const identifier = z.string().trim().min(1).max(256);
const safePositiveInteger = z.number().int().positive().max(PPT_WORKSPACE_INTEGER_MAX);
const createParameters = z.object({ conversationId: identifier }).strict();
const draftParameters = z.object({ draftId: identifier }).strict();
const createBody = z.object({
  requestId: identifier,
  bookId: identifier,
}).strict();
const pageRange = z.object({
  min: safePositiveInteger,
  max: safePositiveInteger,
}).strict().superRefine((value, context) => {
  if (value.min > value.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max"],
      message: "max must be greater than or equal to min",
    });
  }
});
const requirementsBody = z.object({
  expectedVersion: safePositiveInteger,
  purpose: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(1).max(120),
  pageRange,
  additionalRequirements: z.string().trim().max(2_000),
}).strict();
const sourceBody = z.object({
  expectedVersion: safePositiveInteger,
  bookId: identifier,
}).strict();

export function registerPptWorkspaceRoutes(
  app: FastifyInstance,
  runtime: PptWorkspaceRouteRuntime,
  resolveAccountId = resolveAccountOwner,
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

  app.put("/api/v1/ppt-drafts/:draftId/requirements", async (request, reply) => {
    try {
      const { draftId } = draftParameters.parse(request.params);
      const body = requirementsBody.parse(request.body);
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

function sendPptWorkspaceError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "INVALID_REQUEST" });
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
