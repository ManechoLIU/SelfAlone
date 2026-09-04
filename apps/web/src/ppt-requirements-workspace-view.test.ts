import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPptRequirementsWorkspaceView } from "./ppt-requirements-workspace-view";

const requirementsCss = readFileSync(new URL("./ppt-requirements-workspace.css", import.meta.url), "utf8");

describe("PPT requirements workspace view", () => {
  it("renders the four fixed requirement fields and the current first step only after ready", () => {
    const rendered = renderPptRequirementsWorkspaceView({
      phase: "ready",
      context: { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" },
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: "分享", audience: null, pageRange: { min: 8, max: 12 }, additionalRequirements: "简洁" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });

    expect(rendered).toContain("范围与需求");
    expect(rendered).toContain('aria-current="step"');
    expect(rendered).toContain("测试书");
    expect(rendered).toContain('name="purpose"');
    expect(rendered).toContain('name="audience"');
    expect(rendered).toContain('value="8-10"');
    expect(rendered).toContain('value="10-12"');
    expect(rendered).toContain('name="additionalRequirements"');
    expect(rendered).not.toContain("保存需求");
    expect(rendered).not.toContain("生成大纲");
  });

  it("offers keyboard-native common purpose and audience options while preserving free custom input", () => {
    const rendered = renderPptRequirementsWorkspaceView({
      phase: "ready",
      context: { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" },
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });

    expect(rendered).toContain('list="ppt-purpose-options"');
    expect(rendered).toContain('<datalist id="ppt-purpose-options">');
    expect(rendered).toContain('<option value="读书分享"></option>');
    expect(rendered).toContain('list="ppt-audience-options"');
    expect(rendered).toContain('<datalist id="ppt-audience-options">');
    expect(rendered).toContain('<option value="同事"></option>');
    expect(rendered).toContain("也可直接输入自定义用途");
    expect(rendered).toContain("也可直接输入自定义受众");
  });

  it("reuses the shared desktop stage steps and task header instead of a parallel step bar", () => {
    const rendered = renderPptRequirementsWorkspaceView({
      phase: "ready",
      context: { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" },
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: "分享", audience: "同事", pageRange: { min: 8, max: 10 }, additionalRequirements: "" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });

    expect(rendered).toContain('class="desktop-task-panel-inner');
    expect(rendered).toContain('class="desktop-task-header"');
    expect(rendered).toContain('<h2 id="ppt-requirements-title">范围与需求</h2>');
    expect(rendered).toContain('<ol class="desktop-stage-steps"');
    expect(rendered).toMatch(/<li class="active" aria-current="step"><span aria-hidden="true">1<\/span><strong>范围与需求<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class=""><span aria-hidden="true">2<\/span><strong>大纲<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class=""><span aria-hidden="true">3<\/span><strong>模板<\/strong><\/li>/);
    expect(rendered).toMatch(/<li class=""><span aria-hidden="true">4<\/span><strong>生成<\/strong><\/li>/);
    expect(rendered).not.toContain("ppt-requirements-steps");
    expect(rendered).not.toContain("ppt-requirements-step-marker");
    expect(rendered).not.toContain("ppt-requirements-step-connector");
    expect(requirementsCss).not.toMatch(/\.ppt-requirements-step/);
    expect(requirementsCss).not.toMatch(/\.ppt-requirements-workspace h2/);
    expect(requirementsCss).not.toMatch(/\.ppt-requirements-eyebrow/);
  });

  it("uses shared desktop tokens instead of private approximations and drops dead rules", () => {
    for (const privateApproximation of ["#21362e", "#65766f", "#cad6d1", "#9a4737", "#52655d", "#d7e3dc", "#cbdad2", "#73837d"]) {
      expect(requirementsCss).not.toContain(privateApproximation);
    }
    expect(requirementsCss).toContain("var(--desktop-");
    expect(requirementsCss).not.toMatch(/\.ppt-requirements-workspace\s+footer/);
    expect(requirementsCss).not.toMatch(/\.ppt-requirements-workspace\s*\{[^}]*padding:\s*32px/s);
  });

  it("renders no task panel for pending or normal conversation state", () => {
    expect(renderPptRequirementsWorkspaceView({ phase: "hidden" })).toBe("");
    expect(renderPptRequirementsWorkspaceView({ phase: "pending", context: { conversationId: "a", requestId: "r", bookId: "b" } })).toBe("");
  });
});
