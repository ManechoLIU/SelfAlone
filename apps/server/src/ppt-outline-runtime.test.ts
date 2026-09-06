import { describe, expect, it, vi } from "vitest";
import { PptOutlineRuntime, PptOutlineRuntimeError } from "./ppt-outline-runtime";

describe("PptOutlineRuntime", () => {
  it("rejects orphan child paragraphs before persisting and counts pages from level-1 paragraphs", async () => {
    const save = vi.fn(async () => ({ version: 3 }));
    const runtime = new PptOutlineRuntime({ save });

    await expect(runtime.saveOutline({
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 2,
      paragraphs: [
        { id: "point-orphan", level: 2, text: "没有页面的要点" },
      ],
    })).rejects.toEqual(new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD"));
    expect(save).not.toHaveBeenCalled();

    const result = await runtime.saveOutline({
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 2,
      paragraphs: [
        { id: "page-1", level: 1, text: "第一章" },
        { id: "point-1", level: 2, text: "核心观点" },
        { id: "detail-1", level: 3, text: "观点说明" },
        { id: "page-2", level: 1, text: "第二章" },
      ],
    });

    expect(result.pageCount).toBe(2);
    expect(save).toHaveBeenCalledWith({
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 2,
      paragraphs: [
        { id: "page-1", level: 1, text: "第一章" },
        { id: "point-1", level: 2, text: "核心观点" },
        { id: "detail-1", level: 3, text: "观点说明" },
        { id: "page-2", level: 1, text: "第二章" },
      ],
      pageCount: 2,
    });
  });
});

it("rejects level-3 paragraphs that do not follow a level-2 point", async () => {
  const save = vi.fn(async () => ({ version: 4 }));
  const runtime = new PptOutlineRuntime({ save });

  await expect(runtime.saveOutline({
    accountId: "account-a",
    draftId: "draft-a",
    expectedVersion: 3,
    paragraphs: [
      { id: "page-1", level: 1, text: "第一章" },
      { id: "detail-orphan", level: 3, text: "没有要点的说明" },
    ],
  })).rejects.toEqual(new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD"));
  expect(save).not.toHaveBeenCalled();
});
