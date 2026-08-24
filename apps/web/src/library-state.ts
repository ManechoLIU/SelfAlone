import type { BookParseStatus, LibraryBookSummary } from "@selfalone/contracts";

export type LibraryLoadState = {
  loading: boolean;
  error: string;
  query: string;
  books: LibraryBookSummary[];
};

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
