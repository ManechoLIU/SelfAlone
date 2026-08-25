import type { BookDetailPptState, BookDetailPptWork } from "./book-detail-state";

type PresentationWorkRecord = {
  id?: unknown;
  bookId?: unknown;
  title?: unknown;
  status?: unknown;
  artifactId?: unknown;
  error?: unknown;
};

type PresentationSnapshotRecord = {
  book?: { id?: unknown; title?: unknown };
  state?: unknown;
  current?: PresentationWorkRecord | null;
  history: PresentationWorkRecord[];
};

export type BookDetailPptRuntimeSnapshot = {
  state: BookDetailPptState;
  works: BookDetailPptWork[];
  error?: string;
};

export type BookDetailPptRuntime = {
  load(bookId: string, previousWorks?: BookDetailPptWork[]): Promise<BookDetailPptRuntimeSnapshot>;
};

type BookDetailPptRuntimeOptions = {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  presentationBaseHref?: string;
};

const defaultPresentationBaseHref = "/api/v1/books";
const fallbackPptError = "PPT 作品暂时没有载入，请稍后重试。";

function failedSnapshot(previousWorks: BookDetailPptWork[], error?: unknown): BookDetailPptRuntimeSnapshot {
  const message = typeof error === "string" && error.trim() ? error : fallbackPptError;
  return { state: "failed", works: previousWorks, error: message };
}

function presentationUrl(baseHref: string, bookId: string) {
  return `${baseHref.replace(/\/+$/, "")}/${encodeURIComponent(bookId)}/presentation`;
}

function validWorkStatus(value: unknown): value is "generating" | "completed" | "failed" {
  return value === "generating" || value === "completed" || value === "failed";
}

function toWork(record: PresentationWorkRecord, bookId: string, bookTitle: string): BookDetailPptWork | null {
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const recordBookId = typeof record.bookId === "string" ? record.bookId : null;
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : `《${bookTitle}》读书分享`;
  if (!id || !recordBookId || recordBookId !== bookId || !validWorkStatus(record.status)) return null;
  if (record.status === "failed") return null;
  const artifactId = typeof record.artifactId === "string" && record.artifactId.trim()
    ? record.artifactId.trim()
    : null;
  return {
    id,
    title,
    status: record.status,
    ...(record.status === "completed" && artifactId
      ? { downloadHref: `/api/v1/ppt-artifacts/${encodeURIComponent(artifactId)}/download` }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresentationSnapshot(value: unknown): value is PresentationSnapshotRecord {
  if (!isRecord(value)) return false;
  return Array.isArray(value.history);
}

export function createBookDetailPptRuntime(options: BookDetailPptRuntimeOptions = {}): BookDetailPptRuntime {
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  const baseHref = options.presentationBaseHref ?? defaultPresentationBaseHref;
  if (!fetcher) {
    return {
      async load(_bookId, previousWorks = []) {
        return failedSnapshot(previousWorks);
      },
    };
  }

  return {
    async load(bookId, previousWorks = []) {
      try {
        const response = await fetcher(presentationUrl(baseHref, bookId));
        if (!response.ok) return failedSnapshot(previousWorks);
        const payload = await response.json() as unknown;
        if (!isPresentationSnapshot(payload)) return failedSnapshot(previousWorks);

        const responseBookId = typeof payload.book?.id === "string" ? payload.book.id : "";
        const responseBookTitle = typeof payload.book?.title === "string" ? payload.book.title.trim() : "";
        if (!responseBookId || responseBookId !== bookId || !responseBookTitle) {
          return { state: "empty", works: [] };
        }

        const historyWorks = payload.history
          .map((work) => toWork(work, bookId, responseBookTitle))
          .filter((work): work is BookDetailPptWork => work !== null);
        const current = payload.current
          ? toWork(payload.current, bookId, responseBookTitle)
          : null;

        if (payload.state === "failed") {
          const error = payload.current && typeof payload.current.error === "string"
            ? payload.current.error
            : undefined;
          return failedSnapshot(historyWorks.length ? historyWorks : previousWorks, error);
        }
        if (payload.state === "empty") return { state: "empty", works: [] };
        if (payload.state !== "normal" || !current) return failedSnapshot(previousWorks);
        return { state: "normal", works: [current, ...historyWorks] };
      } catch {
        return failedSnapshot(previousWorks);
      }
    },
  };
}
