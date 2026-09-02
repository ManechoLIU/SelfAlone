import { describe, expect, it } from "vitest";
import { bookPptEntryFromHash, isPositiveBookPptIntent, pptBookIntentDraft } from "./ppt-book-entry";

describe("book PPT conversation entry", () => {
  it("keeps the book context in the current editable conversation without a stage", () => {
    expect(bookPptEntryFromHash("#/conversation?book=book-1&bookTitle=%E6%B5%8B%E8%AF%95")).toEqual({
      bookId: "book-1",
      draft: "帮我制作这本书PPT",
    });
    expect(pptBookIntentDraft).toBe("帮我制作这本书PPT");
  });

  it("only treats an explicit positive PPT request as the book PPT intent", () => {
    expect(isPositiveBookPptIntent("帮我制作这本书PPT")).toBe(true);
    expect(isPositiveBookPptIntent("帮我制作这本书ppt")).toBe(true);
    expect(isPositiveBookPptIntent("我暂时不想制作 PPT")).toBe(false);
    for (const negative of ["无需", "不用", "不必", "不需要", "不要", "不想", "别", "取消"]) {
      expect(isPositiveBookPptIntent(`${negative}帮我制作这本书ppt`)).toBe(false);
    }
    expect(isPositiveBookPptIntent("帮我制作一个通用主题PPT")).toBe(false);
  });
});
