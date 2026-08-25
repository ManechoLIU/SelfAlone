import Fastify from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { resolveAccountOwner } from "./account-owner";
import type { AuthRuntime } from "./auth-runtime";
import type { LibraryRuntime } from "./library-runtime";
import type { M0Runtime } from "./m0-runtime";
import { registerTextReaderRoutes, type TextReaderRuntime } from "./text-reader";
import {
  registerTextAnnotationRoutes,
  type TextAnnotationService,
} from "./text-annotation-runtime";

type AppDependencies = {
  readiness: () => Promise<boolean>;
  auth?: AuthRuntime;
  library?: LibraryRuntime;
  m0?: M0Runtime;
  textReader?: TextReaderRuntime;
  textAnnotations?: Pick<
    TextAnnotationService,
    "list" | "createHighlight" | "updateHighlight" | "deleteHighlight" | "createNote" | "updateNote" | "deleteNote"
  >;
};

export const resolveAccountId = resolveAccountOwner;

const sessionCookieName = "selfalone_session";

function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== sessionCookieName) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sessionCookie(token: string, secure: boolean) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(secure: boolean) {
  return `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function isPublicPath(url: string) {
  const path = url.split("?", 1)[0];
  return path.startsWith("/api/v1/health/")
    || path.startsWith("/api/v1/auth/")
    || path === "/api/v1/account";
}

export function createApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: false });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  app.get("/api/v1/health/live", async () => ({ status: "live" }));

  app.get("/api/v1/health/ready", async (_request, reply) => {
    const ready = await dependencies.readiness();
    if (!ready) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  if (dependencies.auth) {
    const auth = dependencies.auth;
    const emailCredentials = z.object({
      email: z.string(),
      password: z.string(),
    });
    const secureCookie = auth.isProductionEnvironment();

    app.addHook("preHandler", async (request) => {
      if (isPublicPath(request.url)) return;
      const account = await auth.getAccount(readSessionCookie(request.headers.cookie));
      if (!account) throw new Error("AUTH_REQUIRED");
      // Existing resource runtimes accept a session-neutral owner resolver. The
      // value is injected only after a valid HttpOnly session is verified.
      (request.headers as Record<string, unknown>)["x-selfalone-account"] = account.id;
    });

    app.post("/api/v1/auth/email/register", async (request, reply) => {
      const body = emailCredentials.parse(request.body);
      const result = await auth.register(body.email, body.password);
      reply.header("set-cookie", sessionCookie(result.sessionToken, secureCookie));
      return reply.code(201).send({ account: result.account });
    });

    app.post("/api/v1/auth/email/login", async (request, reply) => {
      const body = emailCredentials.parse(request.body);
      const result = await auth.login(body.email, body.password);
      reply.header("set-cookie", sessionCookie(result.sessionToken, secureCookie));
      return reply.code(200).send({ account: result.account });
    });

    app.post("/api/v1/auth/refresh", async (request, reply) => {
      const result = await auth.refresh(readSessionCookie(request.headers.cookie));
      reply.header("set-cookie", sessionCookie(result.sessionToken, secureCookie));
      return reply.code(200).send({ account: result.account });
    });

    app.post("/api/v1/auth/logout", async (request, reply) => {
      await auth.logout(readSessionCookie(request.headers.cookie));
      reply.header("set-cookie", clearSessionCookie(secureCookie));
      return reply.code(204).send();
    });

    app.get("/api/v1/account", async (request, reply) => {
      const account = await auth.getAccount(readSessionCookie(request.headers.cookie));
      if (!account) throw new Error("AUTH_REQUIRED");
      return reply.send({ account });
    });
  }

  if (dependencies.library) {
    const library = dependencies.library;

    app.get("/api/v1/books", async (request) => {
      const query = z.object({ query: z.string().max(120).optional() }).parse(request.query);
      return { books: await library.listBooks(resolveAccountId(request.headers), query.query ?? "") };
    });

    app.get("/api/v1/books/:id", async (request) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      return library.getBook(resolveAccountId(request.headers), parameters.id);
    });

    app.post("/api/v1/books/import", async (request, reply) => {
      const encodedName = request.headers["x-file-name"];
      if (typeof encodedName !== "string" || !encodedName.trim()) {
        throw new Error("BOOK_FILENAME_REQUIRED");
      }
      let filename: string;
      try {
        filename = decodeURIComponent(encodedName);
      } catch {
        throw new Error("BOOK_FILENAME_INVALID");
      }
      if (!Buffer.isBuffer(request.body)) throw new Error("BOOK_FILE_REQUIRED");
      return reply.code(202).send(
        await library.importBook(resolveAccountId(request.headers), filename, request.body),
      );
    });
  }

  if (dependencies.textReader) {
    registerTextReaderRoutes(app, dependencies.textReader, resolveAccountId);
  }

  if (dependencies.textAnnotations) {
    registerTextAnnotationRoutes(app, dependencies.textAnnotations, resolveAccountId);
  }

  if (dependencies.m0) {
    const m0 = dependencies.m0;
    const requirementsBody = z.object({
      expectedVersion: z.number().int().positive(),
      requirements: z.string().trim().min(1).max(2_000),
    });
    const outlineBody = z.object({
      expectedVersion: z.number().int().positive(),
      outline: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(120),
            body: z.string().trim().min(1).max(500),
          }),
        )
        .min(1)
        .max(15),
    });
    const taskBody = z.object({
      draftId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().min(1).max(120),
      templateId: z.enum(["qingci-study", "paper-notes", "ink-minimal"]),
    });

    app.get("/api/v1/workspace", async () => m0.getWorkspace());

    app.put("/api/v1/ppt-drafts/:id/requirements", async (request, reply) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = requirementsBody.parse(request.body);
      return reply.send(
        await m0.saveRequirements(parameters.id, body.expectedVersion, body.requirements),
      );
    });

    app.put("/api/v1/ppt-drafts/:id/outline", async (request, reply) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = outlineBody.parse(request.body);
      return reply.send(await m0.saveOutline(parameters.id, body.expectedVersion, body.outline));
    });

    app.post("/api/v1/ppt-tasks", async (request, reply) => {
      const body = taskBody.parse(request.body);
      const task = await m0.createTask(body);
      return reply.code(202).send(task);
    });

    app.get("/api/v1/ppt-tasks/:id", async (request) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      return m0.getTask(parameters.id);
    });

    app.post("/api/v1/ppt-tasks/:id/stop", async (request) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z.object({ expectedVersion: z.number().int().positive() }).parse(request.body);
      return m0.stopTask(parameters.id, body.expectedVersion);
    });

    app.get("/api/v1/ppt-artifacts/:id/download", async (request, reply) => {
      const parameters = z.object({ id: z.string().min(1) }).parse(request.params);
      const artifact = await m0.getArtifact(parameters.id);
      reply.header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      reply.header("content-disposition", `attachment; filename="${artifact.filename}"`);
      return reply.send(createReadStream(artifact.filePath));
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ code: "INVALID_REQUEST" });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "STALE_VERSION") {
      return reply.code(409).send({ code: "STALE_VERSION" });
    }
    if (message.endsWith("_NOT_FOUND")) {
      return reply.code(404).send({ code: message });
    }
    if (message === "INVALID_STAGE_TRANSITION") {
      return reply.code(409).send({ code: message });
    }
    if (message === "ACCOUNT_FORBIDDEN") {
      return reply.code(403).send({ code: message });
    }
    if (message === "ACCOUNT_REQUIRED") {
      return reply.code(401).send({ code: message });
    }
    if (message === "AUTH_REQUIRED" || message === "INVALID_CREDENTIALS") {
      return reply.code(401).send({ code: message });
    }
    if (message === "EMAIL_ALREADY_REGISTERED") {
      return reply.code(409).send({ code: message });
    }
    if (message === "INVALID_EMAIL" || message === "INVALID_PASSWORD") {
      return reply.code(400).send({ code: message });
    }
    if (
      [
        "UNSUPPORTED_BOOK_FORMAT",
        "EMPTY_BOOK_FILE",
        "BOOK_FILE_TOO_LARGE",
        "BOOK_FILENAME_REQUIRED",
        "BOOK_FILENAME_INVALID",
        "BOOK_FILE_REQUIRED",
      ].includes(message)
    ) {
      return reply.code(400).send({ code: message });
    }
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });

  return app;
}
