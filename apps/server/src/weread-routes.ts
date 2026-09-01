import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  WeReadAnnotationsSnapshotRequest,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncRequest,
  WeReadAnnotationsSyncResponse,
  WeReadApiError,
  WeReadBooksSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadBooksSyncRequest,
  WeReadBooksSyncResponse,
  WeReadConnectionDeleteRequest,
  WeReadConnectionDeleteResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionPutRequest,
  WeReadConnectionPutResponse,
  WeReadSyncStatusResponse,
} from "@selfalone/contracts";

export type WeReadRouteRuntime = {
  getConnection(accountId: string): Promise<WeReadConnectionGetResponse>;
  putConnection(
    accountId: string,
    input: WeReadConnectionPutRequest,
  ): Promise<WeReadConnectionPutResponse>;
  deleteConnection(
    accountId: string,
    input: WeReadConnectionDeleteRequest,
  ): Promise<WeReadConnectionDeleteResponse>;
  syncBooks(accountId: string, input: WeReadBooksSyncRequest): Promise<WeReadBooksSyncResponse>;
  getBooksSnapshot(
    accountId: string,
    input: WeReadBooksSnapshotRequest,
  ): Promise<WeReadBooksSnapshotResponse>;
  getSyncStatus(accountId: string, runId: string): Promise<WeReadSyncStatusResponse>;
  syncAnnotations(
    accountId: string,
    input: WeReadAnnotationsSyncRequest,
  ): Promise<WeReadAnnotationsSyncResponse>;
  getAnnotationsSnapshot(
    accountId: string,
    input: WeReadAnnotationsSnapshotRequest,
  ): Promise<WeReadAnnotationsSnapshotResponse>;
};

export type WeReadOwnerResolver = (headers: Record<string, unknown>) => string;

export class WeReadRouteError extends Error {
  constructor(readonly payload: WeReadApiError) {
    super(payload.code);
    this.name = "WeReadRouteError";
  }
}

const requestId = z.string().trim().min(1).max(160);
const revision = z.string().trim().min(1).max(160);
const opaqueCursor = z.string().min(1).max(4_096);
const localBookId = z.string().trim().min(1).max(160);

const connectionPutBody = z.object({
  apiKey: z.string().min(1).max(4_096),
  requestId,
  expectedRevision: revision.nullable(),
}).strict();
const connectionDeleteBody = z.object({ expectedRevision: revision }).strict();
const booksSyncBody = z.object({
  requestId,
  cursor: opaqueCursor.nullable().optional(),
}).strict();
const booksSnapshotQuery = z.object({ cursor: opaqueCursor.nullable().optional() }).strict();
const syncStatusParameters = z.object({ runId: z.string().trim().min(1).max(160) }).strict();
const annotationsSyncBody = z.object({ requestId, bookId: localBookId }).strict();
const annotationsSnapshotQuery = z.object({ bookId: localBookId }).strict();

export function registerWeReadRoutes(
  app: FastifyInstance,
  runtime: WeReadRouteRuntime,
  resolveOwner: WeReadOwnerResolver,
) {
  app.get("/api/v1/weread/connection", async (request, reply) =>
    send(reply, () => runtime.getConnection(resolveOwner(request.headers as Record<string, unknown>))));

  app.put("/api/v1/weread/connection", async (request, reply) =>
    send(reply, () => runtime.putConnection(
      resolveOwner(request.headers as Record<string, unknown>),
      connectionPutBody.parse(request.body),
    )));

  app.delete("/api/v1/weread/connection", async (request, reply) =>
    send(reply, () => runtime.deleteConnection(
      resolveOwner(request.headers as Record<string, unknown>),
      connectionDeleteBody.parse(request.body),
    )));

  app.post("/api/v1/weread/sync/books", async (request, reply) =>
    send(reply, () => runtime.syncBooks(
      resolveOwner(request.headers as Record<string, unknown>),
      booksSyncBody.parse(request.body),
    ), 202));

  app.get("/api/v1/weread/books", async (request, reply) =>
    send(reply, () => runtime.getBooksSnapshot(
      resolveOwner(request.headers as Record<string, unknown>),
      booksSnapshotQuery.parse(request.query),
    )));

  app.get("/api/v1/weread/sync/:runId", async (request, reply) =>
    send(reply, () => runtime.getSyncStatus(
      resolveOwner(request.headers as Record<string, unknown>),
      syncStatusParameters.parse(request.params).runId,
    )));

  app.post("/api/v1/weread/sync/annotations", async (request, reply) =>
    send(reply, () => runtime.syncAnnotations(
      resolveOwner(request.headers as Record<string, unknown>),
      annotationsSyncBody.parse(request.body),
    ), 202));

  app.get("/api/v1/weread/annotations", async (request, reply) =>
    send(reply, () => runtime.getAnnotationsSnapshot(
      resolveOwner(request.headers as Record<string, unknown>),
      annotationsSnapshotQuery.parse(request.query),
    )));
}

async function send(reply: FastifyReply, task: () => Promise<unknown>, statusCode = 200) {
  try {
    return reply.code(statusCode).send(await task());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "请求格式无效",
        retryable: false,
      } satisfies WeReadApiError);
    }
    if (error instanceof WeReadRouteError) {
      return reply.code(statusFor(error.payload.code)).send(error.payload);
    }
    throw error;
  }
}

function statusFor(code: WeReadApiError["code"]) {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "VALIDATION_FAILED") return 422;
  if (code === "CONFLICT" || code === "EXTERNAL_AUTH_REQUIRED" || code === "STALE_VERSION") {
    return 409;
  }
  if (code === "EXTERNAL_SERVICE_FAILED") return 503;
  return 500;
}
