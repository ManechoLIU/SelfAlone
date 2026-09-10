import { describe, expect, it } from "vitest";
import {
  advanceDraft,
  confirmOutlineToTemplate,
  createTask,
  selectDraftTemplate,
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

describe("PPT outline confirmation to template", () => {
  const requirementsDraft: PptDraft = { stage: "requirements", version: 2 };
  const validOutline = [
    { level: 1 as const },
    { level: 2 as const },
    { level: 3 as const },
    { level: 1 as const },
  ];

  it("confirms a valid saved outline into the template stage", () => {
    expect(confirmOutlineToTemplate(requirementsDraft, 2, validOutline)).toEqual({
      stage: "template",
      version: 3,
    });
    expect(confirmOutlineToTemplate({ stage: "outline", version: 4 }, 4, validOutline)).toEqual({
      stage: "template",
      version: 5,
    });
  });

  it("rejects a missing page, orphan child, and stale confirmation", () => {
    expect(() => confirmOutlineToTemplate(requirementsDraft, 2, [])).toThrow("INVALID_OUTLINE");
    expect(() => confirmOutlineToTemplate(requirementsDraft, 2, [{ level: 2 }])).toThrow(
      "INVALID_OUTLINE",
    );
    expect(() => confirmOutlineToTemplate(requirementsDraft, 2, [
      { level: 1 },
      { level: 3 },
    ])).toThrow("INVALID_OUTLINE");
    expect(() => confirmOutlineToTemplate(requirementsDraft, 1, validOutline)).toThrow(
      "STALE_VERSION",
    );
  });

  it("does not confirm from template or submitted", () => {
    expect(() => confirmOutlineToTemplate(
      { stage: "template", version: 3 },
      3,
      validOutline,
    )).toThrow("INVALID_STAGE_TRANSITION");
    expect(() => confirmOutlineToTemplate(
      { stage: "submitted", version: 4 },
      4,
      validOutline,
    )).toThrow("INVALID_STAGE_TRANSITION");
  });
});

describe("PPT template selection", () => {
  const draft: PptDraft = { stage: "template", version: 3 };

  it("selects only the three canonical template IDs", () => {
    expect(selectDraftTemplate(draft, 3, "celadon-reading")).toEqual({
      stage: "template",
      version: 4,
      templateId: "celadon-reading",
    });
    expect(selectDraftTemplate(draft, 3, "editorial-paper").templateId).toBe("editorial-paper");
    expect(selectDraftTemplate(draft, 3, "minimal-ink").templateId).toBe("minimal-ink");
  });

  it("rejects unknown, legacy, stale, and pre-template selection", () => {
    expect(() => selectDraftTemplate(draft, 3, "qingci-study")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => selectDraftTemplate(draft, 3, "paper-notes")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => selectDraftTemplate(draft, 3, "ink-minimal")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => selectDraftTemplate(draft, 3, "modern-minimal")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => selectDraftTemplate(draft, 2, "celadon-reading")).toThrow("STALE_VERSION");
    expect(() => selectDraftTemplate(
      { stage: "requirements", version: 2 },
      2,
      "celadon-reading",
    )).toThrow("INVALID_STAGE_TRANSITION");
    expect(() => selectDraftTemplate(
      { stage: "outline", version: 2 },
      2,
      "celadon-reading",
    )).toThrow("INVALID_STAGE_TRANSITION");
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
