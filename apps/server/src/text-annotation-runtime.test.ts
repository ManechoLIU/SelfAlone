import { describe, expect, it } from "vitest";
import {
  TextAnnotationService,
  type TextAnnotationRepository,
  type TextAnnotationSource,
  type TextHighlightRecord,
  type TextNoteRecord,
} from "./text-annotation-runtime";

const locator = {
  kind: "text" as const,
  fileVersion: 2,
  sectionId: "txt:00000000",
  offset: 3,
};

function repository(overrides: Partial<TextAnnotationRepository> = {}): TextAnnotationRepository {
  const highlight: TextHighlightRecord = {
    id: "highlight-1",
    bookId: "book-1",
    locator,
    endOffset: 7,
    quote: "灯塔亮了",
    thought: "先记下来",
    version: 1,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  const note: TextNoteRecord = {
    id: "note-1",
    bookId: "book-1",
    body: "潮水退去后，路才显出来。",
    source: null,
    version: 1,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  return {
    getCurrentTextBook: async () => ({ fileVersion: 2 }),
    getTextSection: async () => ({ sectionId: "txt:00000000", text: "序章\n灯塔亮了，海面开始退潮。" }),
    listHighlights: async () => [highlight],
    listNotes: async () => [note],
    getNote: async () => note,
    createHighlight: async () => highlight,
    updateHighlight: async () => ({ ...highlight, version: 2, thought: "改过了" }),
    deleteHighlight: async () => true,
    createNote: async () => note,
    updateNote: async () => ({ ...note, version: 2, body: "改过的记录" }),
    deleteNote: async () => true,
    ...overrides,
  };
}

describe("text annotation service", () => {
  it("lists only the current text file version and saves a precise highlight with a thought", async () => {
    const service = new TextAnnotationService(repository({
      createHighlight: async (input) => ({ ...highlightFixture(), ...input.draft }),
    }));

    await expect(service.list("account-a", "book-1")).resolves.toEqual({
      fileVersion: 2,
      highlights: [expect.objectContaining({ locator: expect.objectContaining({ fileVersion: 2 }) })],
      notes: [expect.objectContaining({ id: "note-1" })],
    });
    const saved = await service.createHighlight("account-a", "book-1", {
      idempotencyKey: "highlight-1",
      locator,
      endOffset: 7,
      thought: "这句值得回看。",
    });
    expect(saved).toMatchObject({
      status: "saved",
      highlight: { quote: "灯塔亮了", thought: "这句值得回看。" },
    });
  });

  it("filters stale source records even when a repository returns historical rows", async () => {
    const currentHighlight = highlightFixture();
    const oldHighlight = { ...currentHighlight, id: "old-highlight", locator: { ...locator, fileVersion: 1 } };
    const currentNote: TextNoteRecord = {
      id: "current-note",
      bookId: "book-1",
      body: "当前记录",
      source: null,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const oldNote = {
      ...currentNote,
      id: "old-note",
      source: {
        locator: { ...locator, fileVersion: 1 },
        endOffset: 7,
        quote: "灯塔亮了",
      },
    };
    const service = new TextAnnotationService(repository({
      listHighlights: async () => [currentHighlight, oldHighlight],
      listNotes: async () => [currentNote, oldNote],
    }));

    await expect(service.list("account-a", "book-1")).resolves.toEqual({
      fileVersion: 2,
      highlights: [currentHighlight],
      notes: [currentNote],
    });
  });

  it("retains a note draft when persistence fails, but still exposes version conflicts", async () => {
    const service = new TextAnnotationService(repository({
      createNote: async () => { throw new Error("DB_OFFLINE"); },
      updateNote: async () => "stale",
    }));

    await expect(service.createNote("account-a", "book-1", {
      idempotencyKey: "note-1",
      body: "不能丢掉的草稿",
    })).resolves.toEqual({
      status: "failed",
      errorCode: "NOTE_SAVE_FAILED",
      retainedDraft: { idempotencyKey: "note-1", body: "不能丢掉的草稿", source: null },
    });
    await expect(service.updateNote("account-a", "book-1", "note-1", {
      expectedVersion: 1,
      body: "并发编辑",
    })).rejects.toThrow("STALE_VERSION");
  });

  it("rejects a locator from an old file version before writing", async () => {
    const create = async () => {
      throw new Error("SHOULD_NOT_WRITE");
    };
    const service = new TextAnnotationService(repository({ createHighlight: create }));

    await expect(service.createHighlight("account-a", "book-1", {
      idempotencyKey: "stale-highlight",
      locator: { ...locator, fileVersion: 1 },
      endOffset: 7,
    })).rejects.toThrow("STALE_VERSION");
  });

  it("retains the original source when an anchored note update fails", async () => {
    const source: TextAnnotationSource = {
      locator,
      endOffset: 7,
      quote: "灯塔亮了",
    };
    const service = new TextAnnotationService(repository({
      getNote: async () => ({
        id: "note-1",
        bookId: "book-1",
        body: "原来的引用笔记",
        source,
        version: 1,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }),
      updateNote: async () => { throw new Error("DB_OFFLINE"); },
    }));
    const input = {
      expectedVersion: 1,
      body: "引用笔记的新正文",
    };

    await expect(service.updateNote("account-a", "book-1", "note-1", input)).resolves.toEqual({
      status: "failed",
      errorCode: "NOTE_SAVE_FAILED",
      retainedDraft: { body: "引用笔记的新正文", source },
    });
  });

  it("fails closed when the existing note source cannot be verified", async () => {
    const source: TextAnnotationSource = {
      locator,
      endOffset: 7,
      quote: "灯塔亮了",
    };
    const service = new TextAnnotationService(repository({
      getNote: async () => { throw new Error("DB_OFFLINE"); },
      updateNote: async () => { throw new Error("SHOULD_NOT_WRITE"); },
    }));

    await expect(service.updateNote("account-a", "book-1", "note-1", {
      expectedVersion: 1,
      body: "客户端带来的未验证引用",
      source,
    })).resolves.toEqual({
      status: "failed",
      errorCode: "NOTE_SOURCE_UNVERIFIED",
      retainedDraft: { body: "客户端带来的未验证引用", source: null },
    });
  });
});

function highlightFixture(): TextHighlightRecord {
  return {
    id: "highlight-1",
    bookId: "book-1",
    locator,
    endOffset: 7,
    quote: "灯塔亮了",
    thought: "先记下来",
    version: 1,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}
