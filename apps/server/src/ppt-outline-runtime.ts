export type PptOutlineParagraph = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

export type PptOutlineSaveInput = {
  accountId: string;
  draftId: string;
  expectedVersion: number;
  paragraphs: PptOutlineParagraph[];
};

type PptOutlinePersistence = {
  save(input: PptOutlineSaveInput & { pageCount: number }): Promise<{ version: number }>;
};

export class PptOutlineRuntimeError extends Error {
  constructor(readonly code: "PPT_OUTLINE_ORPHAN_CHILD") {
    super(code);
    this.name = "PptOutlineRuntimeError";
  }
}

export class PptOutlineRuntime {
  constructor(private readonly persistence: PptOutlinePersistence) {}

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
    return { ...saved, pageCount, paragraphs: input.paragraphs };
  }
}
