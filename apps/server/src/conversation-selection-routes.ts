import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAccountOwner } from "./account-owner";
import type {
  ConversationSelectionStore,
  CreateSelectionQuestionInput,
} from "./conversation-selection-store";

export type ConversationSelectionRouteRuntime = Pick<
  ConversationSelectionStore,
  "createQuestion" | "listQuestions" | "getQuestion" | "answerQuestion"
>;

const conversationParameters = z.object({ id: z.string().trim().min(1).max(160) });
const questionParameters = z.object({
  id: z.string().trim().min(1).max(160),
  questionId: z.string().trim().min(1).max(160),
});
const createQuestionBody = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(1).max(2_000),
  mode: z.enum(["single", "multi", "free"]),
  requiresConfirmation: z.boolean().optional().default(false),
  options: z.array(
    z.object({
      value: z.string().trim().min(1).max(160),
      label: z.string().trim().min(1).max(240),
    }),
  ).max(32).default([]),
});
const answerQuestionBody = z.object({
  requestId: z.string().trim().min(1).max(160),
  expectedVersion: z.number().int().positive(),
  values: z.array(z.string().trim().min(1).max(160)).max(32).optional(),
  freeText: z.string().max(2_000).optional(),
  confirm: z.boolean().optional().default(false),
});

export async function registerConversationSelectionRoutes(
  app: FastifyInstance,
  runtime: ConversationSelectionRouteRuntime,
  resolveAccountId = resolveAccountOwner,
) {
  app.get("/api/v1/conversations/:id/selection-questions", async (request, reply) => {
    try {
      const { id } = conversationParameters.parse(request.params);
      return { questions: await runtime.listQuestions(resolveAccountId(request.headers), id) };
    } catch (error) {
      return sendSelectionError(error, reply);
    }
  });

  app.post("/api/v1/conversations/:id/selection-questions", async (request, reply) => {
    try {
      const { id } = conversationParameters.parse(request.params);
      const body = createQuestionBody.parse(request.body);
      const input: CreateSelectionQuestionInput = {
        id: body.id,
        prompt: body.prompt,
        mode: body.mode,
        requiresConfirmation: body.requiresConfirmation,
        options: body.options,
      };
      const question = await runtime.createQuestion(
        resolveAccountId(request.headers),
        id,
        input,
      );
      return reply.code(201).send({ question });
    } catch (error) {
      return sendSelectionError(error, reply);
    }
  });

  app.get("/api/v1/conversations/:id/selection-questions/:questionId", async (request, reply) => {
    try {
      const { id, questionId } = questionParameters.parse(request.params);
      const question = await runtime.getQuestion(resolveAccountId(request.headers), id, questionId);
      if (!question) return reply.code(404).send({ code: "SELECTION_NOT_FOUND" });
      return { question };
    } catch (error) {
      return sendSelectionError(error, reply);
    }
  });

  app.post("/api/v1/conversations/:id/selection-questions/:questionId/answer", async (request, reply) => {
    try {
      const { id, questionId } = questionParameters.parse(request.params);
      const body = answerQuestionBody.parse(request.body);
      const result = await runtime.answerQuestion({
        accountId: resolveAccountId(request.headers),
        conversationId: id,
        questionId,
        requestId: body.requestId,
        expectedVersion: body.expectedVersion,
        values: body.values,
        freeText: body.freeText,
        confirm: body.confirm,
      });
      return reply.send(result);
    } catch (error) {
      return sendSelectionError(error, reply);
    }
  });
}

function sendSelectionError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED" });
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "ACCOUNT_REQUIRED") return reply.code(401).send({ code });
  if (code === "ACCOUNT_FORBIDDEN") return reply.code(403).send({ code });
  if (code === "SELECTION_NOT_FOUND" || code === "SELECTION_CONVERSATION_NOT_FOUND") {
    return reply.code(404).send({ code: "SELECTION_NOT_FOUND" });
  }
  if (code === "SELECTION_STALE" || code === "SELECTION_REQUEST_ID_CONFLICT" || code === "SELECTION_ID_CONFLICT") {
    return reply.code(409).send({ code });
  }
  if (code.startsWith("SELECTION_") || code.endsWith("_REQUIRED")) {
    return reply.code(400).send({ code });
  }
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}
