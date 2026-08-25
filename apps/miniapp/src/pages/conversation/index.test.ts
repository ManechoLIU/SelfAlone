import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import conversationWxml from "./index.wxml?raw";
import conversationWxss from "./index.wxss?raw";
import type { PptConversationIntent } from "../../core/ppt-intent";

type ConversationPageHarness = {
  data: Record<string, any>;
  setData(patch: Record<string, any>, callback?: () => void): void;
  [key: string]: any;
};

let pageDefinition: ConversationPageHarness;
let storedIntent: PptConversationIntent | null;
let storedConversationState: unknown;
let intentStore: {
  restore: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  workspaceUrl: ReturnType<typeof vi.fn>;
};

function createPage(): ConversationPageHarness {
  return {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)) as Record<string, any>,
    setData(this: ConversationPageHarness, patch: Record<string, any>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
}

beforeAll(async () => {
  storedIntent = {
    version: 1,
    conversationId: "development-current",
    taskId: "development-ppt-dev-local-ink",
    bookId: "dev-local-ink",
    bookTitle: "山窗读书札记",
    phase: "awaiting-confirmation",
  };
  storedConversationState = undefined;
  intentStore = {
    restore: vi.fn(() => storedIntent),
    confirm: vi.fn(() => {
      storedIntent = storedIntent ? { ...storedIntent, phase: "requirements-ready" } : null;
      return storedIntent;
    }),
    workspaceUrl: vi.fn(() => storedIntent?.phase === "requirements-ready"
      ? "/pages/ppt/index?bookId=dev-local-ink&intentId=development-ppt-dev-local-ink"
      : null),
  };
  vi.stubGlobal("Page", (definition: ConversationPageHarness) => { pageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({
    globalData: {
      developmentAdapter: true,
      session: { kind: "development" },
      sessionStore: { restore: () => ({ kind: "development" }) },
      pptIntentStore: intentStore,
    },
  }));
  vi.stubGlobal("wx", {
    navigateTo: vi.fn(),
    reLaunch: vi.fn(),
    getStorageSync: vi.fn(() => storedConversationState),
    setStorageSync: vi.fn((_key: string, value: unknown) => { storedConversationState = value; }),
    removeStorageSync: vi.fn(),
  });
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  storedIntent = storedIntent ? { ...storedIntent, phase: "awaiting-confirmation" } : storedIntent;
  storedConversationState = undefined;
  intentStore.confirm.mockClear();
  intentStore.workspaceUrl.mockClear();
  (wx as unknown as { navigateTo: ReturnType<typeof vi.fn> }).navigateTo.mockClear();
});

describe("conversation normal shell contract", () => {
  it("keeps internal development and viewport receipts out of the visible normal conversation", () => {
    expect(conversationWxml).toContain("和老己聊聊");
    expect(conversationWxml).not.toContain("开发适配器只验证");
    expect(conversationWxml).not.toContain("等待 F3 / F4");
    expect(conversationWxml).not.toContain("viewport-receipt");
    expect(conversationWxml).not.toContain("仅开发环境");
  });

  it("does not keep the old permanent PPT task card or its two competing actions", () => {
    expect(conversationWxml).not.toContain("ppt-intent-card");
    expect(conversationWxml).not.toContain("返回阅读");
    expect(conversationWxml).not.toContain("继续范围与需求");
    expect(conversationWxml).not.toContain("确认范围并继续");
  });

  it("keeps normal conversation free of seeded task-stage and diagnostic copy", () => {
    expect(conversationWxml).not.toContain("PPT 任务");
    expect(conversationWxml).not.toContain("范围与需求 · 1 / 4");
    expect(conversationWxml).not.toContain("山窗读书札记");
  });

  it("renders scenery as an image element so the WeChat runtime can load the local asset", () => {
    expect(conversationWxml).toMatch(/<view\s+class="conversation-scenery"\s+aria-hidden="true">\s*<image\s+class="conversation-scenery-image"\s+src="\/assets\/backgrounds\/mobile-drawer-landscape-transparent-cropped-v1-mirrored\.png"\s+mode="widthFix"\s+aria-hidden="true"><\/image>\s*<\/view>/);
    const sceneryBlock = conversationWxss.match(/\.conversation-scenery\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(sceneryBlock).toMatch(/display:\s*block/);
    expect(sceneryBlock).toMatch(/overflow:\s*hidden/);
    expect(sceneryBlock).not.toMatch(/background-image:\s*url\(/);
    expect(sceneryBlock).toMatch(/opacity:\s*\.62/);
    expect(sceneryBlock).toMatch(/mask-image:\s*linear-gradient/);
    const sceneryImageBlock = conversationWxss.match(/\.conversation-scenery-image\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(sceneryImageBlock).toMatch(/bottom:\s*0/);
    expect(sceneryImageBlock).toMatch(/width:\s*100%/);
    expect(sceneryImageBlock).toMatch(/height:\s*auto/);
  });

  it("leaves a visible scenery slot above the composer while keeping input layers in front", () => {
    const sceneryBlock = conversationWxss.match(/\.conversation-scenery\s*\{([^}]*)\}/)?.[1] ?? "";
    const sceneryBottomValue = sceneryBlock.match(/bottom:\s*([^;]+)/)?.[1] ?? "";
    const sceneryBottom = Number(sceneryBottomValue.match(/(\d+)px/)?.[1] ?? sceneryBottomValue);
    const sceneryHeight = Number(sceneryBlock.match(/height:\s*(\d+)px/)?.[1]);
    const composerAreaBlock = conversationWxss.match(/\.composer-area\s*\{(?=[^}]*background:\s*linear-gradient)([^}]*)\}/)?.[1] ?? "";
    const composerBlock = conversationWxss.match(/\.composer\s*\{([^}]*)\}/)?.[1] ?? "";
    const fadeStop = Number(composerAreaBlock.match(/rgba\(251, 252, 250, \.94\)\s+(\d+)%/)?.[1]);

    expect(sceneryBottom).toBeGreaterThanOrEqual(112);
    expect(sceneryHeight).toBeGreaterThanOrEqual(200);
    expect(sceneryBlock).toMatch(/max-height:\s*28vh/);
    expect(fadeStop).toBeGreaterThanOrEqual(70);
    expect(composerBlock).toMatch(/position:\s*relative/);
    expect(composerBlock).toMatch(/z-index:\s*2/);
    expect(sceneryBlock).toMatch(/pointer-events:\s*none/);
    expect(conversationWxss).toMatch(/\.selection-layer\s*\{[^}]*z-index:\s*30/);
  });

  it("uses a compact five-line composer and keeps the visible mascot anchored to its top edge", () => {
    expect(conversationWxml).toContain('class="composer"');
    expect(conversationWxml).toContain('class="composer-mascot"');
    const inputBlock = conversationWxss.match(/\.composer-input\s*\{([^}]*)\}/)?.[1] ?? "";
    const lineHeight = Number(inputBlock.match(/line-height:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    const paddingBlock = Number(inputBlock.match(/padding:\s*(\d+(?:\.\d+)?)px\s+\d+(?:\.\d+)?px/)?.[1]);
    const borderBlock = Number(inputBlock.match(/border:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? "0");
    const maxHeight = Number(inputBlock.match(/max-height:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    expect(inputBlock).toMatch(/overflow-y:\s*auto/);
    expect(inputBlock).toMatch(/box-sizing:\s*border-box/);
    expect(inputBlock).toMatch(/border:\s*0;/);
    expect(maxHeight).toBe(5 * lineHeight + (paddingBlock * 2) + (borderBlock * 2));
    expect(conversationWxss).toMatch(/\.composer-row\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(conversationWxss).toMatch(/\.composer-mascot\s*\{[\s\S]*?bottom:\s*calc\(100%\s*-\s*4px\);/);
    expect(conversationWxss).not.toMatch(/\.conversation-page\.is-keyboard-open\s+\.composer-mascot\s*\{[^}]*top:/);
    expect(conversationWxss).not.toMatch(/\.composer-mascot\s*\{[^}]*top:\s*-/);
  });

  it("keeps reduced-motion selectors compatible with the WeChat WXSS parser", () => {
    expect(conversationWxss).not.toMatch(/\.conversation-page\s+\*,\s*\.selection-layer\s+\*/);
  });

  it("opens the selection sheet, confirms a scope, writes a summary, and reopens it for editing", () => {
    const page = createPage();

    page.onShow();
    page.openSelection();
    expect(page.data.selectionSheetOpen).toBe(true);

    page.toggleSelection({ currentTarget: { dataset: { id: "highlights" } }, detail: {} });
    expect(page.data.selectionDraftIds).toContain("highlights");

    page.confirmSelection();
    expect(page.data).toMatchObject({
      selectionSheetOpen: false,
      selectionSummary: "全书、我的划线与想法",
      pptIntent: { phase: "requirements-ready" },
    });
    expect(intentStore.confirm).toHaveBeenCalledTimes(1);

    page.editSelection();
    expect(page.data.selectionSheetOpen).toBe(true);
    expect(page.data.selectionDraftIds).toEqual(["full-book", "highlights"]);
  });

  it("has one PPT entry action and cannot enter the stage before confirmation", () => {
    const page = createPage();
    const navigateTo = (wx as unknown as { navigateTo: ReturnType<typeof vi.fn> }).navigateTo;

    page.onShow();
    page.openPptStage();
    expect(navigateTo).not.toHaveBeenCalled();

    page.confirmSelection();
    page.openPptStage();
    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/ppt/index?bookId=dev-local-ink&intentId=development-ppt-dev-local-ink",
    });
  });

  it("keeps the same development conversation and confirmed book intent after a page refresh", () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "保留当前补充要求" }, currentTarget: { dataset: {} } });
    page.toggleSelection({ currentTarget: { dataset: { id: "notes" } }, detail: {} });
    page.confirmSelection();

    const refreshed = createPage();
    refreshed.onShow();

    expect(refreshed.data).toMatchObject({
      draft: "保留当前补充要求",
      pptIntent: {
        conversationId: "development-current",
        bookId: "dev-local-ink",
        phase: "requirements-ready",
      },
      confirmedSelectionIds: ["full-book", "notes"],
      selectionSummary: "全书、老己笔记",
    });
  });

  it("preserves input and the pending scope when sending fails", () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "不要清空" }, currentTarget: { dataset: {} } });
    page.toggleSelection({ currentTarget: { dataset: { id: "notes" } }, detail: {} });

    page.showFailure("暂时无法发送");

    expect(page.data).toMatchObject({
      draft: "不要清空",
      selectionDraftIds: ["full-book", "notes"],
      boundaryMessage: "暂时无法发送",
    });
  });
});
