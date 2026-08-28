import { describe, expect, it } from "vitest";
import type { ConversationNoteOperation, TextAnnotationSource } from "@selfalone/contracts";
import {
  appendConversationContext,
  completeConversationNoteOperation,
  createConversationNoteOperation,
  createConversationSession,
  deleteConversationSession,
  failConversationNoteOperation,
  isConversationSendLocked,
  recordConversationWork,
  settleConversationRun,
  startConversationNoteOperation,
  startConversationRun,
  updateConversationDraft,
} from "./conversation-session";

const source: TextAnnotationSource = {
  locator: { kind: "text", fileVersion: 3, sectionId: "txt:00000000", offset: 3 },
  endOffset: 7,
  quote: "灯塔亮了",
};

describe("conversation session state", () => {
  it("binds an explicit note intent before the model body exists", () => {
    const requestId = "note-before-model";
    const intent = { kind: "create" as const, bookId: "book-1", source: null };
    const preModelOperation = {
      requestId,
      body: null,
      intent,
      status: "pending" as const,
      errorCode: null,
    } satisfies ConversationNoteOperation;
    const initial = createConversationSession("conversation-before-model");
    let bound: ReturnType<typeof createConversationSession> | undefined;
    let thrown: unknown;
    try {
      bound = startConversationNoteOperation(initial, initial.revision, preModelOperation);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    if (!bound) return;

    expect(bound.noteOperations).toEqual([preModelOperation]);
    const hydrated = JSON.parse(JSON.stringify(bound)) as typeof bound;
    const hydratedReplay = startConversationNoteOperation(
      hydrated,
      hydrated.revision,
      preModelOperation,
    );
    expect(hydratedReplay).toEqual(bound);

    expect(() => startConversationNoteOperation(bound!, bound!.revision, {
      ...preModelOperation,
      intent: { kind: "create", bookId: "book-other", source: null },
    })).toThrow("REQUEST_ID_CONFLICT");
    expect(() => startConversationNoteOperation(bound!, bound!.revision, {
      ...preModelOperation,
      intent: { kind: "create", bookId: "book-1", source },
    })).toThrow("REQUEST_ID_CONFLICT");
    expect(() => startConversationNoteOperation(bound!, bound!.revision, {
      ...preModelOperation,
      intent: { kind: "update", bookId: "book-1", noteId: "note-1", expectedVersion: 1 },
    })).toThrow("REQUEST_ID_CONFLICT");

    const withBody = startConversationNoteOperation(bound, bound.revision, {
      ...preModelOperation,
      body: "模型生成的唯一正文",
    });
    expect(withBody.noteOperations?.[0]?.body).toBe("模型生成的唯一正文");
    const replayedBody = startConversationNoteOperation(withBody, withBody.revision, {
      ...preModelOperation,
      body: "模型生成的唯一正文",
    });
    expect(replayedBody).toEqual(withBody);
    expect(() => startConversationNoteOperation(withBody, withBody.revision, {
      ...preModelOperation,
      body: "第二次正文不能覆盖",
    })).toThrow("REQUEST_ID_CONFLICT");
  });

  it("creates a titleless note operation with book identity and an optional source", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-create-1",
      body: "海面退潮后，路才显出来。",
      intent: { kind: "create", bookId: "book-1", source },
    });

    expect(operation).toEqual({
      requestId: "note-create-1",
      body: "海面退潮后，路才显出来。",
      intent: { kind: "create", bookId: "book-1", source },
      status: "pending",
      errorCode: null,
    });
    expect(operation.intent).not.toHaveProperty("title");
  });

  it("requires an explicit note id and expected version for updates", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-update-1",
      body: "修改后的笔记正文。",
      intent: { kind: "update", bookId: "book-1", noteId: "note-1", expectedVersion: 2 },
    });

    expect(operation.intent).toEqual({
      kind: "update",
      bookId: "book-1",
      noteId: "note-1",
      expectedVersion: 2,
    });
    expect(() => createConversationNoteOperation({
      requestId: "note-update-missing-id",
      body: "不能猜目标。",
      intent: { kind: "update", bookId: "book-1", expectedVersion: 2 } as never,
    })).toThrow("NOTE_ID_REQUIRED");
  });

  it("validates a serialized operation request id when starting it", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-start-request-id",
      body: "不能绕过入口校验。",
      intent: { kind: "create", bookId: "book-1" },
    });

    expect(() => startConversationNoteOperation(
      createConversationSession("conversation-start-request-id"),
      0,
      { ...operation, requestId: "   " },
    )).toThrow("REQUEST_ID_REQUIRED");
  });

  it("validates a serialized update operation note id when starting it", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-start-note-id",
      body: "不能猜已有笔记。",
      intent: { kind: "create", bookId: "book-1" },
    });

    expect(() => startConversationNoteOperation(
      createConversationSession("conversation-start-note-id"),
      0,
      {
        ...operation,
        intent: { kind: "update", bookId: "book-1", expectedVersion: 1 } as never,
      },
    )).toThrow("NOTE_ID_REQUIRED");
  });

  it("validates a serialized update operation expected version when starting it", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-start-version",
      body: "版本必须明确。",
      intent: { kind: "create", bookId: "book-1" },
    });

    expect(() => startConversationNoteOperation(
      createConversationSession("conversation-start-version"),
      0,
      {
        ...operation,
        intent: { kind: "update", bookId: "book-1", noteId: "note-1", expectedVersion: 0 },
      },
    )).toThrow("NOTE_VERSION_INVALID");
  });

  it("validates a serialized operation source when starting it", () => {
    const operation = createConversationNoteOperation({
      requestId: "note-start-source",
      body: "引用结构必须可靠。",
      intent: { kind: "create", bookId: "book-1" },
    });

    expect(() => startConversationNoteOperation(
      createConversationSession("conversation-start-source"),
      0,
      {
        ...operation,
        intent: {
          kind: "create",
          bookId: "book-1",
          source: { ...source, quote: "" },
        },
      },
    )).toThrow("INVALID_HIGHLIGHT_QUOTE");
  });

  it("rejects a note operation quote over the shared annotation limit", () => {
    expect(() => createConversationNoteOperation({
      requestId: "note-quote-too-long",
      body: "引用不能无限增长。",
      intent: {
        kind: "create",
        bookId: "book-1",
        source: { ...source, quote: "q".repeat(20_001) },
      },
    })).toThrow("TEXT_TOO_LONG");
  });

  it("rejects a note operation body over the shared annotation limit", () => {
    expect(() => createConversationNoteOperation({
      requestId: "note-body-too-long",
      body: "b".repeat(100_001),
      intent: { kind: "create", bookId: "book-1" },
    })).toThrow("TEXT_TOO_LONG");
  });

  it("keeps a failed note operation retryable and idempotent by request id", () => {
    const input = {
      requestId: "note-retry-1",
      body: "请把这段讨论整理成笔记。",
      intent: { kind: "create" as const, bookId: "book-1", source: null },
    };
    const operation = createConversationNoteOperation(input);
    const started = startConversationNoteOperation(createConversationSession("conversation-a"), 0, operation);
    const failed = failConversationNoteOperation(started, started.revision, operation.requestId, "NOTE_SAVE_FAILED");

    expect(failed.noteOperations).toEqual([{ ...operation, status: "failed", errorCode: "NOTE_SAVE_FAILED" }]);

    const retried = startConversationNoteOperation(failed, failed.revision, operation);
    expect(retried.noteOperations).toEqual([operation]);

    const completed = completeConversationNoteOperation(retried, retried.revision, operation.requestId);
    const replayed = startConversationNoteOperation(completed, 0, operation);
    expect(replayed).toEqual(completed);
    expect(replayed.noteOperations).toEqual([{ ...operation, status: "completed", errorCode: null }]);
  });

  it("hydrates a legacy session without note operation history", () => {
    const current = createConversationSession("conversation-legacy");
    const { noteOperations: _legacyNoteOperations, ...legacy } = current;
    const operation = createConversationNoteOperation({
      requestId: "note-legacy-1",
      body: "兼容旧会话状态。",
      intent: { kind: "create", bookId: "book-legacy" },
    });

    const hydrated = startConversationNoteOperation(legacy, legacy.revision, operation);

    expect(hydrated.noteOperations).toEqual([operation]);
  });

  it("keeps draft and context independent while locking only the active session", () => {
    const first = createConversationSession("conversation-a");
    const second = createConversationSession("conversation-b");

    const firstWithDraft = updateConversationDraft(first, 0, {
      text: "整理第一本书",
      attachments: [],
    });
    const firstWithContext = appendConversationContext(firstWithDraft, 1, {
      id: "message-a-1",
      role: "user",
      text: "先记住这段上下文",
    });
    const runningFirst = startConversationRun(firstWithContext, {
      expectedRevision: 2,
      requestId: "request-a-1",
      kind: "response",
    });

    expect(runningFirst.draft).toEqual({ text: "整理第一本书", attachments: [] });
    expect(runningFirst.context).toHaveLength(1);
    expect(isConversationSendLocked(runningFirst)).toBe(true);
    expect(isConversationSendLocked(second)).toBe(false);
    expect(second.draft).toBeNull();
    expect(second.context).toEqual([]);
  });

  it.each(["stopped", "failed", "completed"] as const)(
    "unlocks sending after a %s response",
    (status) => {
      const running = startConversationRun(createConversationSession("conversation-a"), {
        expectedRevision: 0,
        requestId: `request-${status}`,
        kind: "response",
      });

      const settled = settleConversationRun(running, {
        requestId: `request-${status}`,
        status,
      });

      expect(settled.activeRun).toBeNull();
      expect(isConversationSendLocked(settled)).toBe(false);
    },
  );

  it("clears an unsubmitted draft without deleting started task work", () => {
    const initial = updateConversationDraft(createConversationSession("conversation-a"), 0, {
      text: "还没发送的要求",
      attachments: ["image-1"],
    });
    const running = startConversationRun(initial, {
      expectedRevision: 1,
      requestId: "task-request-1",
      kind: "task",
      taskId: "task-1",
    });
    const withWork = recordConversationWork(running, {
      taskId: "task-1",
      requestId: "task-request-1",
      work: { id: "work-1", kind: "ppt-page" },
    });

    const deleted = deleteConversationSession(withWork, withWork.revision);

    expect(deleted.deleted).toBe(true);
    expect(deleted.draft).toBeNull();
    expect(deleted.tasks).toEqual([
      {
        id: "task-1",
        requestId: "task-request-1",
        status: "running",
      },
    ]);
    expect(deleted.works).toEqual([{ id: "work-1", taskId: "task-1", kind: "ppt-page" }]);
  });

  it("lets a started task finish after its session is deleted", () => {
    const running = startConversationRun(createConversationSession("conversation-a"), {
      expectedRevision: 0,
      requestId: "task-request-1",
      kind: "task",
      taskId: "task-1",
    });
    const deleted = deleteConversationSession(running, running.revision);

    const completed = settleConversationRun(deleted, {
      requestId: "task-request-1",
      status: "completed",
    });

    expect(completed.deleted).toBe(true);
    expect(completed.activeRun).toBeNull();
    expect(completed.tasks).toEqual([
      { id: "task-1", requestId: "task-request-1", status: "completed" },
    ]);
    expect(isConversationSendLocked(completed)).toBe(false);
  });

  it("rejects stale revisions and late requests without overwriting newer state", () => {
    const first = updateConversationDraft(createConversationSession("conversation-a"), 0, {
      text: "最新草稿",
      attachments: [],
    });

    expect(() => updateConversationDraft(first, 0, { text: "旧草稿", attachments: [] })).toThrow(
      "STALE_REVISION",
    );
    expect(first.draft).toEqual({ text: "最新草稿", attachments: [] });

    const oldRun = startConversationRun(first, {
      expectedRevision: 1,
      requestId: "request-old",
      kind: "response",
    });
    const stoppedOldRun = settleConversationRun(oldRun, {
      requestId: "request-old",
      status: "stopped",
    });
    const newRun = startConversationRun(stoppedOldRun, {
      expectedRevision: stoppedOldRun.revision,
      requestId: "request-new",
      kind: "response",
    });

    expect(() =>
      settleConversationRun(newRun, {
        requestId: "request-old",
        status: "completed",
        contextEntry: { id: "late", role: "assistant", text: "旧回答" },
      }),
    ).toThrow("STALE_REQUEST");
    expect(newRun.activeRun?.requestId).toBe("request-new");
    expect(newRun.context).toEqual([]);
  });

  it("does not allow a second run in one session", () => {
    const running = startConversationRun(createConversationSession("conversation-a"), {
      expectedRevision: 0,
      requestId: "request-a",
      kind: "response",
    });

    expect(() =>
      startConversationRun(running, {
        expectedRevision: running.revision,
        requestId: "request-b",
        kind: "task",
        taskId: "task-b",
      }),
    ).toThrow("CONVERSATION_BUSY");
  });
});
