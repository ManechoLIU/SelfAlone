import { describe, expect, it } from "vitest";
import {
  advanceDraft,
  createTask,
  stopTask,
  type PptDraft,
  type PptTask,
} from "./ppt-state";

describe("PPT draft state", () => {
  const draft: PptDraft = { stage: "requirements", version: 1 };

  it("moves through the four stages in order", () => {
    const outlined = advanceDraft(draft, "outline", 1);
    const templated = advanceDraft(outlined, "template", 2);
    const submitted = advanceDraft(templated, "submitted", 3);

    expect(submitted).toEqual({ stage: "submitted", version: 4 });
  });

  it("rejects skipped stages and stale versions", () => {
    expect(() => advanceDraft(draft, "template", 1)).toThrow("INVALID_STAGE_TRANSITION");
    expect(() => advanceDraft(draft, "outline", 0)).toThrow("STALE_VERSION");
  });
});

describe("PPT task state", () => {
  it("reuses the task for the same idempotency key", () => {
    const first = createTask(undefined, "draft-1", "request-1", 4);
    const repeated = createTask(first, "draft-1", "request-1", 4);

    expect(repeated).toBe(first);
  });

  it("stops queued and running tasks while preserving completed pages", () => {
    const running: PptTask = {
      id: "task-1",
      draftId: "draft-1",
      idempotencyKey: "request-1",
      status: "running",
      completedPages: 2,
      totalPages: 5,
      version: 3,
    };

    expect(stopTask(running, 3)).toMatchObject({
      status: "stopped",
      completedPages: 2,
      version: 4,
    });
  });
});
