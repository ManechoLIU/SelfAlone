import { describe, expect, it } from "vitest";
import type {
  ConversationChatSendResult,
  ConversationChatSession,
} from "./conversation-chat-state";
import type { ConversationNoteIntent } from "@selfalone/contracts";
import { createConversationChatController } from "./conversation-chat-controller";

const pptWorkspace = {
  draft: {
    id: "draft-1",
    conversationId: "conversation-a",
    stage: "requirements" as const,
    version: 1,
    requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" },
  },
  sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }] as const,
};

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
  it("creates the book PPT workspace only after its positive user message is persisted", async () => {
    const created: Array<{ conversationId: string; requestId: string; bookId: string }> = [];
    const requestBodies: Array<{ requestId: string; bookId: string }> = [];
    const callbacks: Array<{ conversationId: string; requestId: string; bookId: string }> = [];
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        async getSession() { return session(); },
        async sendText(_conversationId, input) {
          return { status: "completed" as const, session: session({
            revision: 2,
            context: [{ id: `${input.requestId}:user`, role: "user", text: input.text, requestId: input.requestId }],
          }), reply: "已收到。" };
        },
      },
      requestIdFactory: () => "request-ppt",
      pptBookEntry: { bookId: "book-1" },
      pptWorkspaceClient: {
        async createOrReuse(conversationId, input) {
          created.push({ conversationId, ...input });
          requestBodies.push(input);
          return { status: "created" as const, workspace: pptWorkspace };
        },
      },
      onPptWorkspaceCreated: (_result, context) => callbacks.push(context),
    });

    controller.setDraft("帮我制作这本书PPT");
    expect(created).toEqual([]);
    await controller.send();
    expect(created).toEqual([{ conversationId: "conversation-a", requestId: "request-ppt", bookId: "book-1" }]);
    expect(requestBodies).toEqual([{ requestId: "request-ppt", bookId: "book-1" }]);
    expect(callbacks).toEqual([{ conversationId: "conversation-a", requestId: "request-ppt", bookId: "book-1" }]);
  });

  it("does not create a book PPT workspace when the user send fails", async () => {
    let created = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        async getSession() { return session(); },
        async sendText() { return { status: "failed" as const, session: session(), errorCode: "SEND_FAILED", retainedDraft: { text: "帮我制作这本书PPT", attachments: [] } }; },
      },
      requestIdFactory: () => "request-ppt",
      pptBookEntry: { bookId: "book-1" },
      pptWorkspaceClient: { async createOrReuse() { created += 1; return { status: "created" as const, workspace: pptWorkspace }; } },
    });

    controller.setDraft("帮我制作这本书PPT");
    await controller.send();
    expect(created).toBe(0);
  });

  it.each([
    [undefined, "帮我制作这本书PPT"],
    [{ bookId: "book-1" }, "我暂时不想制作这本书PPT"],
  ] as const)("does not create a workspace without a positive book PPT intent", async (pptBookEntry, text) => {
    let created = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        async getSession() { return session(); },
        async sendText(_conversationId, input) {
          return { status: "completed" as const, session: session({ revision: 2, context: [{ id: "user-1", role: "user", text: input.text }] }), reply: "已收到。" };
        },
      },
      pptBookEntry,
      pptWorkspaceClient: { async createOrReuse() { created += 1; return { status: "created" as const, workspace: pptWorkspace }; } },
    });

    controller.setDraft(text);
    await controller.send();

    expect(created).toBe(0);
  });

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

  it("derives a note intent once and reuses it with the request id for an unchanged retry", async () => {
    const noteIntent: ConversationNoteIntent = {
      kind: "create",
      bookId: "book-7",
      source: {
        locator: {
          kind: "text",
          fileVersion: 2,
          sectionId: "epub:two",
          offset: 3,
        },
        endOffset: 15,
        quote: "灯塔亮了，海风从窗边经过。",
      },
    };
    const requests: Array<{ requestId?: string; text: string; noteIntent?: ConversationNoteIntent }> = [];
    let attempts = 0;
    const text = "来自《雨后山亭》的原文\n请整理成笔记";
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        async getSession() {
          return session();
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string; noteIntent?: ConversationNoteIntent }): Promise<ConversationChatSendResult> {
          requests.push(input);
          attempts += 1;
          if (attempts === 1) {
            return {
              status: "failed",
              session: session({ revision: 2, draft: { text, attachments: [] } }),
              errorCode: "NOTE_SAVE_FAILED",
              retainedDraft: { text, attachments: [] },
            };
          }
          return {
            status: "completed",
            session: session({ revision: 3 }),
            reply: "已整理。",
          };
        },
      },
      requestIdFactory: () => "request-note",
      noteIntentFactory: () => noteIntent,
    });

    controller.setDraft(text);
    await controller.send();
    expect(controller.getState()).toMatchObject({
      draft: text,
      status: "error",
      retryRequestId: "request-note",
    });

    await controller.send();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]).toMatchObject({ requestId: "request-note", text, noteIntent });
  });

  it("keeps an existing server retry draft instead of replacing it with a Reader handoff", async () => {
    const handoffDraft = "来自《雨后山亭》的原文：\n“灯塔亮了，海风从窗边经过。”\n\n";
    const serverDraft = "发送失败后保留的原文";
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: handoffDraft,
      client: {
        async getSession() {
          return session({
            revision: 4,
            draft: { text: serverDraft, attachments: [] },
            context: [{ id: "request-failed:user", role: "user", text: serverDraft, requestId: "request-failed" }],
          });
        },
        async sendText(): Promise<ConversationChatSendResult> {
          throw new Error("NOT_EXPECTED");
        },
      },
    });

    await controller.hydrate();

    expect(controller.getState()).toMatchObject({
      draft: serverDraft,
      retryRequestId: "request-failed",
      retryText: serverDraft,
      status: "idle",
    });
  });

  it("reuses a failed request id only while the retained draft is unchanged", async () => {
    const requestIds: string[] = [];
    const client = {
      async getSession() {
        return session();
      },
      async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
        requestIds.push(`${input.requestId}:${input.text}`);
        throw new Error("network unavailable");
      },
    };
    let nextRequestId = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => `request-${++nextRequestId}`,
    });

    controller.setDraft("第一次输入");
    await controller.send();
    controller.setDraft("修改后的输入");
    await controller.send();
    await controller.send();

    expect(requestIds).toEqual([
      "request-1:第一次输入",
      "request-2:修改后的输入",
      "request-2:修改后的输入",
    ]);
  });

  it("allocates a fresh request id when the user re-enters text after completion", async () => {
    const requestIds: string[] = [];
    const client = {
      async getSession() {
        return session();
      },
      async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
        requestIds.push(`${input.requestId}:${input.text}`);
        return {
          status: "completed",
          session: session({
            revision: requestIds.length + 1,
            context: [
              { id: `${input.requestId}:user`, role: "user", text: input.text, requestId: input.requestId },
              { id: `${input.requestId}:assistant`, role: "assistant", text: "已收到。", requestId: input.requestId },
            ],
          }),
          reply: "已收到。",
        };
      },
    };
    let nextRequestId = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => `request-${++nextRequestId}`,
    });

    controller.setDraft("同一段话");
    await controller.send();
    controller.setDraft("同一段话");
    await controller.send();

    expect(requestIds).toEqual(["request-1:同一段话", "request-2:同一段话"]);
  });

  it("ignores draft edits while sending and retries the retained text with its original id", async () => {
    const requestIds: string[] = [];
    let rejectSend: ((error: Error) => void) | undefined;
    const client = {
      async getSession() {
        return session();
      },
      sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
        requestIds.push(`${input.requestId}:${input.text}`);
        return new Promise((_, reject) => {
          rejectSend = reject;
        });
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-in-flight",
    });

    controller.setDraft("发送中的原文");
    const first = controller.send();
    controller.setDraft("不应写入的改动");

    expect(controller.getState()).toMatchObject({
      draft: "发送中的原文",
      status: "sending",
      retryRequestId: "request-in-flight",
      retryText: "发送中的原文",
    });

    rejectSend?.(new Error("network unavailable"));
    await first;
    expect(controller.getState()).toMatchObject({
      draft: "发送中的原文",
      status: "error",
      retryRequestId: "request-in-flight",
    });

    const second = controller.send();
    expect(requestIds).toEqual([
      "request-in-flight:发送中的原文",
      "request-in-flight:发送中的原文",
    ]);
    rejectSend?.(new Error("network unavailable"));
    await second;
  });

  it("does not let a stale hydrate success overwrite a local send", async () => {
    let resolveHydrate: ((value: ConversationChatSession) => void) | undefined;
    let rejectSend: ((error: Error) => void) | undefined;
    const client = {
      getSession() {
        return new Promise<ConversationChatSession>((resolve) => {
          resolveHydrate = resolve;
        });
      },
      sendText(): Promise<ConversationChatSendResult> {
        return new Promise((_, reject) => {
          rejectSend = reject;
        });
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-local",
    });

    const hydrating = controller.hydrate();
    controller.setDraft("本地发送内容");
    const sending = controller.send();
    resolveHydrate?.(session({ revision: 2, draft: null, context: [] }));
    await hydrating;

    expect(controller.getState()).toMatchObject({
      draft: "本地发送内容",
      status: "sending",
      retryRequestId: "request-local",
      retryText: "本地发送内容",
    });

    rejectSend?.(new Error("network unavailable"));
    await sending;
  });

  it("does not let a stale hydrate failure overwrite a local send", async () => {
    let rejectHydrate: ((error: Error) => void) | undefined;
    let rejectSend: ((error: Error) => void) | undefined;
    const client = {
      getSession() {
        return new Promise<ConversationChatSession>((_, reject) => {
          rejectHydrate = reject;
        });
      },
      sendText(): Promise<ConversationChatSendResult> {
        return new Promise((_, reject) => {
          rejectSend = reject;
        });
      },
    };
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client,
      requestIdFactory: () => "request-local",
    });

    const hydrating = controller.hydrate();
    controller.setDraft("本地失败内容");
    const sending = controller.send();
    rejectHydrate?.(new Error("stale hydrate failure"));
    await hydrating;

    expect(controller.getState()).toMatchObject({
      draft: "本地失败内容",
      status: "sending",
      retryRequestId: "request-local",
      retryText: "本地失败内容",
    });

    rejectSend?.(new Error("network unavailable"));
    await sending;
  });

  it("restores an active server run as a sending lock", async () => {
    let sendCount = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        async getSession() {
          return session({
            revision: 3,
            draft: { text: "服务端正在处理", attachments: [] },
            context: [{ id: "request-active:user", role: "user", text: "服务端正在处理", requestId: "request-active" }],
            activeRun: {
              requestId: "request-active",
              kind: "response",
              status: "running",
              startedRevision: 3,
            },
          });
        },
        async sendText(): Promise<ConversationChatSendResult> {
          sendCount += 1;
          throw new Error("should remain locked");
        },
      },
      requestIdFactory: () => "request-new",
    });

    await controller.hydrate();
    expect(controller.getState()).toMatchObject({
      draft: "服务端正在处理",
      status: "sending",
      retryRequestId: "request-active",
    });
    await controller.send();
    expect(sendCount).toBe(0);
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
