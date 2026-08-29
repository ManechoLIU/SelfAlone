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
let developmentAdapter = true;
let session: { kind: "development" } | { kind: "authenticated"; token: string } = { kind: "development" };
let productionConversationClient: {
  hydrateOrCreateSession: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
};
let intentStore: {
  restore: ReturnType<typeof vi.fn>;
  updateDraft: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
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

async function settleLocalSend() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}

beforeAll(async () => {
  storedIntent = {
    version: 2,
    conversationId: "development-current",
    bookId: "dev-local-ink",
    bookTitle: "山窗读书札记",
    author: "本地作者",
    source: "local",
    sourceLabel: "已导入",
    coverVariant: 0,
    draft: "帮我制作这本书PPT",
    phase: "awaiting-confirmation",
  };
  storedConversationState = undefined;
  productionConversationClient = {
    hydrateOrCreateSession: vi.fn(async () => { throw new Error("CONVERSATION_API_UNAVAILABLE"); }),
    sendText: vi.fn(async () => { throw new Error("CONVERSATION_API_UNAVAILABLE"); }),
  };
  intentStore = {
    restore: vi.fn(() => storedIntent),
    updateDraft: vi.fn((draft: string) => {
      storedIntent = storedIntent ? { ...storedIntent, draft } : null;
      return storedIntent;
    }),
    activate: vi.fn(() => {
      storedIntent = storedIntent ? { ...storedIntent, phase: "awaiting-confirmation" } : null;
      return storedIntent;
    }),
    confirm: vi.fn(() => {
      storedIntent = storedIntent ? { ...storedIntent, phase: "requirements-ready" } : null;
      return storedIntent;
    }),
    workspaceUrl: vi.fn(() => storedIntent?.phase === "requirements-ready"
      ? "/pages/ppt/index?bookId=dev-local-ink"
      : null),
  };
  vi.stubGlobal("Page", (definition: ConversationPageHarness) => { pageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({
    globalData: {
      developmentAdapter,
      session,
      sessionStore: { restore: () => session },
      pptIntentStore: intentStore,
      conversationClient: productionConversationClient,
    },
  }));
  vi.stubGlobal("wx", {
    navigateTo: vi.fn(),
    reLaunch: vi.fn(),
    getSystemInfoSync: vi.fn(() => ({ windowWidth: 390, windowHeight: 844 })),
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
  developmentAdapter = true;
  session = { kind: "development" };
  productionConversationClient = {
    hydrateOrCreateSession: vi.fn(async () => { throw new Error("CONVERSATION_API_UNAVAILABLE"); }),
    sendText: vi.fn(async () => { throw new Error("CONVERSATION_API_UNAVAILABLE"); }),
  };
  intentStore.confirm.mockClear();
  intentStore.updateDraft.mockClear();
  intentStore.activate.mockClear();
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

  it("restores a book handoff as an editable draft without opening scope or stage", () => {
    storedIntent = {
      version: 2,
      conversationId: "development-current",
      bookId: "dev-local-ink",
      bookTitle: "山窗读书札记",
      author: "本地作者",
      source: "local",
      sourceLabel: "已导入",
      coverVariant: 0,
      draft: "帮我制作这本书PPT",
      phase: "draft",
    };
    const page = createPage();

    page.onShow();

    expect(page.data).toMatchObject({
      draft: "帮我制作这本书PPT",
      pptIntent: null,
      pptHandoff: {
        conversationId: "development-current",
        bookId: "dev-local-ink",
        bookTitle: "山窗读书札记",
        author: "本地作者",
        sourceLabel: "已导入",
        phase: "draft",
      },
      selectionSheetOpen: false,
    });
    expect(intentStore.activate).not.toHaveBeenCalled();
    expect((wx as unknown as { navigateTo: ReturnType<typeof vi.fn> }).navigateTo).not.toHaveBeenCalled();
  });

  it("activates the handoff only when the user sends the prefilled draft", () => {
    storedIntent = {
      version: 2,
      conversationId: "development-current",
      bookId: "dev-local-ink",
      bookTitle: "山窗读书札记",
      draft: "帮我制作这本书PPT",
      phase: "draft",
    };
    const page = createPage();
    page.onShow();

    page.sendDraft();

    expect(intentStore.activate).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({
      pptIntent: { phase: "awaiting-confirmation", bookId: "dev-local-ink" },
      pptHandoff: null,
      selectionSheetOpen: true,
    });
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
      url: "/pages/ppt/index?bookId=dev-local-ink",
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

  it("locks the composer before sending a text draft", () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "先把这句话送出去" }, currentTarget: { dataset: {} } });

    page.sendDraft();

    expect(page.data.sending).toBe(true);
  });

  it("keeps the sending state across one async turn so the lock can render", async () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "让发送状态先显示" }, currentTarget: { dataset: {} } });

    page.sendDraft();
    await Promise.resolve();

    expect(page.data.sending).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settleLocalSend();
  });

  it("accepts the development failure query only for a development adapter page", () => {
    const developmentPage = createPage();
    developmentPage.onLoad({ developmentSendFailure: "1" });
    expect(developmentPage.developmentSendFailure).toBe(true);

    developmentAdapter = false;
    const productionPage = createPage();
    productionPage.onLoad({ developmentSendFailure: "1" });
    expect(productionPage.developmentSendFailure).toBe(false);
  });

  it("fails closed in production without calling a real conversation API", async () => {
    developmentAdapter = false;
    session = { kind: "authenticated", token: "opaque-mini-session-token-1234567890" };
    const page = createPage();
    page.onLoad();
    page.onShow();
    page.onDraftInput({ detail: { value: "生产环境不可假装发送" }, currentTarget: { dataset: {} } });
    await settleLocalSend();

    expect(productionConversationClient.hydrateOrCreateSession).toHaveBeenCalledTimes(1);
    expect(productionConversationClient.sendText).not.toHaveBeenCalled();
    expect(page.data.draft).toBe("生产环境不可假装发送");
    expect(page.data.boundaryMessage).toContain("保留");
  });

  it("shares the initial production hydration with an immediate send", async () => {
    developmentAdapter = false;
    session = { kind: "authenticated", token: "opaque-mini-session-token-1234567890" };
    const makeSession = (id: string) => ({
      id,
      revision: 0,
      draft: null,
      context: [],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });
    type TestSession = ReturnType<typeof makeSession>;
    const hydrateResolvers: Array<(value: TestSession) => void> = [];
    productionConversationClient.hydrateOrCreateSession.mockImplementation(
      () => new Promise<TestSession>((resolve) => hydrateResolvers.push(resolve)),
    );
    productionConversationClient.sendText.mockImplementation(async (conversationId: string) => ({
      status: "completed" as const,
      session: makeSession(conversationId),
      reply: "发送完成",
    }));

    const page = createPage();
    page.onLoad();
    page.onShow();
    page.onDraftInput({ detail: { value: "首屏立即发送" }, currentTarget: { dataset: {} } });
    page.sendDraft();

    if (hydrateResolvers.length > 1) {
      hydrateResolvers[1](makeSession("conversation-sent"));
      await settleLocalSend();
      hydrateResolvers[0](makeSession("conversation-late"));
    } else {
      hydrateResolvers[0]?.(makeSession("conversation-sent"));
    }
    await settleLocalSend();

    expect(productionConversationClient.hydrateOrCreateSession).toHaveBeenCalledTimes(1);
    expect(page.data.conversationId).toBe("conversation-sent");
    expect(page.data.pendingSend).toBeNull();
    expect(page.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "发送完成" }),
    ]));
  });

  it("persists a production draft and pending context across a refreshed page", async () => {
    developmentAdapter = false;
    session = { kind: "authenticated", token: "opaque-mini-session-token-1234567890" };
    const page = createPage();
    page.onLoad();
    page.onShow();
    page.onDraftInput({ detail: { value: "刷新后仍保留的生产草稿" }, currentTarget: { dataset: {} } });
    await settleLocalSend();

    const refreshed = createPage();
    refreshed.onLoad();
    refreshed.onShow();
    await settleLocalSend();

    expect(refreshed.data.draft).toBe("刷新后仍保留的生产草稿");
    expect(refreshed.data.boundaryMessage).toContain("保留");
  });

  it("maps a failed API result to a retained draft and retries with the same request id", async () => {
    developmentAdapter = false;
    session = { kind: "authenticated", token: "opaque-mini-session-token-1234567890" };
    productionConversationClient.hydrateOrCreateSession.mockResolvedValue({
      id: "conversation-production",
      revision: 0,
      draft: null,
      context: [],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });
    productionConversationClient.sendText
      .mockResolvedValueOnce({
        status: "failed",
        session: {
          id: "conversation-production",
          revision: 1,
          draft: { text: "接口失败后仍保留", attachments: [] },
          context: [{ id: "conversation-send-1:user", role: "user", text: "接口失败后仍保留", requestId: "conversation-send-1" }],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        },
        errorCode: "CONVERSATION_REPLY_FAILED",
        retainedDraft: { text: "接口失败后仍保留", attachments: [] },
      })
      .mockResolvedValueOnce({
        status: "completed",
        session: {
          id: "conversation-production",
          revision: 2,
          draft: null,
          context: [
            { id: "conversation-send-1:user", role: "user", text: "接口失败后仍保留", requestId: "conversation-send-1" },
            { id: "conversation-send-1:assistant", role: "assistant", text: "重试成功", requestId: "conversation-send-1" },
          ],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        },
        reply: "重试成功",
      });

    const page = createPage();
    page.onLoad();
    page.onShow();
    await settleLocalSend();
    page.onDraftInput({ detail: { value: "接口失败后仍保留" }, currentTarget: { dataset: {} } });
    page.sendDraft();
    await settleLocalSend();

    expect(page.data.sendStatus).toBe("failed");
    expect(page.data.draft).toBe("接口失败后仍保留");
    const firstRequest = productionConversationClient.sendText.mock.calls[0];
    expect(firstRequest?.[0]).toBe("conversation-production");
    expect(firstRequest?.[1]).toMatchObject({ requestId: expect.any(String), text: "接口失败后仍保留" });

    productionConversationClient.hydrateOrCreateSession.mockResolvedValue({
      id: "conversation-production",
      revision: 2,
      draft: null,
      context: [
        { id: "conversation-send-1:user", role: "user", text: "接口失败后仍保留", requestId: "conversation-send-1" },
        { id: "conversation-send-1:assistant", role: "assistant", text: "服务端已完成", requestId: "conversation-send-1" },
      ],
      activeRun: null,
      tasks: [],
      works: [],
      deleted: false,
    });
    const refreshed = createPage();
    refreshed.onLoad();
    refreshed.onShow();
    await settleLocalSend();
    expect(refreshed.data.pendingSend).toBeNull();
    expect(refreshed.data.draft).toBe("");
    expect(refreshed.data.messages).toHaveLength(2);
    expect(productionConversationClient.sendText).toHaveBeenCalledTimes(1);

    page.retrySend();
    await settleLocalSend();

    expect(productionConversationClient.sendText).toHaveBeenCalledTimes(2);
    expect(productionConversationClient.sendText.mock.calls[1]?.[1].requestId)
      .toBe(firstRequest?.[1].requestId);
    expect(page.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "重试成功" }),
    ]));
    expect(page.data.pendingSend).toBeNull();
  });

  it("keeps the deterministic long drawer list behind the development adapter", () => {
    const developmentPage = createPage();
    developmentPage.onLoad({ developmentLongList: "1" });

    expect(developmentPage.data.drawerConversations).toHaveLength(18);
    expect(developmentPage.data.drawerConversations[0]).toMatchObject({
      id: "development-long-01",
      current: true,
    });
    expect(developmentPage.data.drawerConversations[17]).toMatchObject({
      id: "development-long-18",
      current: false,
    });
    expect(new Set(developmentPage.data.drawerConversations.map((item: { id: string }) => item.id)).size).toBe(18);

    developmentAdapter = false;
    const productionPage = createPage();
    productionPage.onLoad({ developmentLongList: "1" });
    expect(productionPage.data.drawerConversations).toEqual([]);
    expect(conversationWxml).toContain('conversations="{{drawerConversations}}"');
  });

  it("renders the local message stream and in-place retry affordance", () => {
    expect(conversationWxml).toContain('wx:for="{{messages}}"');
    expect(conversationWxml).toContain('bindtap="retrySend"');
    expect(conversationWxml).toContain('disabled="{{!canSend || sending}}"');
    expect(conversationWxml).toContain('scroll-into-view="{{messageAnchor}}"');
    expect(conversationWxml).toContain('id="conversation-message-{{item.id}}"');
  });

  it("keeps sent messages single-column and the retry target touchable", () => {
    const userMessageBlock = conversationWxss.match(/\.user-message\s*\{([^}]*)\}/)?.[1] ?? "";
    const retryBlock = conversationWxss.match(/\.composer-retry\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(userMessageBlock).toMatch(/display:\s*flex/);
    expect(userMessageBlock).toMatch(/justify-content:\s*flex-end/);
    expect(conversationWxss).toMatch(/\.message-attachments\s*\{[^}]*display:\s*flex/);
    expect(retryBlock).toMatch(/min-height:\s*44px/);
  });

  it("keeps the failed-send copy above the mascot without moving the composer", () => {
    const errorBlock = conversationWxss.match(/\.composer-error\s*\{([^}]*)\}/)?.[1] ?? "";
    const mascotBlock = conversationWxss.match(/\.composer-mascot\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(errorBlock).toMatch(/position:\s*relative/);
    expect(errorBlock).toMatch(/z-index:\s*3/);
    expect(mascotBlock).toMatch(/z-index:\s*2/);
  });

  it("commits one user message and one local reply before clearing the composer", async () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "这条消息要留下记录" }, currentTarget: { dataset: {} } });

    page.sendDraft();
    page.sendDraft();
    expect(page.data).toMatchObject({ sending: true, draft: "这条消息要留下记录" });
    expect(page.data.messages).toHaveLength(1);

    await settleLocalSend();

    expect(page.data).toMatchObject({
      sending: false,
      draft: "",
      attachments: [],
      pendingSend: null,
    });
    expect(page.data.messages).toHaveLength(2);
    expect(page.data.messages[0]).toMatchObject({ role: "user", status: "sent", text: "这条消息要留下记录" });
    expect(page.data.messages[1]).toMatchObject({
      role: "assistant",
      text: "我收到这条消息了，我们可以继续聊下去。",
    });
    expect(page.data.messageAnchor).toBe("conversation-message-conversation-send-1-reply");
  });

  it("preserves a failed send and retries the same pending message without duplication", async () => {
    const page = createPage();
    page.onLoad({ developmentSendFailure: "1" });
    page.onShow();
    page.onDraftInput({ detail: { value: "这次发送要重试" }, currentTarget: { dataset: {} } });
    page.addAttachments(["wxfile://retry-image"]);

    page.sendDraft();
    const pendingId = page.data.pendingSend.id;
    await settleLocalSend();

    expect(page.data).toMatchObject({
      sending: false,
      sendStatus: "failed",
      draft: "这次发送要重试",
      attachments: ["wxfile://retry-image"],
      boundaryMessage: "这次没有发出去，内容还在这里。可以再试一次。",
    });
    expect(page.data.messages).toHaveLength(1);
    expect(page.data.messages[0]).toMatchObject({ id: pendingId, status: "failed" });

    const recovered = createPage();
    recovered.onShow();
    expect(recovered.data).toMatchObject({
      sendStatus: "failed",
      messageAnchor: `conversation-message-${pendingId}`,
    });
    expect(recovered.data.messages[0]).toMatchObject({ id: pendingId, status: "failed" });

    page.developmentSendFailure = false;
    page.retrySend();
    await settleLocalSend();

    expect(page.data.messages).toHaveLength(2);
    expect(page.data.messages[0]).toMatchObject({ id: pendingId, status: "sent" });
    expect(page.data.messages[1]).toMatchObject({ replyTo: pendingId });
    expect(page.data.pendingSend).toBeNull();
  });

  it("restores the PPT handoff draft and book context after a failed send and refresh", async () => {
    storedIntent = {
      version: 2,
      conversationId: "development-current",
      bookId: "dev-local-ink",
      bookTitle: "山窗读书札记",
      author: "本地作者",
      source: "local",
      sourceLabel: "已导入",
      coverVariant: 0,
      draft: "帮我制作这本书PPT",
      phase: "draft",
    };
    const page = createPage();
    page.onLoad({ developmentSendFailure: "1" });
    page.onShow();
    page.onDraftInput({ detail: { value: "帮我制作这本书PPT，重点讲第二章" }, currentTarget: { dataset: {} } });

    page.sendDraft();
    await settleLocalSend();

    expect(page.data).toMatchObject({
      sendStatus: "failed",
      draft: "帮我制作这本书PPT，重点讲第二章",
      pptIntent: {
        bookId: "dev-local-ink",
        bookTitle: "山窗读书札记",
        phase: "awaiting-confirmation",
      },
      pptHandoff: null,
    });
    expect(storedConversationState).toMatchObject({
      conversationId: "development-current",
      intentTaskId: null,
      draft: "帮我制作这本书PPT，重点讲第二章",
      pendingSend: { draft: "帮我制作这本书PPT，重点讲第二章" },
    });

    const refreshed = createPage();
    refreshed.onShow();

    expect(refreshed.data).toMatchObject({
      draft: "帮我制作这本书PPT，重点讲第二章",
      pptIntent: {
        bookId: "dev-local-ink",
        bookTitle: "山窗读书札记",
        author: "本地作者",
        sourceLabel: "已导入",
        phase: "awaiting-confirmation",
      },
      selectionSheetOpen: true,
      sendStatus: "failed",
    });
    expect((wx as unknown as { navigateTo: ReturnType<typeof vi.fn> }).navigateTo).not.toHaveBeenCalled();
  });

  it("restores committed messages without generating another reply", async () => {
    const page = createPage();
    page.onShow();
    page.onDraftInput({ detail: { value: "刷新后仍要看到" }, currentTarget: { dataset: {} } });
    page.sendDraft();
    await settleLocalSend();

    const refreshed = createPage();
    refreshed.onShow();
    expect(refreshed.data.messages).toHaveLength(2);
    expect(refreshed.data.messages[1]).toMatchObject({
      role: "assistant",
      text: "我收到这条消息了，我们可以继续聊下去。",
    });
    refreshed.onShow();
    expect(refreshed.data.messages).toHaveLength(2);
  });

  it("keeps the existing image picker and removal path available", () => {
    const page = createPage();
    page.onShow();
    const wxWithPicker = wx as unknown as {
      chooseImage?: (options: { success?: (result: { tempFilePaths?: string[] }) => void }) => void;
    };
    wxWithPicker.chooseImage = (options) => options.success?.({ tempFilePaths: ["wxfile://picked"] });

    page.chooseImage();
    expect(page.data.attachments).toEqual(["wxfile://picked"]);
    page.removeAttachment({ currentTarget: { dataset: { index: 0 } }, detail: {} });
    expect(page.data.attachments).toEqual([]);

    delete wxWithPicker.chooseImage;
  });

  it("sends an attachment-only draft while preserving remove behavior", async () => {
    const page = createPage();
    page.onShow();
    page.addAttachments(["wxfile://first", "wxfile://second"]);
    page.removeAttachment({ currentTarget: { dataset: { index: 1 } }, detail: {} });

    expect(page.data.attachments).toEqual(["wxfile://first"]);
    page.sendDraft();
    expect(page.data.messages[0]).toMatchObject({
      role: "user",
      attachments: ["wxfile://first"],
      status: "sending",
    });
    await settleLocalSend();

    expect(page.data.messages[1]).toMatchObject({
      role: "assistant",
      text: "图片已经收到，你可以继续补充想聊的内容。",
    });
    expect(page.data.attachments).toEqual([]);
  });
});
