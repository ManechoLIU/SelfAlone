import type {
  OutlineInput,
  PptOutlineAdapters,
  PptPublicSource,
} from "./ppt-outline-adapters";

export type PptOutlineParagraph = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

export type PptOutlineSnapshot = {
  version: number;
  pageCount: number;
  paragraphs: PptOutlineParagraph[];
  publicSources: PptPublicSource[];
};

export type PptOutlineSaveInput = {
  accountId: string;
  draftId: string;
  expectedVersion: number;
  paragraphs: PptOutlineParagraph[];
  publicSources?: PptPublicSource[];
};

export type PptOutlineGenerateInput = Omit<OutlineInput, "publicSources"> & {
  expectedVersion: number;
  signal?: AbortSignal;
};

type PptOutlinePersistence = {
  save(input: PptOutlineSaveInput & { pageCount: number }): Promise<{ version: number }>;
};

export type PptOutlineRuntimeErrorCode =
  | "PPT_OUTLINE_ORPHAN_CHILD"
  | "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED"
  | "PPT_OUTLINE_ABORTED";

export class PptOutlineRuntimeError extends Error {
  constructor(readonly code: PptOutlineRuntimeErrorCode) {
    super(code);
    this.name = "PptOutlineRuntimeError";
  }
}

export function countOutlinePages(paragraphs: readonly PptOutlineParagraph[]) {
  return paragraphs.reduce((count, paragraph) => (
    paragraph.level === 1 ? count + 1 : count
  ), 0);
}

export class PptOutlineRuntime {
  constructor(
    private readonly persistence: PptOutlinePersistence,
    private readonly adapters: PptOutlineAdapters = {},
  ) {}

  async saveOutline(input: PptOutlineSaveInput) {
    let hasPage = false;
    let hasPoint = false;
    let pageCount = 0;
    for (const paragraph of input.paragraphs) {
      if (paragraph.level === 1) {
        hasPage = true;
        hasPoint = false;
        pageCount += 1;
      } else if (paragraph.level === 2) {
        if (!hasPage) throw new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD");
        hasPoint = true;
      } else if (!hasPage || !hasPoint) {
        throw new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD");
      }
    }
    const saved = await this.persistence.save({ ...input, pageCount });
    return {
      ...saved,
      pageCount,
      paragraphs: input.paragraphs,
      publicSources: input.publicSources ?? [],
    } satisfies PptOutlineSnapshot;
  }

  async generateOutline(input: PptOutlineGenerateInput) {
    const generation = this.adapters.generation;
    const publicSources = this.adapters.publicSources;
    if (!generation || !publicSources) {
      throw new PptOutlineRuntimeError("PPT_OUTLINE_ADAPTER_NOT_CONFIGURED");
    }
    const signal = input.signal ?? new AbortController().signal;
    if (signal.aborted) throw new PptOutlineRuntimeError("PPT_OUTLINE_ABORTED");
    const researched = await publicSources.search({
      accountId: input.accountId,
      draftId: input.draftId,
      title: input.sources[0]?.title ?? "",
      author: input.sources[0]?.author ?? null,
    }, signal);
    const generated = await generation.createOutline({
      accountId: input.accountId,
      draftId: input.draftId,
      purpose: input.purpose,
      audience: input.audience,
      pageRange: input.pageRange,
      additionalRequirements: input.additionalRequirements,
      sources: input.sources,
      publicSources: researched,
    }, signal);
    return this.saveOutline({
      accountId: input.accountId,
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      paragraphs: generated.paragraphs,
      publicSources: researched,
    });
  }
}
