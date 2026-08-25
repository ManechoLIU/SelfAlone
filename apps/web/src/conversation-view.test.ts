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
    expect(view.taskPanel).toContain('data-stage-back="outline"');
    expect(view.taskPanel).toContain("修改大纲");
    expect(view.taskPanel).toContain("重新生成");
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

  it("exposes contract-consistent forward and return actions inside the single task workspace", () => {
    const requirements = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "requirements" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(requirements.taskPanel).toContain('data-stage-forward="outline"');

    const outline = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "outline" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(outline.taskPanel).toContain('data-stage-back="requirements"');
    expect(outline.taskPanel).toContain('data-stage-forward="template"');

    const template = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "template" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(template.taskPanel).toContain('data-stage-back="outline"');
    expect(template.taskPanel).toContain('data-stage-forward="generating"');

    const generating = renderConversationView({
      workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "running" } },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(generating.taskPanel).toContain('data-stage-back="template"');
  });

  it("labels a recovered outline as local and not yet saved", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "outline" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
      outlineDraftStatus: "local",
    } as unknown as Parameters<typeof renderConversationView>[0]);

    expect(view.taskPanel).toContain("本地草稿 · 尚未保存");
    expect(view.taskPanel).toContain("确认大纲后才会写入老己服务");
  });

  it("renders a returned stage as the same single workspace without replacing the conversation", () => {
    const view = renderConversationView({
      workspace: failedWorkspace,
      busy: false,
      selectedTemplate: "qingci-study",
      screenOverride: "template",
      localStageView: true,
    });

    expect(view.taskPanel).toContain('data-current-stage="template"');
    expect(view.taskPanel).toContain('data-stage-back="outline"');
    expect(view.taskPanel).toContain("重新生成");
    expect(view.taskPanel).not.toContain("desktop-waterfall");
    expect(view.main).toContain("模板选择已移到右侧工作区");
  });

  it("keeps completed 16:9 pages and shows one same-size current-page skeleton while generating", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "running", completedPages: 2, totalPages: 3 } },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.taskPanel.match(/class="desktop-slide-miniature"/g)).toHaveLength(2);
    expect(view.taskPanel.match(/class="desktop-slide-skeleton"/g)).toHaveLength(1);
    expect(view.taskPanel).toContain("第 3 页 · 正在生成");
  });

  it("does not add a phantom page skeleton after the last page is complete", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "running", completedPages: 3, totalPages: 3 } },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.taskPanel.match(/class="desktop-slide-skeleton"/g)).toBeNull();
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

  it("keeps the composer in the center during generation and makes requirements editable after stop", () => {
    const generating = renderConversationView({
      workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "running", completedPages: 1 } },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(generating.main.match(/class="desktop-composer"/g)).toHaveLength(1);
    expect(generating.main).toContain('id="requirements"');
    expect(generating.main).toContain('aria-readonly="true"');

    const stopped = renderConversationView({
      workspace: { ...failedWorkspace, task: { ...failedWorkspace.task!, status: "stopped" } },
      busy: false,
      selectedTemplate: "qingci-study",
    });
    expect(stopped.main).not.toContain('aria-readonly="true"');
    expect(stopped.main).toContain("停止后可修改要求");
    expect(stopped.main).toContain("保存修改要求");
  });

  it("keeps the requirements summary aligned with the current stage", () => {
    const view = renderConversationView({
      workspace: { ...failedWorkspace, draft: { ...failedWorkspace.draft, stage: "requirements" }, task: null },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.main).toContain("范围与需求 · 生成示例大纲在右侧工作区");
    expect(view.main).not.toContain("生成中 · 进度在右侧工作区实时保留");
  });

  it("marks a returned workspace when its previous generation result is stale", () => {
    const view = renderConversationView({
      workspace: {
        ...failedWorkspace,
        draft: { ...failedWorkspace.draft, stage: "template" },
        task: null,
        staleTask: { ...failedWorkspace.task!, status: "completed" },
      },
      busy: false,
      selectedTemplate: "qingci-study",
    });

    expect(view.taskPanel).toContain("上一版生成结果已失效");
    expect(view.taskPanel).toContain("确认修改后的范围、大纲和模板后可重新生成");
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
