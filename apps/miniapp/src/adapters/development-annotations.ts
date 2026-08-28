import type {
  AnnotationsApiClient,
  CreateNoteInput,
  DeleteNoteInput,
  NoteCreateResult,
  NoteDeleteResult,
  NoteUpdateResult,
  TextAnnotationList,
  TextNote,
  UpdateNoteInput,
} from "../core/annotations-api";

export const DEVELOPMENT_NOTE_RETRY_DELAY_MS = 900;

export type DevelopmentAnnotationsOptions = {
  retryDelayMs?: number;
};

type DevelopmentBookNotes = {
  notes: TextNote[];
  deleteAttempts: Set<string>;
  pendingDeletes: Map<string, Promise<NoteDeleteResult>>;
  idempotentCreates: Map<string, TextNote>;
  nextCreatedNote: number;
};

function noteSource(quote: string, sectionId: string) {
  return {
    locator: {
      kind: "text" as const,
      fileVersion: 1,
      sectionId,
      offset: 0,
    },
    endOffset: quote.length,
    quote,
  };
}

function seedNotes(bookId: string): TextNote[] {
  return [
    {
      id: `dev-note-${bookId}-primary`,
      bookId,
      body: "把重要片段留在自己的语境里，回读时还能继续思考。",
      source: noteSource("把阅读中的发现留给自己。", "dev-section-1"),
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    },
    {
      id: `dev-note-${bookId}-follow-up`,
      bookId,
      body: "读完这一段，我想把问题带回今天的选择。",
      source: noteSource("留下一个可以继续追问的问题。", "dev-section-2"),
      version: 1,
      createdAt: "2030-01-02T00:00:00.000Z",
      updatedAt: "2030-01-02T00:00:00.000Z",
    },
  ];
}

function cloneNote(note: TextNote): TextNote {
  return {
    ...note,
    source: note.source
      ? {
        ...note.source,
        locator: { ...note.source.locator },
      }
      : null,
  };
}

function cloneList(state: DevelopmentBookNotes): TextAnnotationList {
  return {
    fileVersion: 1,
    highlights: [],
    notes: state.notes.map(cloneNote),
  };
}

function normalizeRetryDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEVELOPMENT_NOTE_RETRY_DELAY_MS;
  return Math.max(0, Math.floor(value ?? DEVELOPMENT_NOTE_RETRY_DELAY_MS));
}

function failedResult(errorCode: string, id?: string): NoteDeleteResult {
  return {
    status: "failed",
    errorCode,
    ...(id ? { id } : {}),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Deterministic, in-memory notes behavior for the explicit Mini development
 * runtime. It implements the production AnnotationsApiClient port so reader
 * hydration and mutation handlers remain shared with the real API path.
 */
export function createDevelopmentAnnotationsClient(
  options: DevelopmentAnnotationsOptions = {},
): AnnotationsApiClient {
  const retryDelayMs = normalizeRetryDelay(options.retryDelayMs);
  const books = new Map<string, DevelopmentBookNotes>();

  const stateFor = (bookId: string): DevelopmentBookNotes => {
    let state = books.get(bookId);
    if (!state) {
      state = {
        notes: seedNotes(bookId),
        deleteAttempts: new Set(),
        pendingDeletes: new Map(),
        idempotentCreates: new Map(),
        nextCreatedNote: 1,
      };
      books.set(bookId, state);
    }
    return state;
  };

  const getAnnotations = async (bookId: string): Promise<TextAnnotationList> => cloneList(stateFor(bookId));

  const createNote = async (bookId: string, input: CreateNoteInput): Promise<NoteCreateResult> => {
    const state = stateFor(bookId);
    const existing = state.idempotentCreates.get(input.idempotencyKey);
    if (existing) return { status: "saved", note: cloneNote(existing) };

    const now = "2030-01-03T00:00:00.000Z";
    const note: TextNote = {
      id: `dev-note-${bookId}-created-${state.nextCreatedNote}`,
      bookId,
      body: input.body,
      source: input.source ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.nextCreatedNote += 1;
    state.idempotentCreates.set(input.idempotencyKey, note);
    state.notes.push(note);
    return { status: "saved", note: cloneNote(note) };
  };

  const updateNote = async (
    bookId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<NoteUpdateResult> => {
    const state = stateFor(bookId);
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return {
        status: "failed",
        errorCode: "NOTE_NOT_FOUND",
        id: noteId,
      };
    }
    if (note.version !== input.expectedVersion) {
      return {
        status: "failed",
        errorCode: "STALE_VERSION",
        id: noteId,
      };
    }
    note.body = input.body;
    note.source = input.source ?? null;
    note.version += 1;
    note.updatedAt = "2030-01-03T00:00:00.000Z";
    return { status: "saved", note: cloneNote(note) };
  };

  const deleteNote = async (
    bookId: string,
    noteId: string,
    _input: DeleteNoteInput,
  ): Promise<NoteDeleteResult> => {
    const state = stateFor(bookId);
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (!note) return failedResult("NOTE_NOT_FOUND", noteId);

    const pending = state.pendingDeletes.get(noteId);
    if (pending) return pending;

    if (!state.deleteAttempts.has(noteId)) {
      state.deleteAttempts.add(noteId);
      return failedResult("DEVELOPMENT_NOTE_DELETE_FAILED", noteId);
    }

    const operation = (async (): Promise<NoteDeleteResult> => {
      await delay(retryDelayMs);
      const index = state.notes.findIndex((candidate) => candidate.id === noteId);
      if (index < 0) return failedResult("NOTE_NOT_FOUND", noteId);
      state.notes.splice(index, 1);
      return { status: "deleted", id: noteId };
    })();
    state.pendingDeletes.set(noteId, operation);
    try {
      return await operation;
    } finally {
      state.pendingDeletes.delete(noteId);
    }
  };

  return {
    getAnnotations,
    listAnnotations: getAnnotations,
    createNote,
    updateNote,
    deleteNote,
  };
}
