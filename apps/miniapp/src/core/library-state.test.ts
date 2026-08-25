import { describe, expect, it } from "vitest";
import { preserveLibraryOnFailure, presentLibrary, type BookSummary } from "./library-state";

const books: BookSummary[] = [
  { id: "1", title: "甲书", author: "甲", source: "local", sourceLabel: "本地", format: "txt", progress: 0, coverVariant: 0 },
  { id: "2", title: "乙书", author: "Beta", source: "weread", sourceLabel: "微信读书", format: "weread", progress: 0.5, coverVariant: 1 },
];

describe("unified library states", () => {
  it("distinguishes loading, real empty, filtered empty, failure and content", () => {
    expect(presentLibrary({ phase: "loading", books: [], query: "" }).kind).toBe("loading");
    expect(presentLibrary({ phase: "ready", books: [], query: "" }).kind).toBe("empty");
    expect(presentLibrary({ phase: "ready", books, query: "不存在" }).kind).toBe("filtered-empty");
    expect(presentLibrary({ phase: "failed", books: [], query: "", error: "服务不可用" })).toEqual({ kind: "failed", message: "服务不可用" });
    expect(presentLibrary({ phase: "ready", books, query: "甲" })).toEqual({ kind: "content", books: [books[0]] });
  });

  it("matches title, author and source without splitting the shelf by source", () => {
    expect(presentLibrary({ phase: "ready", books, query: "beta" })).toEqual({ kind: "content", books: [books[1]] });
    expect(presentLibrary({ phase: "ready", books, query: "微信读书" })).toEqual({ kind: "content", books: [books[1]] });
  });

  it("keeps existing books visible when refresh fails", () => {
    expect(preserveLibraryOnFailure({ books, query: "甲" }, "刷新失败")).toEqual({ phase: "ready", books, query: "甲", notice: "刷新失败" });
    expect(preserveLibraryOnFailure({ books: [], query: "" }, "服务不可用")).toEqual({ phase: "failed", books: [], query: "", error: "服务不可用" });
  });

  it("trusts a server-filtered result instead of filtering it a second time on the client", () => {
    const serverResult: BookSummary = {
      ...books[0]!,
      title: "由服务端标题索引命中的书",
    };
    expect(presentLibrary({
      phase: "ready",
      books: [serverResult],
      query: "关键词",
      queryApplied: true,
    })).toEqual({ kind: "content", books: [serverResult] });
  });

  it("keeps the active query for a server-filtered empty result", () => {
    expect(presentLibrary({ phase: "ready", books: [], query: "未命中", queryApplied: true }))
      .toEqual({ kind: "filtered-empty" });
  });
});
