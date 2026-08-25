import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createConversationChatState, updateConversationDraft } from "./conversation-chat-state";
import { createConversationChatController } from "./conversation-chat-controller";
import { mountConversationChatView, renderConversationChatView } from "./conversation-chat-view";

const conversationChatCss = readFileSync(new URL("./conversation-chat.css", import.meta.url), "utf8");

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

class FakeMainRoot {
  input = new FakeTextArea();
  form = new FakeForm();
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
    expect(rendered.main).toContain('value="失败后保留"');
    expect(rendered.taskPanel).toBe("");
    expect(rendered.main).not.toContain("示例");
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
