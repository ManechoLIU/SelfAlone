import { describe, expect, it, vi } from "vitest";
import {
  AnnotationsApiError,
  createAnnotationsApiClient,
  type AnnotationHttpRequest,
  type AnnotationHttpResponse,
  type TextAnnotationList,
} from "./annotations-api";

const token = "opaque-mini-session-token-1234567890";

function response(body: unknown, status = 200): AnnotationHttpResponse {
  return { status, body };
}

function authenticated(currentToken = token) {
  return {
    kind: "authenticated" as const,
    token: currentToken,
    expiresAt: 1_900_000_000_000,
  };
}

function annotationList(): TextAnnotationList {
  return { fileVersion: 2, highlights: [], notes: [] };
}

describe("miniapp text annotations API adapter", () => {
  it("uses the frozen annotations and notes routes with the current Bearer session", async () => {
    const requests: AnnotationHttpRequest[] = [];
    const note = {
      id: "note-1",
      bookId: "book-a",
      body: "保留这条笔记",
      source: null,
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
    const transport = vi.fn(async (request: AnnotationHttpRequest) => {
      requests.push(request);
      if (request.method === "GET") return response(annotationList());
      if (request.method === "POST") return response({ status: "saved", note }, 201);
      if (request.method === "PATCH") return response({ status: "saved", note: { ...note, body: "改过了", version: 2 } });
      return response({ status: "deleted", id: note.id });
    });
    const client = createAnnotationsApiClient({
      baseUrl: "https://api.example.test/",
      authProvider: () => authenticated(),
      transport,
    });

    await expect(client.getAnnotations("book-a")).resolves.toEqual(annotationList());
    await expect(client.createNote("book-a", { idempotencyKey: "note-create-1", body: note.body }))
      .resolves.toEqual({ status: "saved", note });
    await expect(client.updateNote("book-a", note.id, { expectedVersion: 1, body: "改过了" }))
      .resolves.toMatchObject({ status: "saved", note: { body: "改过了", version: 2 } });
    await expect(client.deleteNote("book-a", note.id, { expectedVersion: 2 }))
      .resolves.toEqual({ status: "deleted", id: note.id });

    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/books/book-a/annotations",
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      },
      {
        url: "https://api.example.test/api/v1/books/book-a/notes",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: { idempotencyKey: "note-create-1", body: note.body },
      },
      {
        url: "https://api.example.test/api/v1/books/book-a/notes/note-1",
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: { expectedVersion: 1, body: "改过了" },
      },
      {
        url: "https://api.example.test/api/v1/books/book-a/notes/note-1",
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: { expectedVersion: 2 },
      },
    ]);
  });

  it("reads a fresh session before each request instead of capturing a token", async () => {
    let current = authenticated("opaque-first-session-token-123456");
    const requests: AnnotationHttpRequest[] = [];
    const client = createAnnotationsApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => current,
      transport: async (request) => {
        requests.push(request);
        return response(annotationList());
      },
    });

    await client.getAnnotations("book-a");
    current = authenticated("opaque-second-session-token-123456");
    await client.getAnnotations("book-a");

    expect(requests.map((request) => request.headers.Authorization)).toEqual([
      "Bearer opaque-first-session-token-123456",
      "Bearer opaque-second-session-token-123456",
    ]);
  });

  it("fails closed without an API origin or authenticated session", async () => {
    const transport = vi.fn(async () => response(annotationList()));
    const noOrigin = createAnnotationsApiClient({ transport, authProvider: () => authenticated() });
    await expect(noOrigin.getAnnotations("book-a")).rejects.toEqual(
      new AnnotationsApiError(0, "ANNOTATIONS_API_UNAVAILABLE", false),
    );

    const noSession = createAnnotationsApiClient({
      baseUrl: "https://api.example.test",
      transport,
      authProvider: () => ({ kind: "signed-out" as const }),
    });
    await expect(noSession.getAnnotations("book-a")).rejects.toEqual(
      new AnnotationsApiError(0, "ANNOTATIONS_API_UNAVAILABLE", false),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("clears the session after a 401 and does not make a second protected request", async () => {
    let current: ReturnType<typeof authenticated> | { kind: "signed-out" } = authenticated();
    const clearOnUnauthorized = vi.fn(() => { current = { kind: "signed-out" }; });
    const transport = vi.fn(async () => response({ code: "AUTH_REQUIRED" }, 401));
    const client = createAnnotationsApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => current,
      onUnauthorized: clearOnUnauthorized,
      transport,
    });

    await expect(client.getAnnotations("book-a")).rejects.toEqual(
      new AnnotationsApiError(401, "AUTH_REQUIRED", false),
    );
    expect(clearOnUnauthorized).toHaveBeenCalledOnce();
    await expect(client.getAnnotations("book-a")).rejects.toEqual(
      new AnnotationsApiError(0, "ANNOTATIONS_API_UNAVAILABLE", false),
    );
    expect(transport).toHaveBeenCalledOnce();
  });

  it("returns server save failures so the reader can retain and retry the draft", async () => {
    const failed = {
      status: "failed" as const,
      errorCode: "NOTE_SAVE_FAILED",
      retainedDraft: { idempotencyKey: "note-retry-1", body: "不要丢失" },
    };
    const client = createAnnotationsApiClient({
      baseUrl: "https://api.example.test",
      authProvider: () => authenticated(),
      transport: async () => response(failed, 503),
    });

    await expect(client.createNote("book-a", failed.retainedDraft)).resolves.toEqual(failed);
  });
});
