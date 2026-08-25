import { describe, expect, it } from "vitest";
import type {
  ConversationChatSendResult,
  ConversationChatSession,
} from "./conversation-chat-state";
import { createConversationChatController } from "./conversation-chat-controller";

function session(overrides: Partial<ConversationChatSession> = {}): ConversationChatSession {
  return {
    id: "conversation-a",
    revision: 1,
    draft: null,
    context: [],
    activeRun: null,
    tasks: [],
    works: [],
    deleted: false,
    ...overrides,
  };
}

describe("conversation chat controller", () => {
  it("hydrates, sends through the client, and exposes the deterministic reply", async () => {
    let current = session();
    const client = {
      async getSession() {
        return current;
      },
      async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
        current = session({
          revision: 2,
          context: [
            { id: `${input.requestId}:user`, role: "user", text: input.text, requestId: input.requestId },
            { id: `${input.requestId}:assistant`, role: "assistant", text: "我会先把这句话留在当前对话里。", requestId: input.requestId },
          ],
        });
        return {
          status: "completed",
          session: current,
          reply: "我会先把这句话留在当前对话里。",
        };
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-a",
    });

    await controller.hydrate();
    controller.setDraft("请保留这句话");
    await controller.send();

    expect(controller.getState()).toMatchObject({
      conversationId: "conversation-a",
      revision: 2,
      draft: "",
      status: "idle",
      errorCode: null,
      messages: [
        { role: "user", text: "请保留这句话" },
        { role: "assistant", text: "我会先把这句话留在当前对话里。" },
      ],
    });

    const refreshed = createConversationChatController({ conversationId: "conversation-a", client });
    await refreshed.hydrate();
    expect(refreshed.getState().messages).toHaveLength(2);
    expect(refreshed.getState().draft).toBe("");
  });

  it("retains the original draft when the client rejects a send", async () => {
    const client = {
      async getSession() {
        return session();
      },
      async sendText(): Promise<ConversationChatSendResult> {
        throw new Error("network unavailable");
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-error",
    });

    await controller.hydrate();
    controller.setDraft("失败后仍然要看见");
    await controller.send();

    expect(controller.getState()).toMatchObject({
      draft: "失败后仍然要看见",
      status: "error",
      errorCode: "CONVERSATION_REQUEST_FAILED",
    });
  });

  it("does not issue a second request while a send is in flight", async () => {
    let resolveSend: ((result: ConversationChatSendResult) => void) | undefined;
    let sendCount = 0;
    const client = {
      async getSession() {
        return session();
      },
      sendText(): Promise<ConversationChatSendResult> {
        sendCount += 1;
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-busy",
    });

    await controller.hydrate();
    controller.setDraft("只发一次");
    const first = controller.send();
    const second = controller.send();

    expect(controller.getState().status).toBe("sending");
    expect(sendCount).toBe(1);
    expect(await second).toBeUndefined();

    resolveSend?.({
      status: "completed",
      session: session({
        revision: 2,
        context: [{ id: "request-busy:user", role: "user", text: "只发一次" }],
      }),
      reply: "已收到。",
    });
    await first;
    expect(controller.getState().status).toBe("idle");
  });
});
