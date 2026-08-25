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
      activeTab: "highlights",
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
    expect(html).not.toMatch(/id="book-detail-panel-highlights"[^>]*>[^<]*<article/);
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
});
