import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAccountOwner } from "./account-owner";
import type { ConversationStore } from "./conversation-store";

export type ConversationRouteRuntime = Pick<
  ConversationStore,
  "createSession" | "getSession" | "listSessions" | "sendText"
>;

const conversationParameters = z.object({ id: z.string().trim().min(1).max(160) });
const createConversationBody = z.object({ id: z.string().trim().min(1).max(160).optional() });
const noteSourceBody = z.object({
  locator: z.object({
    kind: z.literal("text"),
    fileVersion: z.number().int().positive(),
    sectionId: z.string().trim().min(1).max(512),
    offset: z.number().int().nonnegative(),
  }),
  endOffset: z.number().int().positive(),
  quote: z.string().min(1).max(20_000),
}).superRefine((source, context) => {
  if (source.endOffset <= source.locator.offset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endOffset"],
      message: "endOffset must be greater than offset",
    });
  }
});
const noteIntentBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    bookId: z.string().trim().min(1).max(256),
    source: noteSourceBody.nullable().optional(),
  }),
  z.object({
    kind: z.literal("update"),
    bookId: z.string().trim().min(1).max(256),
    noteId: z.string().trim().min(1).max(256),
    expectedVersion: z.number().int().positive(),
  }),
]);
const sendMessageBody = z.object({
  requestId: z.string().trim().min(1).max(160).optional(),
  text: z.string().min(1).max(20_000),
  noteIntent: noteIntentBody.optional(),
});

/** Register the private conversation plugin at the optional app composition seam. */
export async function registerConversationRoutes(
  app: FastifyInstance,
  runtime: ConversationRouteRuntime,
  resolveAccountId = resolveAccountOwner,
) {
  app.get("/api/v1/conversations", async (request, reply) => {
    try {
      const query = z.object({ query: z.string().trim().max(120).optional() }).parse(request.query);
      return {
        conversations: await runtime.listSessions(resolveAccountId(request.headers), query.query ?? ""),
      };
    } catch (error) {
      return sendConversationError(error, reply);
    }
  });

  app.post("/api/v1/conversations", async (request, reply) => {
    try {
      const body = createConversationBody.parse(request.body ?? {});
      const conversationId = body.id ?? randomUUID();
      const session = await runtime.createSession(
        resolveAccountId(request.headers),
        conversationId,
      );
      return reply.code(201).send({ session });
    } catch (error) {
      return sendConversationError(error, reply);
    }
  });

  app.get("/api/v1/conversations/:id", async (request, reply) => {
    try {
      const { id } = conversationParameters.parse(request.params);
      const session = await runtime.getSession(resolveAccountId(request.headers), id);
      if (!session) return reply.code(404).send({ code: "CONVERSATION_NOT_FOUND" });
      return { session };
    } catch (error) {
      return sendConversationError(error, reply);
    }
  });

  app.post("/api/v1/conversations/:id/messages", async (request, reply) => {
    try {
      const { id } = conversationParameters.parse(request.params);
      const body = sendMessageBody.parse(request.body);
      const result = await runtime.sendText({
        accountId: resolveAccountId(request.headers),
        conversationId: id,
        requestId: body.requestId ?? randomUUID(),
        text: body.text,
        ...(body.noteIntent ? { noteIntent: body.noteIntent } : {}),
      });
      return reply.code(result.status === "completed" ? 200 : 503).send(result);
    } catch (error) {
      return sendConversationError(error, reply);
    }
  });
}

function sendConversationError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED" });
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "ACCOUNT_REQUIRED") return reply.code(401).send({ code });
  if (code === "ACCOUNT_FORBIDDEN") return reply.code(403).send({ code });
  if (code === "SESSION_NOT_FOUND") return reply.code(404).send({ code: "CONVERSATION_NOT_FOUND" });
  if (code === "CONVERSATION_BUSY" || code === "STALE_REVISION" || code === "REQUEST_ID_CONFLICT") {
    return reply.code(409).send({ code });
  }
  if (code === "INVALID_MESSAGE" || code.endsWith("_REQUIRED")) {
    return reply.code(400).send({ code: "VALIDATION_FAILED" });
  }
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}
