import { describe, expect, it } from "vitest";
import {
  authorLabel,
  coverStatusLabel,
  libraryViewState,
  parseStatusLabel,
  type LibraryLoadState,
} from "./library-state";

const normal: LibraryLoadState = {
  loading: false,
  searching: false,
  error: "",
  searchError: "",
  query: "",
  draftQuery: "",
  books: [
    {
      id: "book-1",
      title: "远山来信",
      author: "林野",
      format: "epub",
      sourceLabel: "本地",
      parseStatus: "ready_text",
      errorCode: null,
      sectionCount: 4,
      pageCount: null,
      progressPercent: 0,
      createdAt: "2026-08-24T10:00:00.000Z",
    },
  ],
  unfilteredBooks: [],
};

describe("desktop library state", () => {
  it("keeps loading, true empty, filtered empty, failure and normal states distinct", () => {
    expect(libraryViewState({ ...normal, loading: true, books: [] })).toBe("loading");
    expect(libraryViewState({ ...normal, books: [] })).toBe("empty");
    expect(libraryViewState({ ...normal, query: "未找到", books: [] })).toBe("filtered_empty");
    expect(libraryViewState({ ...normal, error: "连接失败", books: [] })).toBe("failure");
    expect(libraryViewState(normal)).toBe("normal");
  });

  it("uses explicit author and parse-state fallbacks", () => {
    expect(authorLabel(null)).toBe("作者未知");
    expect(authorLabel(" 林野 ")).toBe("林野");
    expect(parseStatusLabel("processing", null)).toBe("正在解析");
    expect(parseStatusLabel("ready_pages", null)).toBe("页面可用");
    expect(parseStatusLabel("failed", "PDF_ENCRYPTED")).toBe("PDF 已加密");
    expect(parseStatusLabel("failed", "PDF_INVALID")).toBe("文件已损坏");
  });

  it("uses compact visible cover status without losing the full accessible parse state", () => {
    expect(coverStatusLabel("processing", null)).toBe("解析中");
    expect(coverStatusLabel("ready_text", null)).toBe("已就绪");
    expect(coverStatusLabel("ready_pages", null)).toBe("页面模式");
    expect(coverStatusLabel("failed", "PDF_INVALID")).toBe("已损坏");
  });

  it("opens only ready text books and safely resolves their reading route", async () => {
    const module = await import("./library-state") as typeof import("./library-state") & {
      libraryBookHref(book: LibraryLoadState["books"][number]): string | null;
      libraryBookDetailHref(book: LibraryLoadState["books"][number]): string | null;
      bookDetailIdFromHash(hash: string): string | null;
      readingBookIdFromHash(hash: string): string | null;
    };

    expect(typeof module.libraryBookHref).toBe("function");
    expect(typeof module.libraryBookDetailHref).toBe("function");
    expect(module.libraryBookDetailHref(normal.books[0]!)).toBe("#/book/book-1");
    expect(module.bookDetailIdFromHash("#/book/book%20one")).toBe("book one");
    expect(module.bookDetailIdFromHash("#/book/%E0%A4%A")).toBeNull();
    expect(module.bookDetailIdFromHash("#/library")).toBeNull();
    expect(module.libraryBookHref(normal.books[0]!)).toBe("#/reading/book-1");
    expect(module.libraryBookHref({ ...normal.books[0]!, parseStatus: "processing" })).toBeNull();
    expect(module.libraryBookHref({ ...normal.books[0]!, parseStatus: "ready_pages" })).toBeNull();
    expect(module.readingBookIdFromHash("#/reading/book%20one")).toBe("book one");
    expect(module.readingBookIdFromHash("#/reading/%E0%A4%A")).toBeNull();
    expect(module.readingBookIdFromHash("#/library")).toBeNull();
  });
});
