import type { BookParseStatus, LibraryBookSummary } from "@selfalone/contracts";

export type LibraryLoadState = {
  loading: boolean;
  searching: boolean;
  error: string;
  searchError: string;
  query: string;
  draftQuery: string;
  books: LibraryBookSummary[];
  unfilteredBooks: LibraryBookSummary[];
};

type SearchEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

type SearchInputTarget = SearchEventTarget & {
  value: string;
};

export function bindLibrarySearchInteractions(options: {
  form: SearchEventTarget;
  input: SearchInputTarget;
  debounceMs?: number;
  onQueryChange?: (query: string) => void;
  onSearch: (query: string) => void;
}) {
  const debounceMs = options.debounceMs ?? 300;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearDebounce = () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = undefined;
  };
  const normalizedQuery = () => options.input.value.trim();
  const searchNow = () => {
    clearDebounce();
    options.onQueryChange?.(options.input.value);
    options.onSearch(normalizedQuery());
  };
  const onInput = () => {
    clearDebounce();
    options.onQueryChange?.(options.input.value);
    debounceTimer = setTimeout(searchNow, debounceMs);
  };
  const onSubmit = (event: Event) => {
    event.preventDefault();
    searchNow();
  };
  const onNativeSearch = () => {
    if (options.input.value === "") searchNow();
  };
  const onKeydown = (event: Event) => {
    if ((event as Event & { key?: string }).key !== "Escape") return;
    event.preventDefault();
    options.input.value = "";
    searchNow();
  };

  options.input.addEventListener("input", onInput);
  options.form.addEventListener("submit", onSubmit);
  options.input.addEventListener("search", onNativeSearch);
  options.input.addEventListener("keydown", onKeydown);

  return () => {
    clearDebounce();
    options.input.removeEventListener("input", onInput);
    options.form.removeEventListener("submit", onSubmit);
    options.input.removeEventListener("search", onNativeSearch);
    options.input.removeEventListener("keydown", onKeydown);
  };
}

export function createLatestLibraryRequest() {
  let currentId = 0;
  let controller: AbortController | undefined;

  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      return { id: ++currentId, signal: controller.signal };
    },
    isCurrent(id: number) {
      return id === currentId;
    },
  };
}

export function createLibraryPollingScheduler(
  onPoll: () => void,
  delayMs = 700,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  return {
    stop,
    sync(state: Pick<LibraryLoadState, "searching" | "searchError" | "books">) {
      stop();
      if (state.searching || state.searchError) return;
      if (!state.books.some((book) => book.parseStatus === "processing")) return;
      timer = setInterval(onPoll, delayMs);
    },
  };
}

export function libraryViewState(state: LibraryLoadState) {
  if (state.loading && state.books.length === 0) return "loading";
  if (state.error && state.books.length === 0) return "failure";
  if (state.books.length === 0 && state.query.trim()) return "filtered_empty";
  if (state.books.length === 0) return "empty";
  return "normal";
}

export function authorLabel(author: string | null) {
  return author?.trim() || "作者未知";
}

export function parseStatusLabel(status: BookParseStatus, errorCode: string | null) {
  if (status === "processing") return "正在解析";
  if (status === "ready_pages") return "页面可用";
  if (status === "ready_text") return "可以阅读";
  const failures: Record<string, string> = {
    PDF_ENCRYPTED: "PDF 已加密",
    PDF_INVALID: "文件已损坏",
    EPUB_INVALID: "EPUB 无法解析",
    BOOK_TEXT_MISSING: "文件没有正文",
  };
  return failures[errorCode ?? ""] ?? "解析失败";
}

export function coverStatusLabel(status: BookParseStatus, errorCode: string | null) {
  if (status === "processing") return "解析中";
  if (status === "ready_pages") return "页面模式";
  if (status === "ready_text") return "已就绪";
  if (errorCode === "PDF_INVALID") return "已损坏";
  return "解析失败";
}

export function libraryBookHref(book: LibraryBookSummary) {
  return book.parseStatus === "ready_text"
    ? `#/reading/${encodeURIComponent(book.id)}`
    : null;
}

export function libraryBookDetailHref(book: LibraryBookSummary) {
  return book.parseStatus === "ready_text"
    ? `#/book/${encodeURIComponent(book.id)}`
    : null;
}

export function bookDetailIdFromHash(hash: string) {
  const match = hash.match(/^#\/book\/([^/?#]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function readingBookIdFromHash(hash: string) {
  const match = hash.match(/^#\/reading\/([^/?#]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
