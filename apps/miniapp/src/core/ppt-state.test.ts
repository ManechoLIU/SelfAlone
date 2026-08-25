import { describe, expect, it } from "vitest";
import { isOutlineHierarchyValid, requiresBookContextConfirmation, resolvePptScreen, shouldPollTask, summarizeTask, taskIdempotencyKey } from "./ppt-state";

describe("PPT draft and task recovery", () => {
  it("restores the current stage from a client snapshot", () => {
    expect(resolvePptScreen({ draft: { stage: "requirements" }, task: null })).toBe("requirements");
    expect(resolvePptScreen({ draft: { stage: "outline" }, task: null })).toBe("outline");
    expect(resolvePptScreen({ draft: { stage: "template" }, task: null })).toBe("template");
    expect(resolvePptScreen({ draft: { stage: "submitted" }, task: { status: "running" } })).toBe("generating");
    expect(resolvePptScreen({ draft: { stage: "submitted" }, task: { status: "completed" } })).toBe("completed");
    expect(resolvePptScreen({ draft: { stage: "submitted" }, task: { status: "failed" } })).toBe("failed");
    expect(resolvePptScreen({ draft: { stage: "submitted" }, task: { status: "stopped" } })).toBe("stopped");
  });

  it("polls only non-terminal tasks and keeps completed-page evidence", () => {
    expect(shouldPollTask({ status: "queued" })).toBe(true);
    expect(shouldPollTask({ status: "running" })).toBe(true);
    expect(shouldPollTask({ status: "completed" })).toBe(false);
    expect(summarizeTask({ status: "failed", completedPages: 2, totalPages: 5 })).toBe("已保留 2 / 5 页");
  });

  it("reuses one idempotency key when the same draft submission is retried", () => {
    expect(taskIdempotencyKey("draft-1", 3)).toBe("miniapp:task:draft-1:v3");
    expect(taskIdempotencyKey("draft-1", 3)).toBe("miniapp:task:draft-1:v3");
  });

  it("blocks a development workspace from silently replacing the requested book", () => {
    expect(requiresBookContextConfirmation("book-current", "book-development")).toBe(true);
    expect(requiresBookContextConfirmation("book-current", "book-current")).toBe(false);
    expect(requiresBookContextConfirmation("", "book-development")).toBe(false);
  });

  it("rejects orphan outline levels before saving", () => {
    expect(isOutlineHierarchyValid([{ level: 1 }, { level: 2 }, { level: 3 }])).toBe(true);
    expect(isOutlineHierarchyValid([{ level: 2 }, { level: 1 }])).toBe(false);
    expect(isOutlineHierarchyValid([{ level: 1 }, { level: 3 }])).toBe(false);
    expect(isOutlineHierarchyValid([])).toBe(false);
  });
});
