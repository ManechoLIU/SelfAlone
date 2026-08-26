import { describe, expect, it } from "vitest";
import {
  createConversationResponder,
  createDevelopmentConversationResponder,
  type ChatInput,
  type ChatResponderPort,
} from "./conversation-responder";

describe("conversation responder contract", () => {
  it("forwards the message and every context entry to TextModelAdapter.chat", async () => {
    let received: ChatInput | undefined;
    let receivedSignal: AbortSignal | undefined;
    const adapter: ChatResponderPort = {
      async chat(input, signal) {
        received = input;
        receivedSignal = signal;
        return { text: "来自模型适配器" };
      },
    };
    const responder = createConversationResponder(adapter);
    const context = [
      { id: "user-1", role: "user" as const, text: "先前的问题", requestId: "request-1" },
      { id: "assistant-1", role: "assistant" as const, text: "先前的回答", requestId: "request-1" },
    ];

    await expect(responder("当前的问题", context)).resolves.toBe("来自模型适配器");
    expect(received).toEqual({ text: "当前的问题", context });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it("makes the explicit development fake depend on the complete context", async () => {
    const responder = createDevelopmentConversationResponder();
    const priorText = "旧上下文是一段不应被逐字复述的阅读讨论";
    const withoutHistory = await responder("同一个问题", []);
    const withHistory = await responder("同一个问题", [
      { id: "user-1", role: "user", text: priorText, requestId: "request-1" },
    ]);

    expect(withHistory).not.toBe(withoutHistory);
    expect(withHistory).not.toContain(priorText);
    expect(withHistory).not.toContain("旧上下文");
    expect(withHistory).not.toContain("我先记下");
  });

  it("fails closed when the model adapter is not configured", async () => {
    const responder = createConversationResponder();

    await expect(responder("没有模型", [])).rejects.toThrow(
      "CONVERSATION_RESPONDER_NOT_CONFIGURED",
    );
  });

  it("fails closed when the model adapter returns an empty reply", async () => {
    const responder = createConversationResponder({
      async chat() {
        return { text: "  " };
      },
    });

    await expect(responder("空回复不能提交", [])).rejects.toThrow("CONVERSATION_REPLY_INVALID");
  });
});
