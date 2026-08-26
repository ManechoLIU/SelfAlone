import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderBookDetail } from "./book-detail-view";

const bookDetailCss = readFileSync(new URL("./book-detail.css", import.meta.url), "utf8");
const annotationCss = readFileSync(new URL("./text-annotation.css", import.meta.url), "utf8");

describe("private book detail notes view", () => {
  it("uses a single full-width flow with titleless notes and one new-note primary action", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "雨后山亭",
      author: "林野",
      readingHref: "#/reading/book-1",
      fileVersion: 2,
      activeTab: "notes",
      highlights: [],
      notes: [{
        id: "note-1",
        bookId: "book-1",
        body: "第一行也只是正文，不是标题。",
        source: {
          locator: { kind: "text", fileVersion: 2, sectionId: "txt:0", offset: 0 },
          endOffset: 4,
          quote: "第一行",
        },
        version: 1,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }],
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html).toContain("划线与想法");
    expect(html).toContain("老己笔记");
    expect(html).toContain('data-book-detail-read href="#/reading/book-1"');
    expect(html).toContain("阅读");
    expect(html).toContain("PPT作品");
    expect(html).toContain("第一行也只是正文，不是标题。");
    expect(html).toContain("<blockquote");
    expect(html.match(/data-book-detail-new-note/g)).toHaveLength(1);
    expect(html).not.toMatch(/name="title"|笔记标题/);
    expect(html).toContain("data-book-detail-edit-note");
    expect(html).toContain("data-book-detail-delete-note");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('data-book-detail-tab="highlights"');
    expect(html).toContain('data-book-detail-tab="notes"');
    expect(html).toContain('aria-modal="true"');
  });

  it("keeps private annotation and note actions at a 44px touch target", () => {
    expect(annotationCss).toMatch(/\.text-annotation-selection-menu button,\n\.text-annotation-selection-menu a,\n\.text-annotation-thought button \{[\s\S]*?min-height:\s*44px/);
    expect(bookDetailCss).toMatch(/\.book-detail-row-actions button \{\s*min-height:\s*44px/);
    expect(annotationCss).toMatch(/\.text-annotation-status button \{[\s\S]*?min-height:\s*44px/);
    expect(bookDetailCss).toMatch(/\.book-detail-save-error button \{[\s\S]*?min-height:\s*44px/);
  });

  it("keeps the shared reader rail visible beside the detail surface", () => {
    expect(bookDetailCss).toContain("inset: 0 0 0 var(--reader-rail, 184px)");
  });

  it("hides the inactive tab panel from visual, pointer and accessibility flow", () => {
    const snapshot = {
      open: true,
      loading: false,
      error: "",
      title: "雨后山亭",
      author: "林野",
      fileVersion: 2,
      activeTab: "notes" as const,
      highlights: [{
        id: "highlight-1",
        bookId: "book-1",
        locator: { kind: "text" as const, fileVersion: 2, sectionId: "txt:0", offset: 0 },
        endOffset: 2,
        quote: "第一行",
        thought: null,
        version: 1,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    };
    const html = renderBookDetail(snapshot);
    expect(html).toMatch(/id="book-detail-panel-highlights"[^>]*hidden/);
    expect(html).toMatch(/id="book-detail-panel-notes"[^>]*role="tabpanel"/);
    expect(html).toMatch(/id="book-detail-panel-highlights"[^>]*hidden/);
  });

  it("keeps a failed note draft visible with a local retry action", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "雨后山亭",
      author: "林野",
      fileVersion: 2,
      activeTab: "notes",
      highlights: [],
      notes: [],
      draft: { mode: "create", body: "保留这段输入", source: null, noteId: null, expectedVersion: null, idempotencyKey: "note-retry-1" },
      saveError: "笔记没有保存，内容已保留；请重试。",
      deleteError: "",
    });
    expect(html).toContain("笔记没有保存，内容已保留");
    expect(html).toContain("保留这段输入");
    expect(html).toContain("data-book-detail-retry");
  });

  it("renders the real cover, PPT handoff, and truthful empty works tab", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "雨后山亭",
      author: "林野",
      readingHref: "#/reading/book-1",
      coverSrc: "/book-covers/local-default-celadon-ink-v1.png",
      pptHref: "#/conversation?stage=requirements&book=book-1",
      fileVersion: 2,
      activeTab: "ppt" as never,
      highlights: [],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html).toContain('data-book-detail-cover');
    expect(html).toContain('src="/book-covers/local-default-celadon-ink-v1.png"');
    expect(html).toContain('data-book-detail-ppt-cta');
    expect(html).toContain('href="#/conversation?stage=requirements&amp;book=book-1"');
    expect(html).toContain('data-book-detail-tab="ppt"');
    expect(html).toContain('id="book-detail-panel-ppt"');
    expect(html).toContain("还没有 PPT 作品");
  });

  it("keeps the new-note action exclusive to the notes tab and exposes the source label", () => {
    const base = {
      open: true,
      loading: false,
      error: "",
      title: "微信读书条目",
      author: "作者",
      sourceLabel: "微信读书",
      readingHref: "#/reading/book-1",
      fileVersion: 2,
      highlights: [],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    };
    const highlights = renderBookDetail({ ...base, activeTab: "highlights" });
    expect(highlights).toContain("微信读书");
    expect(highlights).not.toContain("data-book-detail-new-note");
    const notes = renderBookDetail({ ...base, activeTab: "notes" });
    expect(notes.match(/data-book-detail-new-note/g)).toHaveLength(1);
  });

  it("keeps generating and completed PPT works on the same two-column 16:9 surface", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "一本书",
      author: "作者",
      fileVersion: 2,
      activeTab: "ppt",
      highlights: [],
      notes: [],
      pptState: "normal",
      pptWorks: [
        { id: "work-1", title: "已完成作品", status: "completed", dateLabel: "8月25日", downloadHref: "/download/work-1" },
        { id: "work-2", title: "正在生成作品", status: "generating" },
      ],
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html.match(/data-book-detail-ppt-work/g)).toHaveLength(2);
    expect(html).toContain("下载 已完成作品 PPTX");
    expect(bookDetailCss).toContain("aspect-ratio: 16 / 9");
    expect(bookDetailCss).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("keeps prior PPT works visible below a failed reload action", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "一本书",
      author: "作者",
      fileVersion: 2,
      activeTab: "ppt",
      highlights: [],
      notes: [],
      pptState: "failed",
      pptError: "服务暂时不可用",
      pptWorks: [{ id: "work-1", title: "《一本书》读书分享", status: "completed", downloadHref: "/download/work-1" }],
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html).toContain("服务暂时不可用");
    expect(html).toContain("data-book-detail-ppt-reload");
    expect(html).toContain('data-book-detail-ppt-work="work-1"');
    expect(html).toContain("下载 《一本书》读书分享 PPTX");
  });

  it("keeps loading, filtered-empty, and failed PPT states actionable", () => {
    const base = {
      open: true,
      loading: false,
      error: "",
      title: "一本书",
      author: "作者",
      fileVersion: 2,
      activeTab: "ppt" as const,
      highlights: [],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    };
    expect(renderBookDetail({ ...base, pptState: "loading" })).toContain("正在载入 PPT 作品");
    expect(renderBookDetail({ ...base, pptState: "filtered-empty", pptQuery: "不存在" })).toContain("没有找到匹配的作品");
    expect(renderBookDetail({ ...base, pptState: "failed", pptError: "服务暂时不可用" })).toContain("data-book-detail-ppt-reload");
  });

  it("gives each dense note row one accessible overflow entry point", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "一本书",
      author: "作者",
      fileVersion: 2,
      activeTab: "notes",
      highlights: [],
      notes: ["一", "二", "三"].map((suffix, index) => ({
        id: `note-${suffix}`,
        bookId: "book-1",
        body: `正文记录 ${suffix}`,
        source: null,
        version: 1,
        createdAt: `2026-08-${25 - index}T00:00:00.000Z`,
        updatedAt: `2026-08-${25 - index}T00:00:00.000Z`,
      })),
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html.match(/data-book-detail-note-menu/g)).toHaveLength(3);
    expect(html.match(/aria-label="打开笔记操作" tabindex="0"/g)).toHaveLength(3);
    expect(html.match(/data-book-detail-edit-note/g)).toHaveLength(3);
    expect(html.match(/data-book-detail-delete-note/g)).toHaveLength(3);
  });

  it("gives each highlight row one accessible overflow entry point", () => {
    const html = renderBookDetail({
      open: true,
      loading: false,
      error: "",
      title: "一本书",
      author: "作者",
      fileVersion: 2,
      activeTab: "highlights",
      highlights: [{
        id: "highlight-1",
        bookId: "book-1",
        locator: { kind: "text", fileVersion: 2, sectionId: "txt:0", offset: 4 },
        endOffset: 8,
        quote: "留给下次回看的句子。",
        thought: "这句值得记住。",
        version: 3,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }],
      notes: [],
      draft: null,
      saveError: "",
      deleteError: "",
    });
    expect(html).toContain('data-book-detail-highlight-menu');
    expect(html).toContain('aria-label="打开划线操作" tabindex="0"');
    expect(html).toContain('role="menuitem" data-book-detail-delete-highlight="highlight-1"');
    expect(html).toContain("删除");
  });
});
