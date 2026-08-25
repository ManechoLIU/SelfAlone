import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
