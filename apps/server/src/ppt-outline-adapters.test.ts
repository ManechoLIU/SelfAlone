import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePptOutlineGenerationAdapter,
  createFakePptPublicSourceAdapter,
} from "./ppt-outline-adapters";

describe("fake PPT outline research and generation adapters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns deterministic public sources and outline paragraphs without network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network disabled");
    });
    const publicSources = createFakePptPublicSourceAdapter();
    const generation = createFakePptOutlineGenerationAdapter();
    const signal = new AbortController().signal;

    const researched = await publicSources.search({
      accountId: "account-a",
      draftId: "draft-a",
      title: "第一本书",
      author: "甲作者",
    }, signal);
    const generated = await generation.createOutline({
      accountId: "account-a",
      draftId: "draft-a",
      purpose: "读书会分享",
      audience: "产品团队",
      pageRange: { min: 2, max: 6 },
      additionalRequirements: "",
      sources: [{ bookId: "book-a", title: "第一本书", author: "甲作者" }],
      publicSources: researched,
    }, signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(researched).toEqual([
      {
        url: "https://publisher.example.invalid/catalog/book",
        title: "出版社公开目录",
        publishedAt: "2024-01-01T00:00:00.000Z",
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline:draft-a",
      },
      {
        url: "https://author.example.invalid/interview",
        title: "作者访谈",
        publishedAt: "2024-06-01T00:00:00.000Z",
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline:draft-a",
      },
    ]);
    expect(generated.paragraphs).toEqual([
      { id: "page-1", level: 1, text: "第一本书" },
      { id: "point-1", level: 2, text: "核心观点" },
      { id: "detail-1", level: 3, text: "观点说明" },
    ]);
  });
});
