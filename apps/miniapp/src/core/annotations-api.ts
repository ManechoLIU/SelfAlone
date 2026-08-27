export type TextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

export type TextAnnotationSource = {
  locator: TextLocator;
  endOffset: number;
  quote: string;
};

export type TextHighlight = TextAnnotationSource & {
  id: string;
  bookId: string;
  thought: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TextNote = {
  id: string;
  bookId: string;
  body: string;
  source: TextAnnotationSource | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TextAnnotationList = {
  fileVersion: number;
  highlights: TextHighlight[];
  notes: TextNote[];
};

export type CreateNoteInput = {
  idempotencyKey: string;
  body: string;
  source?: TextAnnotationSource | null;
};

export type UpdateNoteInput = {
  expectedVersion: number;
  body: string;
  source?: TextAnnotationSource | null;
};

export type DeleteNoteInput = {
  expectedVersion: number;
};

export type SavedNoteResult = {
  status: "saved";
  note: TextNote;
};

export type FailedNoteResult = {
  status: "failed";
  errorCode: string;
  retainedDraft?: {
    idempotencyKey?: string;
    body?: string;
    source?: TextAnnotationSource | null;
  };
  id?: string;
};

export type DeletedNoteResult = {
  status: "deleted";
  id: string;
};

export type NoteCreateResult = SavedNoteResult | FailedNoteResult;
export type NoteUpdateResult = SavedNoteResult | FailedNoteResult;
export type NoteDeleteResult = DeletedNoteResult | FailedNoteResult;

export type AnnotationHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type AnnotationHttpRequest = {
  url: string;
  method: AnnotationHttpMethod;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
};

export type AnnotationHttpResponse = {
  status: number;
  body: unknown;
};

export type AnnotationTransport = (
  request: AnnotationHttpRequest,
) => Promise<AnnotationHttpResponse>;

export type AnnotationsAuthSession = {
  kind: "authenticated";
  token: string;
  expiresAt?: number;
};

export type AnnotationsAuthProvider = () =>
  | AnnotationsAuthSession
  | { kind: "signed-out" | "development" }
  | null
  | undefined;

export type AnnotationsApiOptions = {
  /** Explicit API origin supplied by the host; no origin is inferred. */
  baseUrl?: string;
  /** Read the current Mini session immediately before every protected request. */
  authProvider?: AnnotationsAuthProvider;
  /** Clear the session after a protected request is rejected. */
  onUnauthorized?: (status: number) => void;
  transport?: AnnotationTransport;
};

export type AnnotationsApiClient = {
  getAnnotations(bookId: string): Promise<TextAnnotationList>;
  listAnnotations(bookId: string): Promise<TextAnnotationList>;
  createNote(bookId: string, input: CreateNoteInput): Promise<NoteCreateResult>;
  updateNote(bookId: string, noteId: string, input: UpdateNoteInput): Promise<NoteUpdateResult>;
  deleteNote(bookId: string, noteId: string, input: DeleteNoteInput): Promise<NoteDeleteResult>;
};

export class AnnotationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable = status === 0 || status >= 500,
  ) {
    super(code);
    this.name = "AnnotationsApiError";
  }
}

const annotationsPath = (bookId: string) => `/api/v1/books/${encodeURIComponent(bookId)}/annotations`;
const notesPath = (bookId: string, noteId?: string) =>
  `/api/v1/books/${encodeURIComponent(bookId)}/notes${noteId === undefined ? "" : `/${encodeURIComponent(noteId)}`}`;

/** Thin client for the frozen text annotations and notes routes. */
export function createAnnotationsApiClient(
  options: AnnotationsApiOptions = {},
): AnnotationsApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const transport = options.transport ?? createWxAnnotationsTransport();

  async function request<T>(
    path: string,
    method: AnnotationHttpMethod,
    body?: unknown,
    allowFailedResult = false,
  ): Promise<T> {
    if (!baseUrl) throw new AnnotationsApiError(0, "ANNOTATIONS_API_UNAVAILABLE", false);
    const authHeaders = currentAuthHeaders(options.authProvider);
    if (!authHeaders) throw new AnnotationsApiError(0, "ANNOTATIONS_API_UNAVAILABLE", false);

    let response: AnnotationHttpResponse;
    try {
      response = await transport({
        url: `${baseUrl}${path}`,
        method,
        headers: {
          ...authHeaders,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof AnnotationsApiError) throw error;
      throw new AnnotationsApiError(0, "ANNOTATIONS_NETWORK_FAILED", true);
    }

    if (response.status === 401) options.onUnauthorized?.(response.status);
    if (response.status >= 200 && response.status < 300) return response.body as T;
    if (allowFailedResult && isFailedResult(response.body)) return response.body as T;

    throw new AnnotationsApiError(
      response.status,
      responseCode(response.body),
      response.status === 0 || response.status >= 500,
    );
  }

  const getAnnotations = (bookId: string) =>
    request<TextAnnotationList>(annotationsPath(bookId), "GET");

  const createNote = (bookId: string, input: CreateNoteInput) =>
    request<NoteCreateResult>(notesPath(bookId), "POST", input, true);

  const updateNote = (bookId: string, noteId: string, input: UpdateNoteInput) =>
    request<NoteUpdateResult>(notesPath(bookId, noteId), "PUT", input, true);

  const deleteNote = (bookId: string, noteId: string, input: DeleteNoteInput) =>
    request<NoteDeleteResult>(notesPath(bookId, noteId), "DELETE", input, true);

  return {
    getAnnotations,
    listAnnotations: getAnnotations,
    createNote,
    updateNote,
    deleteNote,
  };
}

export function createWxAnnotationsTransport(): AnnotationTransport {
  return (request) => new Promise((resolve, reject) => {
    wx.request({
      url: request.url,
      method: request.method,
      header: { ...request.headers },
      ...(request.body === undefined ? {} : { data: request.body }),
      success: (response) => resolve({ status: response.statusCode, body: response.data }),
      fail: () => reject(new AnnotationsApiError(0, "ANNOTATIONS_NETWORK_FAILED", true)),
    });
  });
}

function normalizeBaseUrl(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.replace(/\/+$/, "");
}

function currentAuthHeaders(
  provider: AnnotationsAuthProvider | undefined,
): Readonly<Record<string, string>> | null {
  if (!provider) return null;
  let session: ReturnType<AnnotationsAuthProvider>;
  try {
    session = provider();
  } catch {
    return null;
  }
  if (!session || session.kind !== "authenticated") return null;
  const token = session.token.trim();
  if (!token) return null;
  if (
    session.expiresAt !== undefined
    && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now())
  ) return null;
  return { Authorization: `Bearer ${token}` };
}

function isFailedResult(value: unknown): value is FailedNoteResult {
  return Boolean(
    value
      && typeof value === "object"
      && (value as { status?: unknown }).status === "failed",
  );
}

function responseCode(value: unknown): string {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "ANNOTATIONS_REQUEST_FAILED";
}

// Compatibility aliases keep the adapter's domain name explicit at call sites
// while allowing future text-only clients to reuse the same transport contract.
export type TextAnnotationsApiClient = AnnotationsApiClient;
export type TextAnnotationApiClient = AnnotationsApiClient;
export const createTextAnnotationsApiClient = createAnnotationsApiClient;
export const createTextAnnotationApiClient = createAnnotationsApiClient;
