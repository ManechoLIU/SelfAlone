import type {
  CreateTextHighlightRequest,
  CreateTextNoteRequest,
  DeleteTextAnnotationRequest,
  DeletedTextAnnotationResponse,
  SavedTextHighlightResponse,
  SavedTextNoteResponse,
  TextAnnotationList,
  TextAnnotationSource,
  TextHighlight,
  TextNote,
  TextLocator,
  UpdateTextHighlightRequest,
  UpdateTextNoteRequest,
} from "@selfalone/contracts";

export type AnnotationRectangle = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export type TextAnnotationSelection = {
  source: TextAnnotationSource;
  rect: AnnotationRectangle;
  avoidRects?: AnnotationRectangle[];
};

export type TextAnnotationApi = {
  list(): Promise<TextAnnotationList>;
  createHighlight(input: CreateTextHighlightRequest): Promise<SavedTextHighlightResponse>;
  updateHighlight(highlightId: string, input: UpdateTextHighlightRequest): Promise<SavedTextHighlightResponse>;
  deleteHighlight(highlightId: string, input: DeleteTextAnnotationRequest): Promise<DeletedTextAnnotationResponse>;
  createNote(input: CreateTextNoteRequest): Promise<SavedTextNoteResponse>;
  updateNote(noteId: string, input: UpdateTextNoteRequest): Promise<SavedTextNoteResponse>;
  deleteNote(noteId: string, input: DeleteTextAnnotationRequest): Promise<DeletedTextAnnotationResponse>;
};

export type TextAnnotationViewState = "loading" | "failure" | "empty" | "normal";

export type TextAnnotationComposer = {
  mode: "thought";
  body: string;
  source: TextAnnotationSource;
};

export type PendingHighlightSave = {
  kind: "highlight";
  idempotencyKey: string;
  source: TextAnnotationSource;
  thought: string | null;
};

export type TextAnnotationSnapshot = {
  loading: boolean;
  error: string;
  fileVersion: number | null;
  highlights: TextHighlight[];
  notes: TextNote[];
  selection: TextAnnotationSelection | null;
  composer: TextAnnotationComposer | null;
  pending: PendingHighlightSave | null;
  saveError: string;
};

export function textAnnotationViewState(
  snapshot: Pick<TextAnnotationSnapshot, "loading" | "error" | "fileVersion" | "highlights" | "notes">,
): TextAnnotationViewState {
  if (snapshot.loading && snapshot.fileVersion === null) return "loading";
  if (snapshot.error && snapshot.fileVersion === null) return "failure";
  if (snapshot.fileVersion === null) return "empty";
  if (snapshot.highlights.length === 0 && snapshot.notes.length === 0) return "empty";
  return "normal";
}

export function createTextAnnotationSourceFromOffsets(input: {
  section: { sectionId: string; fileVersion: number; text: string };
  startOffset: number;
  endOffset: number;
}): TextAnnotationSource {
  const { section, startOffset, endOffset } = input;
  if (
    !Number.isSafeInteger(startOffset)
    || !Number.isSafeInteger(endOffset)
    || startOffset < 0
    || endOffset <= startOffset
    || endOffset > section.text.length
  ) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
  return {
    locator: {
      kind: "text",
      fileVersion: section.fileVersion,
      sectionId: section.sectionId,
      offset: startOffset,
    },
    endOffset,
    quote: section.text.slice(startOffset, endOffset),
  };
}

export function selectionToolbarPosition(
  rect: AnnotationRectangle,
  viewport: { width: number; height: number },
  avoidRects: AnnotationRectangle[] = [],
) {
  const toolbarWidth = 252;
  const toolbarHeight = 44;
  const gap = 12;
  const left = Math.max(8, Math.min(rect.left, viewport.width - toolbarWidth - 8));
  const above = rect.top - toolbarHeight - gap;
  const below = Math.min(viewport.height - toolbarHeight - 8, rect.bottom + gap);
  const candidate = (top: number) => ({ left, top, right: left + toolbarWidth, bottom: top + toolbarHeight });
  const overlaps = (candidateRect: ReturnType<typeof candidate>, other: AnnotationRectangle) => (
    candidateRect.left < other.right
    && candidateRect.right > other.left
    && candidateRect.top < other.bottom
    && candidateRect.bottom > other.top
  );
  if (above >= 8 && !avoidRects.some((other) => overlaps(candidate(above), other))) {
    return { left, top: above, placement: "above" as const };
  }
  if (below >= 8 && !avoidRects.some((other) => overlaps(candidate(below), other))) {
    return {
      left,
      top: below,
      placement: "below" as const,
    };
  }
  if (above >= 8) return { left, top: above, placement: "above" as const };
  return {
    left,
    top: below,
    placement: "below" as const,
  };
}

function createIdempotencyKey() {
  const randomUuid = globalThis.crypto?.randomUUID;
  return randomUuid ? randomUuid.call(globalThis.crypto) : `highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTextAnnotationModel(bookId: string, api: TextAnnotationApi) {
  let saveInFlight = false;
  const model = {
    snapshot: {
      loading: true,
      error: "",
      fileVersion: null,
      highlights: [],
      notes: [],
      selection: null,
      composer: null,
      pending: null,
      saveError: "",
    } as TextAnnotationSnapshot,
    async load() {
      model.snapshot = { ...model.snapshot, loading: true, error: "" };
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
        model.snapshot = {
          ...model.snapshot,
          loading: false,
          error: "划线与笔记暂时没有载入，请保留正文后重试。",
        };
        throw error;
      }
    },
    setSelection(selection: TextAnnotationSelection | null) {
      model.snapshot = { ...model.snapshot, selection, composer: null, saveError: "" };
    },
    beginThought() {
      const selection = model.snapshot.selection;
      if (!selection) return;
      model.snapshot = {
        ...model.snapshot,
        composer: { mode: "thought", body: "", source: selection.source },
        saveError: "",
      };
    },
    setComposerBody(body: string) {
      if (!model.snapshot.composer) return;
      model.snapshot = {
        ...model.snapshot,
        composer: { ...model.snapshot.composer, body },
      };
    },
    async saveSelection() {
      if (saveInFlight) return;
      const selection = model.snapshot.selection;
      if (!selection) throw new Error("SELECTION_REQUIRED");
      saveInFlight = true;
      const thought = model.snapshot.composer?.source === selection.source
        ? model.snapshot.composer.body.trim() || null
        : null;
      const pending: PendingHighlightSave = {
        kind: "highlight",
        idempotencyKey: model.snapshot.pending?.idempotencyKey ?? createIdempotencyKey(),
        source: selection.source,
        thought,
      };
      model.snapshot = { ...model.snapshot, pending, saveError: "" };
      try {
        const result = await api.createHighlight({
          idempotencyKey: pending.idempotencyKey,
          locator: pending.source.locator,
          endOffset: pending.source.endOffset,
          quote: pending.source.quote,
          thought: pending.thought,
        });
        if (result.status !== "saved") throw new Error("HIGHLIGHT_SAVE_FAILED");
        model.snapshot = {
          ...model.snapshot,
          highlights: [result.highlight, ...model.snapshot.highlights.filter((item) => item.id !== result.highlight.id)],
          pending: null,
          composer: null,
          saveError: "",
        };
        return result;
      } catch (error) {
        model.snapshot = {
          ...model.snapshot,
          pending,
          saveError: "划线没有保存，当前选区已保留；请重试。",
        };
        throw error;
      } finally {
        saveInFlight = false;
      }
    },
    async retrySave() {
      if (!model.snapshot.pending) return;
      return model.saveSelection();
    },
  };

  void bookId;
  return model;
}

export type TextAnnotationModel = ReturnType<typeof createTextAnnotationModel>;

export function sameTextAnnotationSource(left: TextAnnotationSource | null, right: TextAnnotationSource | null) {
  if (!left || !right) return left === right;
  return left.locator.fileVersion === right.locator.fileVersion
    && left.locator.sectionId === right.locator.sectionId
    && left.locator.offset === right.locator.offset
    && left.endOffset === right.endOffset
    && left.quote === right.quote;
}

export function textLocatorFromSelection(selection: TextAnnotationSelection): TextLocator {
  return selection.source.locator;
}
