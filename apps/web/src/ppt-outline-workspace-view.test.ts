import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPptOutlineWorkspaceView } from "./ppt-outline-workspace-view";
import type { PptOutlineWorkspaceState } from "./ppt-outline-workspace-state";

const outlineCss = readFileSync(new URL("./ppt-outline-workspace.css", import.meta.url), "utf8");

function readyState(overrides: Record<string, unknown> = {}): PptOutlineWorkspaceState {
  return {
    phase: "ready",
    draftId: "draft-1",
    version: 3,
    paragraphs: [
      { id: "page-1", level: 1, text: "在苦难中活着的意义" },
      { id: "point-1", level: 2, text: "余华与《活着》简介" },
      { id: "detail-1", level: 3, text: "核心观点说明" },
      { id: "page-2", level: 1, text: "福贵的人生轨迹" },
    ],
    publicSources: [
      {
        url: "https://publisher.example.invalid/catalog/book",
        title: "出版社公开目录",
        publishedAt: null,
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline:draft-1",
      },
      {
        url: "https://author.example.invalid/interview",
        title: "作者访谈",
        publishedAt: null,
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline:draft-1",
      },
    ],
    saveStatus: "saved",
    saveBlocked: false,
    orphanIds: [],
    dirty: false,
    ...overrides,
  } as PptOutlineWorkspaceState;
}

const source = { title: "活着", author: "余华" };

describe("PPT outline workspace view", () => {
  it("renders nothing until the outline is ready", () => {
    expect(renderPptOutlineWorkspaceView({ phase: "hidden" }, { source })).toBe("");
  });

  it("renders the shared stage steps with the outline step active and requirements done", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState(), { source });

    expect(rendered).toContain('class="desktop-task-panel-inner');
    expect(rendered).toContain('data-current-stage="outline"');
    expect(rendered).toContain('<h2 id="ppt-outline-title">大纲</h2>');
    expect(rendered).toContain('<ol class="desktop-stage-steps"');
    expect(rendered).toMatch(/<li class="done"><span aria-hidden="true">1<\/span><strong>范围与需求<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class="active" aria-current="step"><span aria-hidden="true">2<\/span><strong>大纲<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class=""><span aria-hidden="true">3<\/span><strong>模板<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class=""><span aria-hidden="true">4<\/span><strong>生成<\/strong><\/li>/);
    expect(outlineCss).not.toMatch(/\.ppt-outline-step/);
  });

  it("renders continuous level 1/2/3 paragraphs with computed page numbers, not the M0 page shape", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState(), { source });

    expect(rendered).toContain("来源：活着 · 余华");
    expect(rendered).toContain("当前 2 页");
    expect(rendered).toContain('data-level="1"');
    expect(rendered).toContain('data-level="2"');
    expect(rendered).toContain('data-level="3"');
    expect(rendered).toContain('data-paragraph-id="page-1"');
    expect(rendered).toContain(">1.</span>");
    expect(rendered).toContain(">2.</span>");
    expect(rendered).toContain("在苦难中活着的意义");
    expect(rendered).toContain("余华与《活着》简介");
    expect(rendered).toContain("核心观点说明");
    expect(rendered).toContain('aria-label="第 1 页"');
    expect(rendered).toContain('aria-label="要点"');
    expect(rendered).toContain('aria-label="说明"');
    // No M0 legacy outline shape (title-N/body-N per-page fields) and no editor toolbar.
    expect(rendered).not.toContain("title-0");
    expect(rendered).not.toContain("body-0");
    expect(rendered).not.toContain("outline-form");
    expect(rendered).not.toContain("ppt-outline-toolbar");
  });

  it("shows light public-source provenance and hides it when no sources were used", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState(), { source });
    expect(rendered).toContain("已参考公开资料：出版社公开目录 · 作者访谈");

    const withoutSources = renderPptOutlineWorkspaceView(readyState({ publicSources: [] }), { source });
    expect(withoutSources).not.toContain("已参考公开资料");
  });

  it("keeps the stable back action but no confirm mutation while the API has none", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState(), { source });
    expect(rendered).toContain("返回修改需求");
    expect(rendered).toContain("data-ppt-outline-back");
    expect(rendered).not.toContain("确认大纲");
    expect(rendered).not.toContain("data-ppt-outline-confirm");
  });

  it("renders the autosave status inline with an in-place retry on failure", () => {
    const saved = renderPptOutlineWorkspaceView(readyState(), { source });
    expect(saved).toContain("已自动保存");

    const saving = renderPptOutlineWorkspaceView(readyState({ saveStatus: "saving" }), { source });
    expect(saving).toContain("正在保存");

    const failed = renderPptOutlineWorkspaceView(readyState({ saveStatus: "failed", dirty: true }), { source });
    expect(failed).toContain("保存失败");
    expect(failed).toContain("data-ppt-outline-retry");
    expect(failed).toContain("重试");

    const recovering = renderPptOutlineWorkspaceView(readyState({ saveStatus: "recovering" }), { source });
    expect(recovering).toContain("正在恢复最新版本");
  });

  it("hints in place when a child paragraph loses its page hierarchy and blocks saving", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState({
      paragraphs: [
        { id: "point-1", level: 2, text: "孤儿要点" },
        { id: "page-1", level: 1, text: "页面" },
      ],
      orphanIds: ["point-1"],
      saveBlocked: true,
    }), { source });

    expect(rendered).toContain("需要页面层级才能确认大纲");
    expect(rendered).toContain('data-ppt-outline-orphan="point-1"');
    expect(rendered).toContain("恢复层级后才会自动保存");
    expect(rendered).not.toContain("已自动保存");
  });

  it("escapes paragraph text and keeps one editable row on an empty outline", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState({
      paragraphs: [{ id: "page-1", level: 1, text: "<script>alert(1)</script>" }],
    }), { source });
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).not.toContain("<script>alert(1)</script>");
    expect(rendered).toContain("当前 1 页");

    const empty = renderPptOutlineWorkspaceView(readyState({ paragraphs: [] }), { source });
    expect(empty).toContain("textarea");
    expect(empty).toContain("当前 0 页");
  });

  it("documents the structural keys and the Escape exit next to the editor", () => {
    const rendered = renderPptOutlineWorkspaceView(readyState(), { source });

    expect(rendered).toContain("ppt-outline-editor-help");
    expect(rendered).toContain("Enter");
    expect(rendered).toContain("Tab");
    expect(rendered).toContain("Esc");
  });

  it("keeps the back action and inline retry at least 44px interactive targets", () => {
    expect(outlineCss).toMatch(/\.ppt-outline-back\s*\{[^}]*min-height:\s*44px/s);
    expect(outlineCss).toMatch(/\.ppt-outline-back\s*\{[^}]*min-width:\s*44px/s);
    expect(outlineCss).toMatch(/\.ppt-outline-status\s+button\s*\{[^}]*min-height:\s*44px/s);
    expect(outlineCss).toMatch(/\.ppt-outline-status\s+button\s*\{[^}]*min-width:\s*44px/s);
  });

  it("keeps the visual contract on shared tokens, focus, responsive widths and reduced motion", () => {
    expect(outlineCss).toContain("var(--desktop-");
    expect(outlineCss).toContain("focus-visible");
    expect(outlineCss).toContain("@media (max-width: 1024px)");
    expect(outlineCss).toContain("@media (max-width: 768px)");
    expect(outlineCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(outlineCss).not.toMatch(/::?(before|after)/);
    expect(outlineCss).not.toContain("background-image: url(");
  });
});
