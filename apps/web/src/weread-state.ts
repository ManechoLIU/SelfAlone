import type {
  WeReadAnnotation,
  WeReadAnnotationsSnapshotResponse,
  WeReadBooksSnapshotResponse,
  WeReadConnectionPutResponse,
  WeReadConnectionProjection,
  WeReadBookProjection,
  WeReadSyncRunProjection,
} from "@selfalone/contracts";

export type WeReadView = "overview" | "connection";
export type WeReadPhase = "idle" | "loading" | "saving" | "syncing" | "ready" | "failed";
export type WeReadOperation = "load" | "connect" | "books" | "annotations" | "disconnect" | null;

export type WeReadState = {
  view: WeReadView;
  phase: WeReadPhase;
  operation: WeReadOperation;
  connection: WeReadConnectionProjection | null;
  books: WeReadBookProjection[];
  annotations: Record<string, WeReadAnnotation[]>;
  selectedBookExternalId: string | null;
  draftApiKey: string;
  error: string;
  lastRun: WeReadSyncRunProjection | null;
  pendingBooksRequestId: string | null;
};

const blankState: WeReadState = {
  view: "overview",
  phase: "idle",
  operation: null,
  connection: null,
  books: [],
  annotations: {},
  selectedBookExternalId: null,
  draftApiKey: "",
  error: "",
  lastRun: null,
  pendingBooksRequestId: null,
};

type WeReadStateInput = Partial<WeReadState>;

export function createWeReadState(input: WeReadStateInput = {}): WeReadState {
  return {
    ...blankState,
    ...input,
    connection: input.connection ? { ...input.connection } : null,
    books: input.books?.map((book) => ({ ...book })) ?? [],
    annotations: Object.fromEntries(
      Object.entries(input.annotations ?? {}).map(([bookId, notes]) => [
        bookId,
        notes.map((note) => ({ ...note })),
      ]),
    ),
  };
}

function phaseForRun(run: WeReadSyncRunProjection): WeReadPhase {
  if (run.status === "queued" || run.status === "running") return "syncing";
  return run.status === "completed" ? "ready" : "failed";
}

function errorMessage(error: { code: string; message: string }) {
  if (error.code === "EXTERNAL_AUTH_REQUIRED") return "微信读书连接未完成，请检查 API Key 后重试。";
  if (error.code === "VALIDATION_FAILED") return "请检查微信读书连接信息后重试。";
  if (error.code === "CONFLICT" || error.code === "STALE_VERSION") return "连接信息已变化，请刷新后重试。";
  if (error.code === "EXTERNAL_SERVICE_FAILED") return `${error.message}，已保留上次成功同步的数据。`;
  return error.message || "微信读书暂时不可用，请稍后重试。";
}

export function weReadErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  return errorMessage({ code, message: code });
}

export function resolveWeReadConnection(
  state: WeReadState,
  response: WeReadConnectionPutResponse,
): WeReadState {
  return {
    ...state,
    phase: phaseForRun(response.sync.run),
    operation: "connect",
    connection: { ...response.connection },
    draftApiKey: "",
    error: "",
    lastRun: response.sync.run,
    pendingBooksRequestId: response.sync.run.requestId,
  };
}

export function applyWeReadBooksSnapshot(
  state: WeReadState,
  response: WeReadBooksSnapshotResponse,
): WeReadState {
  const snapshotError = response.status === "failed"
    ? errorMessage(response.error)
    : response.status === "paused"
      ? "微信读书同步已暂停，请稍后重试。"
      : "";
  const nextBooks = response.status === "success"
    ? response.books.map((book) => ({ ...book }))
    : state.books.map((book) => ({ ...book }));
  const nextAnnotations = response.status === "success" && response.books.length === 0
    ? {}
    : state.annotations;
  const nextSelectedBookExternalId = response.status === "success"
    && state.selectedBookExternalId
    && !response.books.some((book) => book.externalId === state.selectedBookExternalId)
    ? response.books[0]?.externalId ?? null
    : state.selectedBookExternalId;
  return {
    ...state,
    phase: response.status === "success" ? "ready" : "failed",
    operation: "books",
    books: nextBooks,
    annotations: nextAnnotations,
    selectedBookExternalId: nextSelectedBookExternalId,
    error: snapshotError,
  };
}

export function applyWeReadAnnotationsSnapshot(
  state: WeReadState,
  response: WeReadAnnotationsSnapshotResponse,
): WeReadState {
  if (response.status !== "success") {
    return {
      ...state,
      phase: "failed",
      operation: "annotations",
      error: response.status === "failed" ? errorMessage(response.error) : "微信读书同步已暂停，请稍后重试。",
    };
  }
  const notes = response.annotations.map((note) => ({ ...note }));
  return {
    ...state,
    phase: "ready",
    operation: "annotations",
    error: "",
    annotations: {
      ...state.annotations,
      [response.bookId]: notes,
      ...(response.bookId !== response.bookExternalId
        ? { [response.bookExternalId]: notes.map((note) => ({ ...note })) }
        : {}),
    },
  };
}

export function failWeReadOperation(state: WeReadState, error: unknown): WeReadState {
  return {
    ...state,
    phase: "failed",
    error: weReadErrorMessage(error),
  };
}

type PersistedWeReadState = {
  version: 1;
  view: WeReadView;
  phase: WeReadPhase;
  operation: WeReadOperation;
  connection: WeReadConnectionProjection | null;
  books: WeReadBookProjection[];
  annotations: Record<string, WeReadAnnotation[]>;
  selectedBookExternalId: string | null;
  error: string;
  lastRun: WeReadSyncRunProjection | null;
  pendingBooksRequestId: string | null;
};

export function serializeWeReadState(state: WeReadState) {
  const persisted: PersistedWeReadState = {
    version: 1,
    view: state.view,
    phase: state.phase,
    operation: state.operation,
    connection: state.connection ? { ...state.connection } : null,
    books: state.books.map((book) => ({ ...book })),
    annotations: Object.fromEntries(
      Object.entries(state.annotations).map(([bookId, notes]) => [bookId, notes.map((note) => ({ ...note }))]),
    ),
    selectedBookExternalId: state.selectedBookExternalId,
    error: state.error,
    lastRun: state.lastRun ? { ...state.lastRun } : null,
    pendingBooksRequestId: state.pendingBooksRequestId,
  };
  return JSON.stringify(persisted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseWeReadState(value: string | null): WeReadState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.books) || !isRecord(parsed.annotations)) return null;
    if (parsed.view !== "overview" && parsed.view !== "connection") return null;
    if (!["idle", "loading", "saving", "syncing", "ready", "failed"].includes(String(parsed.phase))) return null;
    const annotations: Record<string, WeReadAnnotation[]> = {};
    for (const [bookId, notes] of Object.entries(parsed.annotations)) {
      if (!Array.isArray(notes)) return null;
      annotations[bookId] = notes as WeReadAnnotation[];
    }
    return createWeReadState({
      view: parsed.view,
      phase: parsed.phase as WeReadPhase,
      operation: (parsed.operation as WeReadOperation | undefined) ?? null,
      connection: parsed.connection && isRecord(parsed.connection)
        ? parsed.connection as unknown as WeReadConnectionProjection
        : null,
      books: parsed.books as WeReadBookProjection[],
      annotations,
      selectedBookExternalId: typeof parsed.selectedBookExternalId === "string" ? parsed.selectedBookExternalId : null,
      error: typeof parsed.error === "string" ? parsed.error : "",
      lastRun: parsed.lastRun && isRecord(parsed.lastRun)
        ? parsed.lastRun as unknown as WeReadSyncRunProjection
        : null,
      pendingBooksRequestId: typeof parsed.pendingBooksRequestId === "string"
        ? parsed.pendingBooksRequestId
        : null,
      draftApiKey: "",
    });
  } catch {
    return null;
  }
}
