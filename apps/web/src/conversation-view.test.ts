import { describe, expect, it } from "vitest";
import { renderConversationView } from "./conversation-view";
import { renderDesktopAppShell } from "./ui/desktop-shell";
import type { WorkspaceSnapshot } from "./app-state";

const failedWorkspace: WorkspaceSnapshot = {
  book: { id: "book-1", title: "长安的荔枝", sourceLabel: "开发种子书" },
  conversation: { id: "conversation-1" },
  draft: {
    id: "draft-1",
    stage: "submitted",
    version: 7,
    requirements: "为读书会生成三页分享",
    templateId: "qingci-study",
  },
  outline: [
    { title: "千里转运", body: "一颗荔枝如何穿越盛唐" },
    { title: "制度之困", body: "把不可能任务拆成可验证问题" },
    { title: "普通人的选择", body: "在限制中保留善意与担当" },
  ],
  task: {
    id: "task-1",
    status: "failed",
    completedPages: 2,
    totalPages: 3,
    version: 4,
    error: "PRESENTATION_GENERATION_FAILED",
  },
};

describe("conversation-view", () => {
  it("retains completed pages and the failed task context in place", () => {
    const view = renderConversationView({
      workspace: failedWorkspace,
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.taskPanel).toContain("千里转运");
    expect(view.taskPanel).toContain("制度之困");
    expect(view.taskPanel).toContain("失败");
    expect(view.taskPanel).toContain("PRESENTATION_GENERATION_FAILED");
    expect(view.taskPanel).toContain("已保留需求、大纲和已完成页面");
    expect(view.main).toContain("已保留需求、大纲和已完成页面");
    expect(view.main).not.toContain("正在排版");
    expect(view.taskPanel).toContain("生成");
  });

  it("keeps each stage's complete workspace in one right panel", () => {
    const stages = [
      {
        screen: "requirements",
        workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "requirements" }, task: null },
        title: "范围与需求",
        marker: "desktop-scope-fields",
      },
      {
        screen: "outline",
        workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "outline" }, task: null },
        title: "大纲",
        marker: "desktop-outline-form",
      },
      {
        screen: "template",
        workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "template" }, task: null },
        title: "选择模板",
        marker: "desktop-template-grid",
      },
      {
        screen: "generating",
        workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "running" } },
        title: "正在生成第3/3页",
        marker: "desktop-waterfall",
      },
      {
        screen: "failed",
        workspace: failedWorkspace,
        title: "生成在第3/3页中断",
        marker: "desktop-waterfall",
      },
      {
        screen: "completed",
        workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "completed", completedPages: 3, artifactId: "artifact-1" } },
        title: "已生成3页",
        marker: "desktop-waterfall",
      },
      {
        screen: "stopped",
        workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "stopped" } },
        title: "生成在第3/3页停止",
        marker: "desktop-waterfall",
      },
    ] as const;

    for (const stage of stages) {
      const view = renderConversationView({
        workspace: stage.workspace,
        busy: false,
        selectedTemplate: "qingci-study",
      });

      expect(view.taskPanel).toContain(`data-current-stage="${stage.screen}"`);
      expect(view.taskPanel).toContain(`<h2>${stage.title}</h2>`);
      expect(view.taskPanel).toContain(stage.marker);
      expect(view.taskPanel.match(/<li class="active">/g)).toHaveLength(1);
      expect(view.main).not.toContain(stage.marker);
      if (stage.screen !== "requirements") {
        expect(view.taskPanel).not.toContain("<h2>范围与需求</h2>");
        expect(view.taskPanel).not.toContain("desktop-scope-summary");
      }
    }
  });

  it("keeps the center limited to messages, a stage summary, and one input", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "template" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.main).toContain('class="desktop-stage-summary"');
    expect(view.main).toContain('class="desktop-composer"');
    expect(view.main).not.toContain("desktop-outline-node");
    expect(view.main).not.toContain("desktop-template-card");
    expect(view.main).not.toContain("desktop-generation-page");
  });

  it("does not duplicate the complete stage workspace at the compact breakpoint", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "outline" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    const html = renderDesktopAppShell({
      activeSection: "conversation",
      currentConversation: { title: "《长安的荔枝》读书分享", meta: "大纲" },
      conversationList: [],
      mainContent: view.main,
      taskPanel: view.taskPanel,
    });

    expect(html.match(/desktop-outline-form/g)).toHaveLength(1);
    expect(html.match(/class="desktop-task-panel"/g)).toHaveLength(1);
    expect(html).toContain('class="desktop-conversation-list"');
  });

  it("makes the development boundary explicit on the requirements screen", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "requirements" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.main).toContain("生成要求");
    expect(view.main).toContain('src="/mascot/laoji-mascot-seated-reading-transparent-v1.png"');
    expect(view.taskPanel).toContain("范围与需求");
    expect(view.taskPanel).toContain("生成示例大纲");
    expect(view.taskPanel).toContain("用途、受众和页数暂不可用");
    expect(view.taskPanel.match(/<select[^>]+disabled/g)).toHaveLength(3);
    expect(view.main).toContain("本地演示 · 不调用 AI");
  });

  it("leaves the desktop shell with one main landmark", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "requirements" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.main).not.toMatch(/<main\b/);
    expect(view.main).toMatch(/<section class="conversation-content\b/);
  });

  it("does not preload example requirements into an empty real draft", () => {
    const view = renderConversationView({
      workspace: {
        ...failedWorkspace,
        draft: { ...failedWorkspace.draft, stage: "requirements", requirements: "" },
        task: null,
      },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.main).not.toContain("为读书会生成三页分享，突出普通人的选择。");
    expect(view.main).toContain('placeholder="补充用途、受众或希望保留的观点"');
  });
});
