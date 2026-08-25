import { describe, expect, it } from "vitest";
import type { TextAnnotationApi } from "./text-annotation-state";
import { bookDetailPptIntentHref, bookPptIntentFromHash, bookPptIntentHashForStage, bookPptIntentTitleFromHash, createBookDetailModel } from "./book-detail-state";

const note = {
  id: "note-1",
  bookId: "book-1",
  body: "先把这一句留给下次回看。",
  source: null,
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function api(overrides: Partial<TextAnnotationApi> = {}): TextAnnotationApi {
  return {
    list: async () => ({ fileVersion: 2, highlights: [], notes: [note] }),
    createHighlight: async () => { throw new Error("NOT_USED"); },
    updateHighlight: async () => { throw new Error("NOT_USED"); },
    deleteHighlight: async () => { throw new Error("NOT_USED"); },
    createNote: async () => ({ status: "saved", note }),
    updateNote: async () => ({ status: "saved", note: { ...note, version: 2, body: "改过的正文。" } }),
    deleteNote: async () => ({ status: "deleted", id: note.id }),
    ...overrides,
  };
}

describe("private book detail notes state", () => {
  it("creates a recoverable book-scoped PPT handoff for the shared conversation route", () => {
    const href = bookDetailPptIntentHref("book/one");
    expect(href).toBe("#/conversation?stage=requirements&book=book%2Fone");
    expect(bookPptIntentHashForStage("book/one", "outline")).toBe("#/conversation?stage=outline&book=book%2Fone");
    expect(bookPptIntentFromHash(href)).toBe("book/one");
    const titledHref = bookDetailPptIntentHref("book/one", "真实书名");
    expect(bookPptIntentTitleFromHash(titledHref)).toBe("真实书名");
    expect(bookPptIntentFromHash("#/conversation?stage=requirements")).toBeNull();
  });

  it("switches from highlights to notes without stacking both panels", async () => {
    const model = createBookDetailModel("book-1", api());
    expect(model.snapshot.activeTab).toBe("highlights");
    model.setActiveTab("notes");
    expect(model.snapshot.activeTab).toBe("notes");
  });

  it("creates a titleless note, edits it, and deletes it through the real API contract", async () => {
    const model = createBookDetailModel("book-1", api());
    await model.load();
    model.beginCreate();
    model.setDraftBody("新的无标题记录。");
    await model.saveDraft();
    expect(model.snapshot.notes[0]?.body).toBe("先把这一句留给下次回看。");

    model.beginEdit(note);
    model.setDraftBody("改过的正文。");
    await model.saveDraft();
    expect(model.snapshot.notes[0]).toMatchObject({ body: "改过的正文。", version: 2 });

    await model.deleteNote(model.snapshot.notes[0]!);
    expect(model.snapshot.notes).toEqual([]);
  });

  it("retains an unsaved note body and source when create fails", async () => {
    const model = createBookDetailModel("book-1", api({
      createNote: async () => { throw new Error("NOTE_SAVE_FAILED"); },
    }));
    await model.load();
    model.beginCreate();
    model.setDraftBody("服务断开也不能丢掉这段。");
    await expect(model.saveDraft()).rejects.toThrow("NOTE_SAVE_FAILED");
    expect(model.snapshot).toMatchObject({
      draft: { body: "服务断开也不能丢掉这段。" },
      saveError: "笔记没有保存，内容已保留；请重试。",
    });
  });

  it("retries a failed create with the same idempotency key", async () => {
    const keys: string[] = [];
    let failed = true;
    const model = createBookDetailModel("book-1", api({
      createNote: async (input) => {
        keys.push(input.idempotencyKey);
        if (failed) {
          failed = false;
          throw new Error("NOTE_SAVE_FAILED");
        }
        return { status: "saved", note: { ...note, body: input.body } };
      },
    }));
    await model.load();
    model.beginCreate();
    model.setDraftBody("重试时不能重复创建。");
    await expect(model.saveDraft()).rejects.toThrow("NOTE_SAVE_FAILED");
    await model.retrySave();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("refreshes a stale note version and retries with the retained body", async () => {
    let listCalls = 0;
    let updateCalls = 0;
    const latest = { ...note, version: 2, body: "并发页先保存的正文。" };
    const model = createBookDetailModel("book-1", api({
      list: async () => {
        listCalls += 1;
        return { fileVersion: 2, highlights: [], notes: [listCalls > 1 ? latest : note] };
      },
      updateNote: async (_noteId, input) => {
        updateCalls += 1;
        if (updateCalls === 1) {
          const error = new Error("STALE_VERSION") as Error & { code: string };
          error.code = "STALE_VERSION";
          throw error;
        }
        expect(input.expectedVersion).toBe(2);
        return { status: "saved", note: { ...latest, body: input.body, version: 3 } };
      },
    }));
    await model.load();
    model.beginEdit(note);
    model.setDraftBody("我的冲突输入要留下。 ");
    await expect(model.saveDraft()).rejects.toThrow("STALE_VERSION");
    expect(model.snapshot).toMatchObject({
      notes: [latest],
      draft: { body: "我的冲突输入要留下。", expectedVersion: 2 },
    });
    await model.retrySave();
    expect(updateCalls).toBe(2);
    expect(model.snapshot.draft).toBeNull();
    expect(model.snapshot.notes[0]).toMatchObject({ body: "我的冲突输入要留下。", version: 3 });
  });
});
