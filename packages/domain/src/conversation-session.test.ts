import { describe, expect, it } from "vitest";
import {
  appendConversationContext,
  createConversationSession,
  deleteConversationSession,
  isConversationSendLocked,
  recordConversationWork,
  settleConversationRun,
  startConversationRun,
  updateConversationDraft,
} from "./conversation-session";

describe("conversation session state", () => {
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
