import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateConversationSchema } from "./conversation-migration";
import {
  createConversationResponder,
  createDevelopmentConversationResponder,
} from "./conversation-responder";
import { ConversationStore } from "./conversation-store";

const domainModulePath = "../../../packages/domain/src/" + "conversation-session";
const domain = await import(domainModulePath);

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

const domainStateMachine = {
  createSession: domain.createConversationSession,
  updateDraft: domain.updateConversationDraft,
  appendContext: domain.appendConversationContext,
  startRun: domain.startConversationRun,
  recordWork: domain.recordConversationWork,
  settleRun: domain.settleConversationRun,
  deleteSession: domain.deleteConversationSession,
  isSendLocked: domain.isConversationSendLocked,
  createNoteOperation: domain.createConversationNoteOperation,
  bindNoteIntent: domain.bindConversationNoteIntent,
  appendNoteBody: domain.appendConversationNoteBody,
  startNoteOperation: domain.startConversationNoteOperation,
  failNoteOperation: domain.failConversationNoteOperation,
  completeNoteOperation: domain.completeConversationNoteOperation,
};

const noteSource = {
  locator: { kind: "text" as const, fileVersion: 2, sectionId: "txt:00000000", offset: 3 },
  endOffset: 7,
  quote: "灯塔亮了",
};

describe("conversation store", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema, sql }) => {
        await sql.end();
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
  });

  it("persists a deterministic local reply that a fresh store can recover", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_reply");
    const firstStore = new ConversationStore(setup.sql, domainStateMachine, {
      responder: createDevelopmentConversationResponder(),
    });
    await firstStore.createSession("account-a", "conversation-a");

    const sent = await firstStore.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-a-1",
      text: "请记住这一段",
    });

    expect(sent.status).toBe("completed");
    if (sent.status !== "completed") throw new Error("expected completed send");
    expect(sent.reply).toMatch(
      /^基于 1 条对话上下文摘要（用户 1、老己 0、系统 0、指纹 [0-9a-f]{10}）回应当前问题。$/,
    );
    expect(sent.session.draft).toBeNull();
    const [stored] = await setup.sql<{ stateType: string }[]>`
      SELECT jsonb_typeof(state) AS "stateType"
      FROM conversations
      WHERE id = 'conversation-a'
    `;
    expect(stored?.stateType).toBe("object");

    const refreshedStore = new ConversationStore(setup.sql, domainStateMachine);
    const refreshed = await refreshedStore.getSession("account-a", "conversation-a");
    expect(refreshed?.context).toEqual([
      { id: "request-a-1:user", role: "user", text: "请记住这一段", requestId: "request-a-1" },
      {
        id: "request-a-1:assistant",
        role: "assistant",
        text: sent.reply,
        requestId: "request-a-1",
      },
    ]);
  });

  it("rejects adding a create note intent to an already completed ordinary request", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_replay_create_conflict");
    let responderCalls = 0;
    let noteCalls = 0;
    const noteService = {
      createNote: async () => {
        noteCalls += 1;
        throw new Error("NOTE_SERVICE_MUST_NOT_RUN");
      },
      updateNote: async () => {
        noteCalls += 1;
        throw new Error("NOTE_SERVICE_MUST_NOT_RUN");
      },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "普通消息回答";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "ordinary-create-replay",
      text: "普通消息",
    })).resolves.toMatchObject({ status: "completed" });
    const before = await store.getSession("account-a", "conversation-a");
    const [beforeMessages] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "ordinary-create-replay",
      text: "普通消息",
      noteIntent: { kind: "create", bookId: "book-create" },
    } as never)).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });

    expect(responderCalls).toBe(1);
    expect(noteCalls).toBe(0);
    expect(await store.getSession("account-a", "conversation-a")).toEqual(before);
    const [afterMessages] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(afterMessages?.count).toBe(beforeMessages?.count);
  });

  it("rejects adding an update note intent to an already completed ordinary request", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_replay_update_conflict");
    let responderCalls = 0;
    let noteCalls = 0;
    const noteService = {
      createNote: async () => {
        noteCalls += 1;
        throw new Error("NOTE_SERVICE_MUST_NOT_RUN");
      },
      updateNote: async () => {
        noteCalls += 1;
        throw new Error("NOTE_SERVICE_MUST_NOT_RUN");
      },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "普通消息回答";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "ordinary-update-replay",
      text: "普通消息",
    })).resolves.toMatchObject({ status: "completed" });
    const before = await store.getSession("account-a", "conversation-a");
    const [beforeMessages] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "ordinary-update-replay",
      text: "普通消息",
      noteIntent: {
        kind: "update",
        bookId: "book-update",
        noteId: "note-update",
        expectedVersion: 2,
      },
    } as never)).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });

    expect(responderCalls).toBe(1);
    expect(noteCalls).toBe(0);
    expect(await store.getSession("account-a", "conversation-a")).toEqual(before);
    const [afterMessages] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(afterMessages?.count).toBe(beforeMessages?.count);
  });

  it("uses an explicit note intent to save the responder body with its book source", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_create");
    let responderCalls = 0;
    const createCalls: Array<{ accountId: string; bookId: string; input: any }> = [];
    const noteService = {
      createNote: async (accountId: string, bookId: string, input: any) => {
        createCalls.push({ accountId, bookId, input });
        return {
          status: "saved" as const,
          note: {
            id: "note-created",
            bookId,
            body: input.body,
            source: input.source ?? null,
            version: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        };
      },
      updateNote: async () => { throw new Error("not used"); },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "AI 生成的笔记正文";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");

    const result = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-create-request",
      text: "请整理这段内容",
      noteIntent: { kind: "create", bookId: "book-1", source: noteSource },
    } as never);

    expect(result.status).toBe("completed");
    expect(responderCalls).toBe(1);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      accountId: "account-a",
      bookId: "book-1",
      input: {
        body: "AI 生成的笔记正文",
        source: noteSource,
      },
    });
    expect(createCalls[0]?.input.idempotencyKey).toMatch(/^conversation-note:[0-9a-f]{64}$/);
    expect(createCalls[0]?.input.idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(result).toMatchObject({
      session: {
        draft: null,
        context: [
          { id: "note-create-request:user", role: "user", text: "请整理这段内容" },
          { id: "note-create-request:assistant", role: "assistant", text: "AI 生成的笔记正文" },
        ],
        noteOperations: [{
          requestId: "note-create-request",
          body: "AI 生成的笔记正文",
          intent: { kind: "create", bookId: "book-1", source: noteSource },
          status: "completed",
          errorCode: null,
        }],
      },
    });
  });

  it("persists a failed note save and retries it from a fresh store without another model call", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_retry");
    let responderCalls = 0;
    let createCalls = 0;
    const noteService = {
      createNote: async (_accountId: string, bookId: string, input: any) => {
        createCalls += 1;
        if (createCalls === 1) {
          return {
            status: "failed" as const,
            errorCode: "NOTE_SAVE_FAILED" as const,
            retainedDraft: { idempotencyKey: input.idempotencyKey, body: input.body, source: input.source ?? null },
          };
        }
        return {
          status: "saved" as const,
          note: {
            id: "note-retried",
            bookId,
            body: input.body,
            source: input.source ?? null,
            version: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        };
      },
      updateNote: async () => { throw new Error("not used"); },
    };
    const options = {
      responder: async () => {
        responderCalls += 1;
        return "失败后仍保留的 AI 笔记";
      },
      textAnnotations: noteService,
    } as never;
    const firstStore = new ConversationStore(setup.sql, domainStateMachine, options);
    await firstStore.createSession("account-a", "conversation-a");
    const intent = { kind: "create" as const, bookId: "book-1", source: noteSource };

    const first = await firstStore.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-retry-request",
      text: "请保存这段",
      noteIntent: intent,
    } as never);
    expect(first).toMatchObject({
      status: "failed",
      errorCode: "NOTE_SAVE_FAILED",
      retainedDraft: { text: "请保存这段", attachments: [] },
      session: {
        draft: { text: "请保存这段", attachments: [] },
        context: [{ id: "note-retry-request:user", role: "user" }],
        noteOperations: [{
          requestId: "note-retry-request",
          body: "失败后仍保留的 AI 笔记",
          status: "failed",
          errorCode: "NOTE_SAVE_FAILED",
        }],
      },
    });

    const freshStore = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        throw new Error("MODEL_MUST_NOT_RETRY");
      },
      textAnnotations: noteService,
    } as never);
    const retried = await freshStore.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-retry-request",
      text: "请保存这段",
      noteIntent: intent,
    } as never);

    expect(retried).toMatchObject({
      status: "completed",
      session: {
        draft: null,
        context: [
          { id: "note-retry-request:user", role: "user" },
          { id: "note-retry-request:assistant", role: "assistant", text: "失败后仍保留的 AI 笔记" },
        ],
        noteOperations: [{ status: "completed", errorCode: null }],
      },
    });
    expect(responderCalls).toBe(1);
    expect(createCalls).toBe(2);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);
  });

  it("keeps a model failure retryable for an explicit note intent", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_model_retry");
    let responderCalls = 0;
    let createCalls = 0;
    let stateAtResponder: any;
    const noteService = {
      createNote: async (_accountId: string, bookId: string, input: any) => {
        createCalls += 1;
        return {
          status: "saved" as const,
          note: {
            id: "note-model-retried",
            bookId,
            body: input.body,
            source: input.source ?? null,
            version: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        };
      },
      updateNote: async () => { throw new Error("not used"); },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        const [row] = await setup.sql<{ state: unknown }[]>`
          SELECT state
          FROM conversations
          WHERE account_id = 'account-a' AND id = 'conversation-a'
        `;
        stateAtResponder = typeof row?.state === "string" ? JSON.parse(row.state) : row?.state;
        if (responderCalls === 1) throw new Error("MODEL_TEMPORARY_FAILURE");
        return "模型恢复后的笔记";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-model-retry-request",
      text: "请整理",
      noteIntent: { kind: "create" as const, bookId: "book-1", source: noteSource },
    };

    await expect(store.sendText(input as never)).resolves.toMatchObject({
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
    });
    expect(stateAtResponder).toMatchObject({
      noteOperations: [{
        requestId: "note-model-retry-request",
        body: null,
        intent: { kind: "create", bookId: "book-1", source: noteSource },
        status: "pending",
        errorCode: null,
      }],
    });
    await expect(store.getSession("account-a", "conversation-a")).resolves.toMatchObject({
      noteOperations: [{
        requestId: "note-model-retry-request",
        body: null,
        status: "failed",
        errorCode: "CONVERSATION_REPLY_FAILED",
      }],
    });
    const freshStore = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "模型恢复后的笔记";
      },
      textAnnotations: noteService,
    } as never);
    await expect(freshStore.sendText(input as never)).resolves.toMatchObject({ status: "completed" });
    expect(responderCalls).toBe(2);
    expect(createCalls).toBe(1);
  });

  it("keeps a platform-exhausted note intent retryable under one request id", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_platform_retry");
    let responderCalls = 0;
    let createCalls = 0;
    const noteService = {
      createNote: async (_accountId: string, bookId: string, input: any) => {
        createCalls += 1;
        return {
          status: "saved" as const,
          note: {
            id: "note-platform-retried",
            bookId,
            body: input.body,
            source: input.source ?? null,
            version: 1,
            createdAt: "2026-08-30T00:00:00.000Z",
            updatedAt: "2026-08-30T00:00:00.000Z",
          },
        };
      },
      updateNote: async () => { throw new Error("not used"); },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        if (responderCalls === 1) throw new Error("PLATFORM_EXHAUSTION");
        return "平台恢复后的笔记";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-platform-retry-request",
      text: "请整理并保留这次请求",
      noteIntent: { kind: "create" as const, bookId: "book-1", source: noteSource },
    };

    const first = await store.sendText(input as never);
    const retried = await store.sendText(input as never);

    expect(first.status).toBe("failed");
    if (first.status !== "failed") throw new Error("expected failed platform attempt");
    expect(first).toMatchObject({
      retainedDraft: { text: "请整理并保留这次请求", attachments: [] },
      session: {
        draft: { text: "请整理并保留这次请求", attachments: [] },
        context: [{
          id: "note-platform-retry-request:user",
          role: "user",
          requestId: "note-platform-retry-request",
        }],
        noteOperations: [{
          requestId: "note-platform-retry-request",
          body: null,
          status: "failed",
        }],
      },
    });
    expect(retried).toMatchObject({
      status: "completed",
      reply: "平台恢复后的笔记",
      session: {
        draft: null,
        noteOperations: [{
          requestId: "note-platform-retry-request",
          status: "completed",
          errorCode: null,
        }],
      },
    });
    expect(retried.session.context.filter(
      (entry) => entry.id === "note-platform-retry-request:user",
    )).toHaveLength(1);
    expect(retried.session.context.filter(
      (entry) => entry.id === "note-platform-retry-request:assistant",
    )).toHaveLength(1);
    expect(responderCalls).toBe(2);
    expect(createCalls).toBe(1);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);
    expect({
      resultErrorCode: first.errorCode,
      noteErrorCode: first.session.noteOperations?.[0]?.errorCode,
    }).toEqual({
      resultErrorCode: "PLATFORM_EXHAUSTION",
      noteErrorCode: "PLATFORM_EXHAUSTION",
    });
  });

  it("routes an update intent only to its explicit account, book, note, and version", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_update");
    const updateCalls: Array<{ accountId: string; bookId: string; noteId: string; input: any }> = [];
    const noteService = {
      createNote: async () => { throw new Error("not used"); },
      updateNote: async (accountId: string, bookId: string, noteId: string, input: any) => {
        updateCalls.push({ accountId, bookId, noteId, input });
        return {
          status: "saved" as const,
          note: {
            id: noteId,
            bookId,
            body: input.body,
            source: null,
            version: input.expectedVersion + 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        };
      },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => "更新后的 AI 正文",
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-update-request",
      text: "请更新已有笔记",
      noteIntent: { kind: "update", bookId: "book-explicit", noteId: "note-explicit", expectedVersion: 3 },
    } as never)).resolves.toMatchObject({ status: "completed" });

    expect(updateCalls).toEqual([{
      accountId: "account-a",
      bookId: "book-explicit",
      noteId: "note-explicit",
      input: {
        expectedVersion: 3,
        body: "更新后的 AI 正文",
        idempotencyKey: expect.stringMatching(/^conversation-note:[0-9a-f]{64}$/),
      },
    }]);
  });

  it("replays an update after an unknown response without incrementing the note version twice", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_update_replay");
    let responderCalls = 0;
    let updateCalls = 0;
    let version = 1;
    let saved: any;
    let savedKey: string | undefined;
    const noteService = {
      createNote: async () => { throw new Error("not used"); },
      updateNote: async (accountId: string, bookId: string, noteId: string, input: any) => {
        updateCalls += 1;
        expect(input.idempotencyKey).toMatch(/^conversation-note:[0-9a-f]{64}$/);
        savedKey = savedKey ?? input.idempotencyKey;
        expect(input.idempotencyKey).toBe(savedKey);
        if (saved) return saved;
        version += 1;
        saved = {
          status: "saved" as const,
          note: {
            id: noteId,
            bookId,
            body: input.body,
            source: null,
            version,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        };
        throw new Error("UNKNOWN_RESPONSE");
      },
    };
    const firstStore = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "更新后的 AI 正文";
      },
      textAnnotations: noteService,
    } as never);
    await firstStore.createSession("account-a", "conversation-a");
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-update-replay-request",
      text: "请更新已有笔记",
      noteIntent: { kind: "update" as const, bookId: "book-explicit", noteId: "note-explicit", expectedVersion: 1 },
    };

    await expect(firstStore.sendText(input as never)).resolves.toMatchObject({
      status: "failed",
      errorCode: "NOTE_SAVE_FAILED",
    });

    const freshStore = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        throw new Error("MODEL_MUST_NOT_RETRY");
      },
      textAnnotations: noteService,
    } as never);
    await expect(freshStore.sendText(input as never)).resolves.toMatchObject({
      status: "completed",
      reply: "更新后的 AI 正文",
    });
    expect(responderCalls).toBe(1);
    expect(updateCalls).toBe(2);
    expect(version).toBe(2);
    expect(savedKey).toMatch(/^conversation-note:[0-9a-f]{64}$/);
  });

  it("rejects a same-request retry that changes the explicit note intent", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_note_conflict");
    let responderCalls = 0;
    const noteService = {
      createNote: async () => {
        return {
          status: "failed" as const,
          errorCode: "NOTE_SAVE_FAILED" as const,
          retainedDraft: { idempotencyKey: "unused", body: "unused", source: null },
        };
      },
      updateNote: async () => { throw new Error("not used"); },
    };
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async () => {
        responderCalls += 1;
        return "原始 AI 笔记";
      },
      textAnnotations: noteService,
    } as never);
    await store.createSession("account-a", "conversation-a");
    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-conflict-request",
      text: "请保存",
      noteIntent: { kind: "create", bookId: "book-a" },
    } as never);

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "note-conflict-request",
      text: "请保存",
      noteIntent: { kind: "create", bookId: "book-b" },
    } as never)).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    expect(responderCalls).toBe(1);
  });

  it("passes the ordered context, including the current user entry, to the responder", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_context");
    const contexts: Array<readonly unknown[]> = [];
    const accountIds: string[] = [];
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: async (accountId, _text, context) => {
        accountIds.push(accountId);
        contexts.push(context);
        return `上下文：${context.map((entry) => entry.text).join(" / ")}`;
      },
    });
    await store.createSession("account-a", "conversation-a");

    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-context-1",
      text: "第一轮",
    });
    const second = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-context-2",
      text: "第二轮",
    });

    expect(contexts).toEqual([
      [
        { id: "request-context-1:user", role: "user", text: "第一轮", requestId: "request-context-1" },
      ],
      [
        { id: "request-context-1:user", role: "user", text: "第一轮", requestId: "request-context-1" },
        { id: "request-context-1:assistant", role: "assistant", text: "上下文：第一轮", requestId: "request-context-1" },
        { id: "request-context-2:user", role: "user", text: "第二轮", requestId: "request-context-2" },
      ],
    ]);
    expect(accountIds).toEqual(["account-a", "account-a"]);
    expect(second).toMatchObject({
      status: "completed",
      reply: "上下文：第一轮 / 上下文：第一轮 / 第二轮",
    });
  });

  it("fails closed and retains the draft when no responder is configured", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_no_responder");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-a");

    const sent = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-no-responder",
      text: "没有 responder 也不能丢失",
    });

    expect(sent).toMatchObject({
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "没有 responder 也不能丢失", attachments: [] },
      session: {
        draft: { text: "没有 responder 也不能丢失", attachments: [] },
        activeRun: null,
      },
    });
  });

  it("retains the draft and context when the adapter returns an empty reply", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_invalid_reply");
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: createConversationResponder({
        async chat() {
          return { text: "  " };
        },
      }),
    });
    await store.createSession("account-a", "conversation-a");

    const sent = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-invalid-reply",
      text: "空回复不能吞掉上下文",
    });

    expect(sent).toMatchObject({
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "空回复不能吞掉上下文", attachments: [] },
      session: {
        draft: { text: "空回复不能吞掉上下文", attachments: [] },
        activeRun: null,
        context: [
          {
            id: "request-invalid-reply:user",
            role: "user",
            text: "空回复不能吞掉上下文",
            requestId: "request-invalid-reply",
          },
        ],
      },
    });
  });

  it("retains the original input when the local responder fails", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_failure");
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        throw new Error("LOCAL_REPLY_FAILED");
      },
    });
    await store.createSession("account-a", "conversation-a");

    const sent = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-a-1",
      text: "这段输入不能丢",
    });

    expect(sent).toMatchObject({
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "这段输入不能丢", attachments: [] },
      session: { draft: { text: "这段输入不能丢", attachments: [] }, activeRun: null },
    });

    const refreshed = await new ConversationStore(setup.sql, domainStateMachine).getSession(
      "account-a",
      "conversation-a",
    );
    expect(refreshed?.draft).toEqual({ text: "这段输入不能丢", attachments: [] });
  });

  it("reuses one persisted user entry across a failure then same-request retry", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_retry");
    let responderCalls = 0;
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        responderCalls += 1;
        if (responderCalls <= 2) throw new Error("LOCAL_REPLY_FAILED");
        return "重试后完成";
      },
    });
    await store.createSession("account-a", "conversation-a");

    const first = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });
    const second = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });
    const third = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });

    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
    expect(third).toMatchObject({ status: "completed", reply: "重试后完成" });
    if (third.status !== "completed") throw new Error("expected completed retry");
    expect(third.session.context.filter((entry) => entry.id === "request-retry:user")).toHaveLength(1);
    expect(third.session.context.filter((entry) => entry.id === "request-retry:assistant")).toHaveLength(1);
    expect(responderCalls).toBe(3);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);
  });

  it("replays a completed request without a second response or message group", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_replay");
    let responderCalls = 0;
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        responderCalls += 1;
        return "只生成一次";
      },
    });
    await store.createSession("account-a", "conversation-a");

    const first = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-replay",
      text: "响应可能丢失",
    });
    const replay = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-replay",
      text: "响应可能丢失",
    });

    expect(first.status).toBe("completed");
    expect(replay).toMatchObject({ status: "completed", reply: "只生成一次" });
    if (replay.status !== "completed") throw new Error("expected completed replay");
    if (first.status !== "completed") throw new Error("expected initial completed send");
    expect(replay.session.revision).toBe(first.session.revision);
    expect(replay.session.context).toHaveLength(2);
    expect(responderCalls).toBe(1);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);

    const fresh = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-fresh",
      text: "响应可能丢失",
    });
    expect(fresh.status).toBe("completed");
    expect(responderCalls).toBe(2);
    if (fresh.status !== "completed") throw new Error("expected fresh completed send");
    expect(fresh.session.context.filter((entry) => entry.role === "user")).toHaveLength(2);
    expect(fresh.session.context.filter((entry) => entry.role === "assistant")).toHaveLength(2);
  });

  it("fails closed when a request id is reused with different text", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_conflict");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-a");

    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-conflict",
      text: "原始内容",
    });

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-conflict",
      text: "篡改内容",
    })).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
  });

  it("allows the same request id for two accounts and keeps retries account-scoped", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_request_owner");
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      responder: createDevelopmentConversationResponder(),
    });
    await store.createSession("account-a", "conversation-a");
    await store.createSession("account-b", "conversation-b");

    const firstA = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "shared-request",
      text: "账户 A 的消息",
    });
    const firstB = await store.sendText({
      accountId: "account-b",
      conversationId: "conversation-b",
      requestId: "shared-request",
      text: "账户 B 的消息",
    });
    const retryA = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "shared-request",
      text: "账户 A 的消息",
    });
    const retryB = await store.sendText({
      accountId: "account-b",
      conversationId: "conversation-b",
      requestId: "shared-request",
      text: "账户 B 的消息",
    });

    expect(firstA.status).toBe("completed");
    expect(firstB.status).toBe("completed");
    expect(retryA).toMatchObject({ status: "completed" });
    expect(retryB).toMatchObject({ status: "completed" });
    if (retryA.status !== "completed" || retryB.status !== "completed") {
      throw new Error("expected completed account-scoped replies");
    }
    expect(retryA.reply).toMatch(
      /^基于 1 条对话上下文摘要（用户 1、老己 0、系统 0、指纹 [0-9a-f]{10}）回应当前问题。$/,
    );
    expect(retryB.reply).toMatch(
      /^基于 1 条对话上下文摘要（用户 1、老己 0、系统 0、指纹 [0-9a-f]{10}）回应当前问题。$/,
    );
    expect(retryA.reply).not.toBe(retryB.reply);
    const rows = await setup.sql<{ accountId: string; conversationId: string; id: string }[]>`
      SELECT account_id AS "accountId", conversation_id AS "conversationId", id
      FROM messages
      WHERE request_id = 'shared-request'
      ORDER BY account_id, conversation_id, id
    `;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.accountId))).toEqual(new Set(["account-a", "account-b"]));
    expect(new Set(rows.map((row) => row.conversationId))).toEqual(new Set(["conversation-a", "conversation-b"]));
  });

  it("does not expose one account's conversation to another account", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_owner");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-a");

    expect(await store.getSession("account-b", "conversation-a")).toBeNull();
    expect(await store.listSessions("account-b")).toEqual([]);
    await expect(store.createSession("account-b", "conversation-a")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("searches recent conversations by persisted message text without crossing accounts", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_search");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-longan");
    await store.createSession("account-a", "conversation-river");
    await store.createSession("account-b", "conversation-other");

    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-longan",
      requestId: "request-longan",
      text: "长安的故事",
    });
    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-river",
      requestId: "request-river",
      text: "山河的故事",
    });
    await store.sendText({
      accountId: "account-b",
      conversationId: "conversation-other",
      requestId: "request-other",
      text: "长安不应泄露",
    });

    expect((await store.listSessions("account-a", "长安")).map((session) => session.id)).toEqual([
      "conversation-longan",
    ]);
    expect(await store.listSessions("account-b", "山河")).toEqual([]);
  });

  it("injects platform capability exhaustion/config-required responder error into generic CONVERSATION_REPLY_FAILED while preserving exact retained draft/request", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_platform_exhaustion");
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        throw new Error("PLATFORM_EXHAUSTION");
      },
    });
    await store.createSession("account-a", "conversation-a");

    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "exhaustion-request",
      text: "test platform exhaustion",
    };

    await expect(store.sendText(input as never)).resolves.toMatchObject({
      status: "failed",
      errorCode: "PLATFORM_EXHAUSTION",
      retainedDraft: { text: "test platform exhaustion", attachments: [] },
      session: {
        draft: { text: "test platform exhaustion", attachments: [] },
        activeRun: null,
      },
    });
  });

  it.each([
    "PLATFORM_CONFIGURATION_REQUIRED",
    "PLATFORM_UNAVAILABLE",
  ])("preserves distinct platform capability error %s across a same-request retry", async (errorCode) => {
    const setup = await isolatedDatabase(
      databases,
      `conversation_store_${errorCode.toLowerCase()}`,
    );
    let responderCalls = 0;
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        responderCalls += 1;
        throw new Error(errorCode);
      },
    });
    await store.createSession("account-a", "conversation-a");
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "platform-retry-request",
      text: "保留这次平台请求",
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await store.sendText(input);
      expect(result).toMatchObject({
        status: "failed",
        errorCode,
        retainedDraft: { text: "保留这次平台请求", attachments: [] },
        session: {
          draft: { text: "保留这次平台请求", attachments: [] },
          activeRun: null,
        },
      });
      expect(result.session.context.filter(
        (entry) => entry.id === "platform-retry-request:user",
      )).toHaveLength(1);
    }
    expect(responderCalls).toBe(2);
  });
});

async function isolatedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 1 });
  databases.push({ administration, schema, sql });
  await migrateConversationSchema(sql);
  return { schema, sql };
}
