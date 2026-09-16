import type { PptOutlineParagraph } from "./ppt-outline-runtime";

export type PptPublicSource = {
  url: string;
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  usageScope: string;
};

export type OutlineInput = {
  accountId: string;
  draftId: string;
  purpose: string | null;
  audience: string | null;
  pageRange: { min: number; max: number } | null;
  additionalRequirements: string;
  sources: readonly { bookId: string; title: string; author: string | null }[];
  publicSources: readonly PptPublicSource[];
};

export type OutlineResult = {
  paragraphs: PptOutlineParagraph[];
};

export type BookSourceQuery = {
  accountId: string;
  draftId: string;
  title: string;
  author: string | null;
  /**
   * When true, the real public-source adapter skips networking and returns [].
   * Fake adapters ignore this field (compat).
   */
  bodySufficient?: boolean;
  /**
   * Optional body length clue. Real adapter may treat values at/above its
   * threshold as sufficient when `bodySufficient` is unset.
   */
  bodyCharCount?: number;
};

export interface PptOutlineGenerationAdapter {
  createOutline(input: OutlineInput, signal: AbortSignal): Promise<OutlineResult>;
}

export interface PptPublicSourceAdapter {
  search(input: BookSourceQuery, signal: AbortSignal): Promise<PptPublicSource[]>;
}

export type PptOutlineAdapters = {
  generation?: PptOutlineGenerationAdapter;
  publicSources?: PptPublicSourceAdapter;
};

const fakeFetchedAt = "2026-09-06T00:00:00.000Z";

const defaultFakeSources: readonly PptPublicSource[] = [
  {
    url: "https://publisher.example.invalid/catalog/book",
    title: "出版社公开目录",
    publishedAt: "2024-01-01T00:00:00.000Z",
    fetchedAt: fakeFetchedAt,
    usageScope: "outline",
  },
  {
    url: "https://author.example.invalid/interview",
    title: "作者访谈",
    publishedAt: "2024-06-01T00:00:00.000Z",
    fetchedAt: fakeFetchedAt,
    usageScope: "outline",
  },
];

export class FakePptOutlineGenerationAdapter implements PptOutlineGenerationAdapter {
  async createOutline(input: OutlineInput, signal: AbortSignal): Promise<OutlineResult> {
    if (signal.aborted) throw new Error("PPT_OUTLINE_ABORTED");
    const title = input.sources[0]?.title?.trim() || input.purpose?.trim() || "公开资料补全";
    return {
      paragraphs: [
        { id: "page-1", level: 1, text: title },
        { id: "point-1", level: 2, text: "核心观点" },
        { id: "detail-1", level: 3, text: "观点说明" },
      ],
    };
  }
}

export class FakePptPublicSourceAdapter implements PptPublicSourceAdapter {
  constructor(private readonly documents: readonly PptPublicSource[] = defaultFakeSources) {}

  async search(input: BookSourceQuery, signal: AbortSignal): Promise<PptPublicSource[]> {
    if (signal.aborted) throw new Error("PPT_OUTLINE_ABORTED");
    return this.documents.map((document) => ({
      ...document,
      usageScope: `${document.usageScope}:${input.draftId}`,
    }));
  }
}

export function createFakePptOutlineGenerationAdapter(): PptOutlineGenerationAdapter {
  return new FakePptOutlineGenerationAdapter();
}

export function createFakePptPublicSourceAdapter(
  documents?: readonly PptPublicSource[],
): PptPublicSourceAdapter {
  return new FakePptPublicSourceAdapter(documents);
}
