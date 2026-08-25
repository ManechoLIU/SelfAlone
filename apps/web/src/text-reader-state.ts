import type {
  ReadingPosition,
  ReaderBackground,
  SaveTextPositionRequest,
  TextLocator,
  TextHighlight,
  TextReaderSection,
  TextReaderSections,
  TextReading,
} from "@selfalone/contracts";

export type {
  ReaderBackground,
  TextLocator,
  TextReaderSection,
  TextReading,
  TextHighlight,
} from "@selfalone/contracts";

export type PendingReaderSave = {
  locator: TextLocator;
  background: ReaderBackground;
};

export type TextReaderSnapshot = {
  loading: boolean;
  error: string;
  query: string;
  focusMode: boolean;
  directoryOpen: boolean;
  copied: boolean;
  background: ReaderBackground;
  reading: TextReading | null;
  sections: TextReaderSection[];
  pendingSave: PendingReaderSave | null;
  saveError: string;
  /** Persisted text highlights are supplied by the private annotation seam. */
  highlights?: TextHighlight[];
};

export type TextReaderApi = {
  loadReading(): Promise<TextReading>;
  loadSections(): Promise<TextReaderSections>;
  savePosition(input: SaveTextPositionRequest): Promise<ReadingPosition<TextLocator>>;
};

export const READER_SCROLL_SAVE_DELAY_MS = 280;
export const READER_RESTORE_GUARD_MS = 360;

export function textReaderViewState(snapshot: TextReaderSnapshot) {
  if (snapshot.loading && snapshot.sections.length === 0) return "loading";
  if (snapshot.error && snapshot.sections.length === 0) return "failure";
  if (snapshot.query.trim() && snapshot.sections.length === 0) return "filtered_empty";
  if (!snapshot.reading || snapshot.sections.length === 0) return "empty";
  return "normal";
}

export function filterTextReaderSections(sections: TextReaderSection[], query: string) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return sections;
  return sections.filter((section) => section.title.toLocaleLowerCase("zh-CN").includes(needle));
}

export function paragraphOffsets(text: string) {
  const paragraphs: Array<{ offset: number; text: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(/\n\s*\n/g)) {
    const end = match.index;
    const paragraph = text.slice(cursor, end).trim();
    if (paragraph) paragraphs.push({ offset: cursor, text: paragraph });
    cursor = end + match[0].length;
  }
  const paragraph = text.slice(cursor).trim();
  if (paragraph) paragraphs.push({ offset: cursor, text: paragraph });
  return paragraphs;
}

function comparableHeading(value: string) {
  return value.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
}

export function textReaderParagraphs(section: TextReaderSection) {
  const paragraphs = paragraphOffsets(section.text);
  if (!section.sectionId.startsWith("txt:")) return paragraphs;
  const first = paragraphs[0];
  if (!first) return paragraphs;
  const lineBreak = first.text.indexOf("\n");
  const firstLine = lineBreak < 0 ? first.text : first.text.slice(0, lineBreak);
  if (comparableHeading(firstLine) !== comparableHeading(section.title)) return paragraphs;
  if (lineBreak < 0) return paragraphs.slice(1);
  const remainder = first.text.slice(lineBreak + 1);
  const leading = remainder.length - remainder.trimStart().length;
  const text = remainder.trim();
  return text
    ? [{ offset: first.offset + lineBreak + 1 + leading, text }, ...paragraphs.slice(1)]
    : paragraphs.slice(1);
}

export function restoreParagraphOffset(
  paragraphs: Array<{ offset: number }>,
  locatorOffset: number,
) {
  if (locatorOffset <= 0) return null;
  return paragraphs.filter((paragraph) => paragraph.offset <= locatorOffset).at(-1)?.offset ?? null;
}

export function shouldPersistReaderScroll(input: {
  restoringPosition: boolean;
  hasVisibleLocator: boolean;
}) {
  return !input.restoringPosition && input.hasVisibleLocator;
}

function sameSave(left: PendingReaderSave | null, right: PendingReaderSave) {
  return left?.background === right.background
    && left.locator.fileVersion === right.locator.fileVersion
    && left.locator.sectionId === right.locator.sectionId
    && left.locator.offset === right.locator.offset;
}

export function createTextReaderModel(
  bookId: string,
  api: TextReaderApi,
  initialBackground: ReaderBackground = "light",
) {
  let saving: Promise<void> | null = null;
  const model = {
    snapshot: {
      loading: true,
      error: "",
      query: "",
      focusMode: false,
      directoryOpen: false,
      copied: false,
      background: initialBackground,
      reading: null,
      sections: [],
      pendingSave: null,
      saveError: "",
    } as TextReaderSnapshot,
    async load() {
      model.snapshot = { ...model.snapshot, loading: true, error: "" };
      try {
        const [reading, content] = await Promise.all([api.loadReading(), api.loadSections()]);
        if (reading.bookId !== bookId || reading.fileVersion !== content.fileVersion) {
          throw new Error("STALE_VERSION");
        }
        model.snapshot = {
          ...model.snapshot,
          loading: false,
          error: "",
          reading,
          background: reading.position?.background ?? "light",
          sections: content.sections,
          pendingSave: null,
          saveError: "",
        };
      } catch (error) {
        model.snapshot = {
          ...model.snapshot,
          loading: false,
          error: error instanceof Error && error.message === "STALE_VERSION"
            ? "书籍内容已经更新，请重新载入后继续阅读。"
            : "正文暂时没有载入，请保留当前页面后重试。",
        };
        throw error;
      }
    },
    async save(input: PendingReaderSave) {
      const reading = model.snapshot.reading;
      if (!reading || input.locator.fileVersion !== reading.fileVersion) throw new Error("STALE_VERSION");
      model.snapshot = {
        ...model.snapshot,
        pendingSave: input,
        saveError: "",
        reading: {
          ...reading,
          position: {
            locator: input.locator,
            background: input.background,
            version: reading.position?.version ?? 0,
          },
        },
        background: input.background,
      };
      if (!saving) {
        saving = flushSaves().finally(() => {
          saving = null;
        });
      }
      return saving;
    },
    async retrySave() {
      const pending = model.snapshot.pendingSave;
      if (!pending) return;
      return model.save(pending);
    },
  };

  async function flushSaves() {
    while (model.snapshot.pendingSave) {
      const pending = model.snapshot.pendingSave;
      const expectedVersion = model.snapshot.reading?.position?.version ?? 0;
      try {
        const saved = await api.savePosition({ ...pending, expectedVersion });
        const current = model.snapshot.reading;
        const pendingIsCurrent = sameSave(model.snapshot.pendingSave, pending);
        model.snapshot = {
          ...model.snapshot,
          pendingSave: pendingIsCurrent ? null : model.snapshot.pendingSave,
          saveError: "",
          reading: current
            ? {
                ...current,
                position: pendingIsCurrent
                  ? saved
                  : {
                      locator: current.position?.locator ?? saved.locator,
                      background: current.position?.background ?? saved.background,
                      version: saved.version,
                    },
              }
            : null,
        };
      } catch (error) {
        model.snapshot = {
          ...model.snapshot,
          saveError: "阅读位置没有保存，当前画面已保留；刷新后可能恢复上次选择。",
        };
        throw error;
      }
    }
  }

  return model;
}
