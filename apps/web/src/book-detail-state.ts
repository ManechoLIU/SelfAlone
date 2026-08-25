import type { TextAnnotationSource, TextHighlight, TextNote } from "@selfalone/contracts";
import { coverAssetForBook } from "./library-cover";
import type { TextAnnotationApi } from "./text-annotation-state";
import { createBookDetailPptRuntime, type BookDetailPptRuntime } from "./book-detail-runtime";

export type BookDetailDraft = {
  mode: "create" | "edit";
  body: string;
  source: TextAnnotationSource | null;
  noteId: string | null;
  expectedVersion: number | null;
  idempotencyKey: string | null;
};

export type BookDetailTab = "highlights" | "notes" | "ppt";

export type BookDetailPptWork = {
  id: string;
  title: string;
  status: "generating" | "completed";
  dateLabel?: string;
  downloadHref?: string;
  previewSrc?: string;
};

export type BookDetailPptState = "normal" | "loading" | "empty" | "filtered-empty" | "failed";

export type BookDetailSnapshot = {
  open: boolean;
  loading: boolean;
  error: string;
  title: string;
  author: string;
  sourceLabel?: string;
  description?: string;
  readingHref?: string;
  coverSrc?: string;
  pptHref?: string;
  fileVersion: number | null;
  activeTab: BookDetailTab;
  highlights: TextHighlight[];
  notes: TextNote[];
  pptWorks?: BookDetailPptWork[];
  pptState?: BookDetailPptState;
  pptQuery?: string;
  pptError?: string;
  draft: BookDetailDraft | null;
  saveError: string;
  deleteError: string;
};

export function bookPptIntentHashForStage(bookId: string, stage: string | null = "requirements", title?: string) {
  const query = new URLSearchParams();
  if (stage) query.set("stage", stage);
  query.set("book", bookId);
  if (title?.trim()) query.set("bookTitle", title.trim());
  return `#/conversation?${query.toString()}`;
}

export function bookDetailPptIntentHref(bookId: string, title?: string) {
  return bookPptIntentHashForStage(bookId, "requirements", title);
}

export function bookPptIntentFromHash(hash: string) {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return null;
  const bookId = new URLSearchParams(query).get("book");
  return bookId?.trim() ? bookId : null;
}

export function bookPptIntentTitleFromHash(hash: string) {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return null;
  const title = new URLSearchParams(query).get("bookTitle");
  return title?.trim() ? title : null;
}

function idempotencyKey() {
  const randomUuid = globalThis.crypto?.randomUUID;
  return randomUuid ? randomUuid.call(globalThis.crypto) : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isStaleVersionError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "STALE_VERSION" || code === "VERSION_CONFLICT" || code === "CONFLICT";
}

export function createBookDetailModel(
  bookId: string,
  api: TextAnnotationApi,
  book: { title?: string; author?: string | null; sourceLabel?: string; description?: string; coverSrc?: string; pptHref?: string } = {},
  pptRuntime?: BookDetailPptRuntime,
) {
  const resolvedPptRuntime = pptRuntime ?? (
    typeof window !== "undefined" && typeof fetch === "function"
      ? createBookDetailPptRuntime()
      : undefined
  );
  const refreshLatestNote = async (draft: BookDetailDraft) => {
    try {
      const list = await api.list();
      const latest = draft.noteId ? list.notes.find((note) => note.id === draft.noteId) : null;
      model.snapshot = {
        ...model.snapshot,
        fileVersion: list.fileVersion,
        highlights: list.highlights,
        notes: list.notes,
        ...(latest ? {
          draft: {
            ...(model.snapshot.draft ?? draft),
            source: latest.source,
            expectedVersion: latest.version,
          },
        } : {}),
      };
    } catch {
      // Keep the local draft and original conflict message when the refresh is unavailable.
    }
  };

  const model = {
    snapshot: {
      open: false,
      loading: true,
      error: "",
      title: book.title ?? "书籍详情",
      author: book.author?.trim() || "作者未知",
      sourceLabel: book.sourceLabel ?? "本地",
      description: book.description,
      readingHref: `#/reading/${encodeURIComponent(bookId)}`,
      coverSrc: book.coverSrc ?? coverAssetForBook(bookId),
      pptHref: book.pptHref ?? bookDetailPptIntentHref(bookId, book.title),
      fileVersion: null,
      activeTab: "highlights",
      highlights: [],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    } as BookDetailSnapshot,
    async load() {
      const previousPptWorks = model.snapshot.pptWorks ?? [];
      model.snapshot = { ...model.snapshot, loading: true, error: "" };
      if (resolvedPptRuntime) {
        model.snapshot = { ...model.snapshot, pptState: "loading", pptError: "" };
      }
      let annotationError: unknown;
      try {
        const list = await api.list();
        model.snapshot = {
          ...model.snapshot,
          loading: false,
          error: "",
          fileVersion: list.fileVersion,
          highlights: list.highlights,
          notes: list.notes,
        };
      } catch (error) {
        model.snapshot = { ...model.snapshot, loading: false, error: "书籍内容暂时没有载入，请重试。" };
        annotationError = error;
      }
      if (resolvedPptRuntime) {
        try {
          const ppt = await resolvedPptRuntime.load(bookId, previousPptWorks);
          model.snapshot = {
            ...model.snapshot,
            pptWorks: ppt.works,
            pptState: ppt.state,
            pptError: ppt.error ?? "",
          };
        } catch {
          model.snapshot = {
            ...model.snapshot,
            pptWorks: previousPptWorks,
            pptState: "failed",
            pptError: "PPT 作品暂时没有载入，请稍后重试。",
          };
        }
      }
      if (annotationError) {
        throw annotationError;
      }
    },
    setOpen(open: boolean) {
      model.snapshot = { ...model.snapshot, open };
    },
    setActiveTab(activeTab: BookDetailTab) {
      model.snapshot = { ...model.snapshot, activeTab };
    },
    beginCreate(source: TextAnnotationSource | null = null) {
      model.snapshot = {
        ...model.snapshot,
        activeTab: "notes",
        draft: { mode: "create", body: "", source, noteId: null, expectedVersion: null, idempotencyKey: idempotencyKey() },
        saveError: "",
      };
    },
    beginEdit(note: TextNote) {
      model.snapshot = {
        ...model.snapshot,
        activeTab: "notes",
        draft: {
          mode: "edit",
          body: note.body,
          source: note.source,
          noteId: note.id,
          expectedVersion: note.version,
          idempotencyKey: null,
        },
        saveError: "",
      };
    },
    setDraftBody(body: string) {
      if (!model.snapshot.draft) return;
      model.snapshot = { ...model.snapshot, draft: { ...model.snapshot.draft, body } };
    },
    cancelDraft() {
      model.snapshot = { ...model.snapshot, draft: null, saveError: "" };
    },
    async saveDraft() {
      const draft = model.snapshot.draft;
      if (!draft) return;
      const body = draft.body.trim();
      if (!body) {
        const error = new Error("NOTE_BODY_REQUIRED");
        model.snapshot = { ...model.snapshot, saveError: "写下内容后才能保存。" };
        throw error;
      }
      model.snapshot = { ...model.snapshot, saveError: "" };
      try {
        if (draft.mode === "create") {
          const result = await api.createNote({
            idempotencyKey: draft.idempotencyKey ?? idempotencyKey(),
            body,
            source: draft.source,
          });
          if (result.status !== "saved") throw new Error("NOTE_SAVE_FAILED");
          model.snapshot = {
            ...model.snapshot,
            notes: [result.note, ...model.snapshot.notes.filter((note) => note.id !== result.note.id)],
            draft: null,
            saveError: "",
          };
          return result.note;
        }
        if (!draft.noteId || draft.expectedVersion === null) throw new Error("NOTE_NOT_FOUND");
        const result = await api.updateNote(draft.noteId, {
          expectedVersion: draft.expectedVersion,
          body,
          source: draft.source,
        });
        if (result.status !== "saved") throw new Error("NOTE_SAVE_FAILED");
        model.snapshot = {
          ...model.snapshot,
          notes: model.snapshot.notes.map((note) => note.id === result.note.id ? result.note : note),
          draft: null,
          saveError: "",
        };
        return result.note;
      } catch (error) {
        let retainedDraft = { ...draft, body };
        if (draft.mode === "edit" && isStaleVersionError(error)) {
          await refreshLatestNote(draft);
          retainedDraft = { ...(model.snapshot.draft ?? retainedDraft), body };
        }
        model.snapshot = { ...model.snapshot, draft: retainedDraft, saveError: "笔记没有保存，内容已保留；请重试。" };
        throw error;
      }
    },
    async retrySave() {
      if (!model.snapshot.draft) return;
      return model.saveDraft();
    },
    async deleteNote(note: TextNote) {
      model.snapshot = { ...model.snapshot, deleteError: "" };
      try {
        const result = await api.deleteNote(note.id, { expectedVersion: note.version });
        if (result.status !== "deleted") throw new Error("NOTE_DELETE_FAILED");
        model.snapshot = {
          ...model.snapshot,
          notes: model.snapshot.notes.filter((item) => item.id !== result.id),
          deleteError: "",
        };
        return result;
      } catch (error) {
        model.snapshot = { ...model.snapshot, deleteError: "笔记没有删除，请重试。" };
        throw error;
      }
    },
  };
  void bookId;
  return model;
}

export type BookDetailModel = ReturnType<typeof createBookDetailModel>;
