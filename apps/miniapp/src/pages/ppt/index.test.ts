import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientBoundaryError, type PptOutlineSnapshot } from "../../adapters/client";
import { DevelopmentClient } from "../../adapters/development";

type PptPageHarness = {
  data: Record<string, any>;
  bookId: string;
  developmentState: string;
  previewStage?: string;
  setData(patch: Record<string, any>, callback?: () => void): void;
  measureActions(): void;
  loadWorkspace(options?: { preserveShell?: boolean }): Promise<void>;
  retryWorkspace(): void;
  [key: string]: any;
};

let pageDefinition: PptPageHarness;
let client: DevelopmentClient;

function createPage(): PptPageHarness {
  const page = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)) as Record<string, any>,
    setData(this: PptPageHarness, patch: Record<string, any>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
    measureActions() {},
  } as PptPageHarness;
  return page;
}

beforeAll(async () => {
  client = new DevelopmentClient();
  vi.stubGlobal("Page", (definition: PptPageHarness) => { pageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({ globalData: { client, developmentAdapter: true } }));
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("PPT workspace load failure", () => {
  it("exposes the sent-intent draft workspace loader", () => {
    const page = createPage();
    expect(page.loadDraftWorkspace).toBeTypeOf("function");
  });

  it("presents a failed development route inside the recovered completed workspace", async () => {
    const page = createPage();
    page.bookId = "dev-local-ink";
    page.developmentState = "failed";
    page.previewStage = "completed";
    page.data.developmentAdapter = true;

    await page.loadWorkspace();

    expect(page.data).toMatchObject({
      phase: "failed",
      retryingWorkspace: false,
      workspaceVisible: true,
      screen: "completed",
      stageIndex: 4,
      stageTitle: "生成 PPT",
    });
    expect(page.data.workspace).toMatchObject({
      draftId: "dev-draft",
      bookId: "dev-local-ink",
      bookTitle: "山窗读书札记",
      purpose: "读书分享",
      audience: "读书会成员",
      pageRange: "6–8 页",
      task: { status: "completed", completedPages: 3, totalPages: 3 },
    });
    expect(page.data.workspace.previews).toHaveLength(3);
    expect(page.data.error).toBe("开发适配器模拟了可恢复失败");
  });

  it("retries into the same book and completed stage without dropping previews", async () => {
    const page = createPage();
    page.bookId = "dev-local-ink";
    page.developmentState = "failed";
    page.previewStage = "completed";
    page.data.developmentAdapter = true;
    await page.loadWorkspace();
    const failedWorkspace = JSON.parse(JSON.stringify(page.data.workspace));

    page.retryWorkspace();

    await vi.waitFor(() => expect(page.data.phase).toBe("ready"));
    expect(page.data).toMatchObject({
      retryingWorkspace: false,
      workspaceVisible: true,
      screen: "completed",
      stageIndex: 4,
      stageTitle: "生成 PPT",
    });
    expect(page.data.workspace).toEqual(failedWorkspace);
  });
});

describe("PPT sent-intent draft outline editing", () => {
  async function createDraftPage(): Promise<PptPageHarness> {
    const page = createPage();
    page.bookId = "dev-local-ink";
    page.conversationId = "conv-1";
    page.requestId = "req-1";
    page.draftMode = true;
    page.developmentState = "normal";
    page.data.developmentAdapter = true;
    await page.loadDraftWorkspace();
    return page;
  }

  it("keeps newer outline edits when an older autosave response resolves late", async () => {
    const page = await createDraftPage();
    let resolveSave: ((value: PptOutlineSnapshot) => void) | undefined;
    const spy = vi.spyOn(client, "savePptOutline").mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    page.setData({ outlineText: "第一页\n  要点", outlineEditorOpen: true });
    page.outlineDirty = true;

    const saving = page.saveDraftOutline();
    page.onOutlineInput({ detail: { value: "第一页\n  要点\n第二页" } });
    resolveSave?.({
      version: 2,
      pageCount: 1,
      paragraphs: [
        { id: "node-1", level: 1, text: "第一页" },
        { id: "node-2", level: 2, text: "要点" },
      ],
      publicSources: [],
    });
    await saving;

    expect(page.data.outlineText).toBe("第一页\n  要点\n第二页");
    expect(page.outlineDirty).toBe(true);
    expect(page.draftSnapshot.draft.version).toBe(2);
    expect(page.data.editorSaveState).toBe("saving");
    clearTimeout(page.outlineAutosaveTimer);
    spy.mockRestore();
  });

  it("recovers from a stale outline save with an authoritative workspace and outline reload", async () => {
    const page = await createDraftPage();
    const draftId = page.draftSnapshot.draft.id;
    await client.savePptOutline(draftId, {
      expectedVersion: 1,
      paragraphs: [{ id: "srv-1", level: 1, text: "服务端最新大纲" }],
    });
    page.setData({ outlineText: "旧版本大纲", outlineEditorOpen: true });
    page.outlineDirty = true;

    await page.saveDraftOutline();

    expect(page.data.outlineConflict).toBe(true);
    expect(page.data.editorSaveState).toBe("failed");
    const workspaceSpy = vi.spyOn(client, "getPptDraftWorkspace");
    const outlineSpy = vi.spyOn(client, "getPptOutline");

    await page.refreshDraftOutline();

    expect(workspaceSpy).toHaveBeenCalledWith(draftId);
    expect(outlineSpy).toHaveBeenCalledWith(draftId);
    expect(page.data.outlineConflict).toBe(false);
    expect(page.data.outlineText).toBe("服务端最新大纲");
    expect(page.outlineDirty).toBe(false);
    expect(page.data.outlineEditorOpen).toBe(true);
    expect(page.data.editorSaveState).toBe("idle");
    expect(page.draftSnapshot.draft.version).toBe(2);
    workspaceSpy.mockRestore();
    outlineSpy.mockRestore();
  });

  it("keeps a failed outline save open and retries it explicitly", async () => {
    const page = await createDraftPage();
    page.setData({ outlineText: "第一页", outlineEditorOpen: true });
    page.outlineDirty = true;
    const spy = vi.spyOn(client, "savePptOutline")
      .mockRejectedValueOnce(new ClientBoundaryError("HTTP_REQUEST_FAILED", "网络波动"));

    await page.saveDraftOutline();

    expect(page.data.editorSaveState).toBe("failed");
    expect(page.data.outlineEditorOpen).toBe(true);

    page.closeOutlineEditor();
    expect(page.data.outlineEditorOpen).toBe(true);

    await page.retryDraftOutlineSave();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(page.data.editorSaveState).toBe("saved");
    expect(page.outlineDirty).toBe(false);

    page.closeOutlineEditor();
    expect(page.data.outlineEditorOpen).toBe(false);
    spy.mockRestore();
  });

  it("keeps generated publicSources provenance in page data", async () => {
    const page = await createDraftPage();

    await page.saveDraftRequirements();

    expect(page.data.outlineSources.length).toBeGreaterThan(0);
    expect(page.data.outlineSources[0]).toMatchObject({
      url: expect.any(String),
      title: expect.any(String),
      fetchedAt: expect.any(String),
      usageScope: expect.any(String),
    });
  });

  it("numbers level-one outline entries by level-one order only", async () => {
    const page = createPage();
    page.bookId = "dev-local-ink";
    page.developmentState = "normal";
    page.data.developmentAdapter = true;

    await page.loadWorkspace();

    expect(page.data.outlineDisplay.map((node: { pageLabel: string }) => node.pageLabel))
      .toEqual(["01", "", "", "02", ""]);
  });
});
