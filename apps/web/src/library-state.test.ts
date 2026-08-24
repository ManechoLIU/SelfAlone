import { describe, expect, it } from "vitest";
import {
  authorLabel,
  libraryViewState,
  parseStatusLabel,
  type LibraryLoadState,
} from "./library-state";

const normal: LibraryLoadState = {
  loading: false,
  error: "",
  query: "",
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
      createdAt: "2026-08-24T10:00:00.000Z",
    },
  ],
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
});
