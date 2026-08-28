export type BookSummary = {
  id: string;
  title: string;
  author?: string;
  source: "local" | "weread";
  sourceLabel: string;
  format: "epub" | "txt" | "pdf" | "weread";
  progress: number;
  coverUrl?: string;
  coverVariant: number;
  parseStatus?: "processing" | "ready_text" | "ready_pages" | "failed";
  errorCode?: string;
  sectionCount?: number;
  pageCount?: number;
  createdAt?: string;
};

export type LibraryState = {
  phase: "loading" | "ready" | "failed";
  books: BookSummary[];
  query: string;
  /** True when the server has already applied query filtering. */
  queryApplied?: boolean;
  error?: string;
};

export type LibraryPresentation =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "filtered-empty" }
  | { kind: "failed"; message: string }
  | { kind: "content"; books: BookSummary[] };

export function presentLibrary(state: LibraryState): LibraryPresentation {
  if (state.phase === "loading") return { kind: "loading" };
  if (state.phase === "failed") return { kind: "failed", message: state.error ?? "书架加载失败" };
  const query = state.query.trim().toLocaleLowerCase();
  if (!query) return state.books.length ? { kind: "content", books: state.books } : { kind: "empty" };
  if (state.queryApplied) return state.books.length ? { kind: "content", books: state.books } : { kind: "filtered-empty" };
  const books = state.books.filter((book) =>
    [book.title, book.author ?? "", book.sourceLabel]
      .some((value) => value.toLocaleLowerCase().includes(query))
  );
  return books.length ? { kind: "content", books } : { kind: "filtered-empty" };
}

export function preserveLibraryOnFailure(
  state: Pick<LibraryState, "books" | "query">
    & Partial<Pick<LibraryState, "queryApplied">>,
  message: string,
) {
  return state.books.length
    ? { phase: "ready" as const, ...state, notice: message }
    : { phase: "failed" as const, ...state, error: message };
}
