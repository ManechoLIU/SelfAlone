import { describe, expect, it } from "vitest";
import type { PptWorkspace } from "../../adapters/client";
import pptWxml from "./index.wxml?raw";
import pptWxss from "./index.wxss?raw";
import {
  editorPanelHeight,
  needsPptRecoverySnapshot,
  preservePptFailureContext,
  pptActionClearance,
  pptWorkspaceRetryState,
  preparePptWorkspaceForState,
} from "./page-state";

const workspace: PptWorkspace = {
  draftId: "draft",
  version: 1,
  stage: "requirements",
  bookId: "book",
  bookTitle: "书",
  purpose: "读书分享",
  audience: "读书会成员",
  pageRange: "6–8 页",
  extra: "",
  outline: [],
  templateId: "celadon-reading",
  task: null,
  previews: [],
};

describe("PPT page development states", () => {
  it("opens filtered-empty directly on the template stage", () => {
    expect(preparePptWorkspaceForState(workspace, "filtered-empty")).toMatchObject({
      stage: "template",
      task: null,
    });
    expect(preparePptWorkspaceForState(workspace, "normal")).toEqual(workspace);
  });

  it("keeps the current PPT workspace visible when a later load fails", () => {
    const completedWorkspace: PptWorkspace = {
      ...workspace,
      stage: "submitted",
      extra: "保留长标题、引用和讲者备注",
      outline: [
        { level: 1, text: "为什么重新阅读" },
        { level: 2, text: "已经确认的范围" },
      ],
      templateId: "minimal-ink",
      task: { status: "completed", completedPages: 2, totalPages: 2 },
      previews: [
        { id: "preview-1", eyebrow: "01", title: "重新看见熟悉的书", body: "已经完成的页面不能因刷新失败而消失。" },
        { id: "preview-2", eyebrow: "02", title: "保留当前工作", body: "重试应回到同一本书和同一阶段。" },
      ],
    };

    expect(preservePptFailureContext(completedWorkspace, "PPT 草稿暂时无法加载")).toEqual({
      phase: "failed",
      error: "PPT 草稿暂时无法加载",
      retryingWorkspace: false,
      workspaceVisible: true,
      workspace: completedWorkspace,
    });
  });

  it("keeps the same PPT workspace and stage while its load retry is pending", () => {
    const outlineWorkspace: PptWorkspace = {
      ...workspace,
      stage: "outline",
      extra: "保留当前补充要求",
      outline: [{ level: 1, text: "已经确认的大纲" }],
    };

    expect(pptWorkspaceRetryState(outlineWorkspace)).toEqual({
      phase: "failed",
      error: "",
      retryingWorkspace: true,
      workspaceVisible: true,
      workspace: outlineWorkspace,
    });
  });

  it("loads a development snapshot before presenting a direct failed-state route", () => {
    expect(needsPptRecoverySnapshot("failed", null, true)).toBe(true);
    expect(needsPptRecoverySnapshot("failed", workspace, true)).toBe(false);
    expect(needsPptRecoverySnapshot("failed", null, false)).toBe(false);
    expect(needsPptRecoverySnapshot("normal", null, true)).toBe(false);
  });

  it("derives scroll clearance from the rendered action bar instead of a device constant", () => {
    expect(pptActionClearance(84)).toBe(100);
    expect(pptActionClearance(132, 20)).toBe(152);
    expect(pptActionClearance(Number.NaN)).toBe(16);
  });

  it("keeps the outline editor inside the live viewport when the keyboard reduces it", () => {
    expect(editorPanelHeight(568)).toBe(524);
    expect(editorPanelHeight(328)).toBe(284);
    expect(editorPanelHeight(32)).toBe(0);
  });

  it("binds PPT layers to live viewport and measured action geometry", () => {
    expect(pptWxml).toContain("{{viewportStyle}};{{actionStyle}};{{editorStyle}}");
    expect(pptWxss).toContain("height: var(--viewport-height, 100vh)");
    expect(pptWxss).toContain("height: var(--ppt-action-clearance, 96px)");
    expect(pptWxss).toContain("height: var(--ppt-editor-height, calc(100% - 44px))");
  });

  it("lets the shared viewport tracker own keyboard displacement", () => {
    expect(pptWxml).not.toContain('adjust-position="{{true}}"');
    expect(pptWxml).not.toContain('cursor-spacing="120"');
    expect(pptWxml.match(/adjust-position="{{false}}"/g)).toHaveLength(4);
  });
});
