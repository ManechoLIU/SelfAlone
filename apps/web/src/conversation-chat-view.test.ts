import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createConversationChatState, updateConversationDraft } from "./conversation-chat-state";
import { createConversationChatController } from "./conversation-chat-controller";
import { mountConversationChatView, renderConversationChatView } from "./conversation-chat-view";
import { createPptRequirementsWorkspaceStore } from "./ppt-requirements-workspace-state";

const conversationChatCss = readFileSync(new URL("./conversation-chat.css", import.meta.url), "utf8");
const requirementsCss = readFileSync(new URL("./ppt-requirements-workspace.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

class FakeTextArea {
  value = "";
  private readonly listeners = new Map<string, Array<(event: { target: FakeTextArea }) => void>>();

  addEventListener(type: string, listener: (event: { target: FakeTextArea }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchInput() {
    for (const listener of [...(this.listeners.get("input") ?? [])]) {
      listener({ target: this });
    }
  }
}

class FakeForm {
  addEventListener() {
    // The input regression only needs the form to be discoverable.
  }
}

class FakeButton {
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchClick() {
    for (const listener of [...(this.listeners.get("click") ?? [])]) listener();
  }
}

class FakeNoticeRegion {
  retry = new FakeButton();
  patchCount = 0;
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.patchCount += 1;
  }

  get innerHTML() {
    return this.markup;
  }

  querySelector<T>(selector: string) {
    if (selector.includes("ppt-workspace-retry") && this.markup.includes("data-ppt-workspace-retry")) return this.retry as T;
    return null;
  }
}

class FakeMainRoot {
  input = new FakeTextArea();
  form = new FakeForm();
  notice = new FakeNoticeRegion();
  renderCount = 0;
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.renderCount += 1;
  }

  get innerHTML() {
    return this.markup;
  }

  querySelector<T>(selector: string) {
    if (selector.includes("conversation-chat-form")) return this.form as T;
    if (selector.includes("conversation-chat-input")) return this.input as T;
    if (selector.includes("ppt-workspace-notice")) return this.notice as T;
    return null;
  }
}

class FakeTaskRoot {
  innerHTML = "";

  closest() {
    return null;
  }
}

describe("conversation chat view", () => {
  it("renders a state-driven conversation with one controlled composer", () => {
    const state = updateConversationDraft(createConversationChatState("conversation-a"), "当前输入");
    const rendered = renderConversationChatView({ state, title: "今天的对话" });

    expect(rendered.main).toContain('data-conversation-chat="conversation-a"');
    expect(rendered.main).not.toContain('class="conversation-chat-header"');
    expect(rendered.main).toContain('data-conversation-chat-input');
    expect(rendered.main).toContain('name="message"');
    expect(rendered.main).toContain('value="当前输入"');
    expect(rendered.main.match(/data-conversation-chat-input/g)).toHaveLength(1);
    expect(rendered.main).toContain("还没有消息");
    expect(rendered.main).not.toContain("本地演示");
    expect(rendered.main).not.toContain("免费额度");
    expect(rendered.taskPanel).toBe("");
  });

  it("renders server messages, pending state, and retained error copy without examples", () => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "失败后保留",
      status: "error" as const,
      errorCode: "CONVERSATION_REPLY_FAILED",
      messages: [
        { id: "user-1", role: "user" as const, text: "来自真实状态的提问" },
        { id: "assistant-1", role: "assistant" as const, text: "来自确定性运行时的回复" },
      ],
    };
    const rendered = renderConversationChatView({ state, title: "当前会话" });

    expect(rendered.main).toContain("来自真实状态的提问");
    expect(rendered.main).toContain("来自确定性运行时的回复");
    expect(rendered.main).toContain("发送失败，输入仍保留");
    expect(rendered.main).not.toContain("CONVERSATION_REPLY_FAILED");
    expect(rendered.main).toContain('value="失败后保留"');
    expect(rendered.taskPanel).toBe("");
    expect(rendered.main).not.toContain("示例");
  });

  it.each(["PLATFORM_CONFIGURATION_REQUIRED", "PLATFORM_EXHAUSTION"])(
    "guides platform error %s back to text-model configuration without losing its draft",
    (errorCode) => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "请保留这段输入",
      status: "error" as const,
      errorCode,
      messages: [{ id: "user-1", role: "user" as const, text: "当前会话上下文" }],
    };

    const rendered = renderConversationChatView({ state });

    expect(rendered.main).toContain("配置自己的 AI 模型后继续");
    expect(rendered.main).toContain('href="#/settings/text-model?return=%23%2Fconversation"');
    expect(rendered.main).toContain(">配置 AI 模型</a>");
    expect(rendered.main).toContain('value="请保留这段输入"');
    expect(rendered.main).toContain("当前会话上下文");
    },
  );

  it("uses the complete conversation handoff hash in its text-model configuration link", () => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "保留阶段草稿",
      status: "error" as const,
      errorCode: "PLATFORM_CONFIGURATION_REQUIRED",
    };

    const rendered = renderConversationChatView({
      state,
      settingsReturnTo: "#/conversation?stage=outline&book=book-a",
    });

    expect(rendered.main).toContain(
      'href="#/settings/text-model?return=%23%2Fconversation%3Fstage%3Doutline%26book%3Dbook-a"',
    );
  });

  it("keeps platform unavailability in place with a retry prompt and no pricing copy", () => {
      const state = {
        ...createConversationChatState("conversation-a"),
        draft: "请稍后继续",
        status: "error" as const,
        errorCode: "PLATFORM_UNAVAILABLE",
      };

      const rendered = renderConversationChatView({ state });

      expect(rendered.main).toContain("当前会话和输入已保留，请稍后重试");
      expect(rendered.main).toContain('value="请稍后继续"');
      expect(rendered.main).not.toContain("余额");
      expect(rendered.main).not.toContain("金额");
      expect(rendered.main).not.toContain("价格");
  });

  it("uses fixed understandable copy for initial load failures", () => {
    expect(mainSource).toContain("老己服务暂时无法连接，当前会话和输入已保留，请稍后重试。");
    expect(mainSource).not.toContain("conversationChatError = error instanceof Error ? error.message : \"CONVERSATION_REQUEST_FAILED\"");
  });

  it("removes the task workspace track from normal conversation chat", () => {
    expect(mainSource).toContain('<div class="desktop-app-shell" data-active-section="conversation" style="--desktop-task-width: 0px;">');
  });

  it("uses the account-scoped requirements save and outline recovery path after create/reuse", () => {
    expect(mainSource).toContain("pptWorkspaceClient.createOrReuse");
    expect(mainSource).not.toContain("pptWorkspaceClient.getWorkspace");
    expect(mainSource).toContain("pptWorkspaceClient.saveRequirements");
    expect(mainSource).toContain("pptOutlineClient?.getOutline");
  });

  it("does not rebuild the composer DOM for consecutive input events", () => {
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({
          id: "conversation-a",
          revision: 1,
          draft: null,
          context: [],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        }),
        sendText: async () => {
          throw new Error("not used");
        },
      },
    });
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeTaskRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
    );
    const initialRenderCount = mainRoot.renderCount;
    const input = mainRoot.input;

    input.value = "连";
    input.dispatchInput();
    input.value = "连续";
    input.dispatchInput();

    expect(controller.getState().draft).toBe("连续");
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(input);
    dispose();
  });

  it("retries the failed workspace with the stored request context without resending its message", () => {
    const context = { conversationId: "conversation-a", requestId: "request-workspace-1", bookId: "book-1" };
    const workspaceStore = createPptRequirementsWorkspaceStore();
    workspaceStore.begin(context);
    workspaceStore.fail(context, new Error("workspace offline"));
    const retries: Array<typeof context> = [];
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({ id: "conversation-a", revision: 1, draft: null, context: [], activeRun: null, tasks: [], works: [], deleted: false }),
        sendText: async () => { throw new Error("not used"); },
      },
    });
    const mainRoot = new FakeMainRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      new FakeTaskRoot() as unknown as HTMLElement,
      controller,
      { workspaceStore, onWorkspaceRetry: (retryContext) => retries.push(retryContext) },
    );
    mainRoot.notice.retry.dispatchClick();

    expect(retries).toEqual([context]);
    dispose();
  });

  it("establishes a definite chat height chain so the stream scrolls and the composer stays pinned", () => {
    expect(mainSource).toContain('class="desktop-conversation-scroll desktop-conversation-scroll-chat"');
    expect(mainSource).toMatch(/id=\\?"conversation-chat-main-mount\\?" class=\\?"conversation-chat-mount\\?"/);
    expect(requirementsCss).toMatch(/\.desktop-conversation-scroll-chat\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
    expect(requirementsCss).toMatch(/\.desktop-conversation-scroll-chat\s*>\s*\[data-conversation-quota-host\]\s*\{[^}]*flex:\s*none/s);
    expect(requirementsCss).toMatch(/\.conversation-chat-mount\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-height:\s*0/s);
    expect(requirementsCss).toMatch(/\.conversation-chat-mount\s*>\s*\.conversation-chat-view\s*\{[^}]*height:\s*100%[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s+auto/s);
    expect(conversationChatCss).toMatch(/\.conversation-chat-scroll\s*\{[^}]*overflow:\s*auto/s);
  });

  it("keeps the workspace notice in a stable region between the stream and the composer", () => {
    const rendered = renderConversationChatView({
      state: createConversationChatState("conversation-a"),
      workspaceState: {
        phase: "error",
        context: { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" },
        error: new Error("offline"),
      },
    });

    const scrollIndex = rendered.main.indexOf('class="conversation-chat-scroll"');
    const noticeIndex = rendered.main.indexOf("data-ppt-workspace-notice");
    const composerIndex = rendered.main.indexOf('class="conversation-chat-composer"');
    expect(noticeIndex).toBeGreaterThan(scrollIndex);
    expect(composerIndex).toBeGreaterThan(noticeIndex);
    const scrollBlock = rendered.main.slice(scrollIndex, noticeIndex);
    expect(scrollBlock).not.toContain("ppt-requirements-notice");
    const noticeRegion = rendered.main.slice(noticeIndex, composerIndex);
    expect(noticeRegion).toContain("PPT 工作区暂时无法准备");
    expect(noticeRegion).toContain("data-ppt-workspace-retry");
  });

  it("patches only the workspace regions on workspace transitions, preserving composer focus and draft", () => {
    const context = { conversationId: "conversation-a", requestId: "request-focus-1", bookId: "book-1" };
    const workspaceStore = createPptRequirementsWorkspaceStore();
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({ id: "conversation-a", revision: 1, draft: null, context: [], activeRun: null, tasks: [], works: [], deleted: false }),
        sendText: async () => { throw new Error("not used"); },
      },
    });
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeTaskRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
      { workspaceStore },
    );
    const initialRenderCount = mainRoot.renderCount;
    const composerInput = mainRoot.input;
    composerInput.value = "正在输入的草稿";
    composerInput.dispatchInput();

    workspaceStore.begin(context);
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(composerInput);
    expect(mainRoot.notice.innerHTML).toContain("正在准备这本书的 PPT 范围与需求");
    expect(taskRoot.innerHTML).toBe("");

    workspaceStore.ready(context, {
      status: "created",
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(composerInput);
    expect(controller.getState().draft).toBe("正在输入的草稿");
    expect(taskRoot.innerHTML).toContain("范围与需求");
    expect(taskRoot.innerHTML).toContain("desktop-stage-steps");
    dispose();
  });

  it("marks the send control unavailable while sending and keeps keyboard semantics explicit", () => {
    const state = { ...createConversationChatState("conversation-a"), status: "sending" as const, draft: "发送中" };
    const rendered = renderConversationChatView({ state });

    expect(rendered.main).toContain('aria-busy="true"');
    expect(rendered.main).toContain('data-conversation-chat-send');
    expect(rendered.main).toMatch(/data-conversation-chat-send[^>]*disabled/);
    expect(rendered.main).toMatch(/data-conversation-chat-input[^>]*readonly/);
    expect(rendered.main).toContain("Enter 发送，Shift+Enter 换行");
  });

  it("keeps the responsive and reduced-motion contract scoped to the private slice", () => {
    expect(conversationChatCss).toContain("@media (max-width: 1279px)");
    expect(conversationChatCss).toContain("@media (max-width: 1024px)");
    expect(conversationChatCss).toContain("@media (max-width: 768px)");
    expect(conversationChatCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(conversationChatCss).toContain("overflow-wrap: anywhere");
    expect(conversationChatCss).toContain("focus-visible");
    expect(conversationChatCss).not.toContain("background-image: url(");
  });
});
