import { describe, expect, it } from "vitest";
import { ConversationRuntime } from "./conversation-runtime";

const domainModulePath = "../../../packages/domain/src/" + "conversation-session";
const domain = await import(domainModulePath);
const domainStateMachine = {
  createSession: domain.createConversationSession,
  updateDraft: domain.updateConversationDraft,
  appendContext: domain.appendConversationContext,
  startRun: domain.startConversationRun,
  recordWork: domain.recordConversationWork,
  settleRun: domain.settleConversationRun,
  deleteSession: domain.deleteConversationSession,
  isSendLocked: domain.isConversationSendLocked,
};

describe("in-memory conversation runtime", () => {
  it("delegates state transitions to the injected domain machine", () => {
    const calls: string[] = [];
    const machine = {
      ...domainStateMachine,
      updateDraft: (...args: Parameters<typeof domain.updateConversationDraft>) => {
        calls.push("updateDraft");
        return domain.updateConversationDraft(...args);
      },
      startRun: (...args: Parameters<typeof domain.startConversationRun>) => {
        calls.push("startRun");
        return domain.startConversationRun(...args);
      },
    };
    const runtime = new ConversationRuntime(machine);
    runtime.createSession("conversation-a");

    runtime.updateDraft({
      sessionId: "conversation-a",
      expectedRevision: 0,
      draft: { text: "交给 domain", attachments: [] },
    });
    runtime.startResponse({
      sessionId: "conversation-a",
      expectedRevision: 1,
      requestId: "request-a",
    });

    expect(calls).toEqual(["updateDraft", "startRun"]);
  });

  it("keeps session locks local so another idle session can send", () => {
    const runtime = new ConversationRuntime(domainStateMachine);
    runtime.createSession("conversation-a");
    runtime.createSession("conversation-b");

    const running = runtime.startResponse({
      sessionId: "conversation-a",
      expectedRevision: 0,
      requestId: "request-a",
    });

    expect(runtime.canSend("conversation-a")).toBe(false);
    expect(runtime.canSend("conversation-b")).toBe(true);
    expect(runtime.startTask({
      sessionId: "conversation-b",
      expectedRevision: 0,
      requestId: "task-b",
      taskId: "task-b",
    }).activeRun?.requestId).toBe("task-b");
    expect(running.activeRun?.requestId).toBe("request-a");
  });

  it("releases a session lock on every terminal outcome", () => {
    for (const status of ["stopped", "failed", "completed"] as const) {
      const runtime = new ConversationRuntime(domainStateMachine);
      runtime.createSession("conversation-a");
      runtime.startResponse({
        sessionId: "conversation-a",
        expectedRevision: 0,
        requestId: `request-${status}`,
      });

      runtime.finishRun({
        sessionId: "conversation-a",
        requestId: `request-${status}`,
        status,
      });

      expect(runtime.canSend("conversation-a")).toBe(true);
    }
  });

  it("also releases a lock when a task stops, fails, or completes", () => {
    for (const status of ["stopped", "failed", "completed"] as const) {
      const runtime = new ConversationRuntime(domainStateMachine);
      runtime.createSession("conversation-a");
      runtime.startTask({
        sessionId: "conversation-a",
        expectedRevision: 0,
        requestId: `task-${status}`,
        taskId: `task-${status}`,
      });

      runtime.finishRun({
        sessionId: "conversation-a",
        requestId: `task-${status}`,
        status,
      });

      expect(runtime.canSend("conversation-a")).toBe(true);
      expect(runtime.getSession("conversation-a")?.tasks[0]?.status).toBe(status);
    }
  });

  it("deletes only the unsubmitted draft while retaining started tasks and works", () => {
    const runtime = new ConversationRuntime(domainStateMachine);
    runtime.createSession("conversation-a");
    runtime.updateDraft({
      sessionId: "conversation-a",
      expectedRevision: 0,
      draft: { text: "待发送", attachments: ["image-1"] },
    });
    runtime.startTask({
      sessionId: "conversation-a",
      expectedRevision: 1,
      requestId: "task-request",
      taskId: "task-1",
    });
    runtime.recordWork({
      sessionId: "conversation-a",
      taskId: "task-1",
      requestId: "task-request",
      work: { id: "work-1", kind: "ppt-page" },
    });

    runtime.deleteSession({ sessionId: "conversation-a", expectedRevision: 3 });

    expect(runtime.listSessions()).toEqual([]);
    expect(runtime.getSession("conversation-a")).toMatchObject({
      deleted: true,
      draft: null,
      tasks: [{ id: "task-1", status: "running" }],
      works: [{ id: "work-1", taskId: "task-1", kind: "ppt-page" }],
    });
  });

  it("ignores no stale request and does not overwrite a newer run", () => {
    const runtime = new ConversationRuntime(domainStateMachine);
    runtime.createSession("conversation-a");
    runtime.startResponse({
      sessionId: "conversation-a",
      expectedRevision: 0,
      requestId: "request-old",
    });
    runtime.finishRun({ sessionId: "conversation-a", requestId: "request-old", status: "stopped" });
    runtime.startResponse({
      sessionId: "conversation-a",
      expectedRevision: 2,
      requestId: "request-new",
    });

    expect(() =>
      runtime.finishRun({
        sessionId: "conversation-a",
        requestId: "request-old",
        status: "completed",
      }),
    ).toThrow("STALE_REQUEST");
    expect(runtime.getSession("conversation-a")?.activeRun?.requestId).toBe("request-new");
  });
});
