import { describe, expect, it, vi } from "vitest";
import {
  createFakePptOutlineGenerationAdapter,
  createFakePptPublicSourceAdapter,
} from "./ppt-outline-adapters";
import { createRealPptPublicSourceAdapter } from "./ppt-outline-public-source-adapter";
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

  it("uses the injected fake research and generation seam and fails closed without it", async () => {
    const save = vi.fn(async () => ({ version: 4 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network disabled");
    });
    const missing = new PptOutlineRuntime({ save });
    const generateInput = {
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 3,
      purpose: "读书会分享",
      audience: "产品团队",
      pageRange: { min: 2, max: 6 } as const,
      additionalRequirements: "",
      sources: [{ bookId: "book-a", title: "第一本书", author: "甲作者" }],
    };

    await expect(missing.generateOutline(generateInput)).rejects.toEqual(
      new PptOutlineRuntimeError("PPT_OUTLINE_ADAPTER_NOT_CONFIGURED"),
    );
    expect(save).not.toHaveBeenCalled();

    const runtime = new PptOutlineRuntime({ save }, {
      generation: createFakePptOutlineGenerationAdapter(),
      publicSources: createFakePptPublicSourceAdapter(),
    });
    const generated = await runtime.generateOutline(generateInput);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generated.pageCount).toBe(1);
    expect(generated.publicSources).toHaveLength(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 3,
      pageCount: 1,
      publicSources: generated.publicSources,
    }));
    fetchSpy.mockRestore();
  });

  it("forwards bodySufficient so real public sources skip network and persist empty provenance", async () => {
    const save = vi.fn(async () => ({ version: 5 }));
    const search = vi.fn(async () => {
      throw new Error("transport must not run when body is sufficient");
    });
    const runtime = new PptOutlineRuntime({ save }, {
      generation: createFakePptOutlineGenerationAdapter(),
      publicSources: createRealPptPublicSourceAdapter({ transport: { search } }),
    });

    const generated = await runtime.generateOutline({
      accountId: "account-a",
      draftId: "draft-a",
      expectedVersion: 4,
      purpose: "读书会分享",
      audience: "产品团队",
      pageRange: { min: 2, max: 6 },
      additionalRequirements: "",
      sources: [{ bookId: "book-a", title: "第一本书", author: "甲作者" }],
      bodySufficient: true,
    });

    expect(search).not.toHaveBeenCalled();
    expect(generated.publicSources).toEqual([]);
    expect(JSON.stringify(generated.publicSources)).not.toContain("example.invalid");
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
