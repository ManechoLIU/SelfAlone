import { describe, expect, it } from "vitest";
import {
  chooseConversationForTextReaderHandoff,
  createTextReaderChatHandoffStore,
  deriveTextReaderChatNoteIntent,
  formatTextReaderChatDraft,
  resolveTextReaderChatDraftAfterSend,
  type TextReaderChatHandoff,
} from "./text-reader-chat-handoff";
import { createConversationChatController } from "./conversation-chat-controller";
import type { ConversationChatSendResult, ConversationChatSession } from "./conversation-chat-state";
import type { ConversationNoteIntent } from "@selfalone/contracts";

const handoff: TextReaderChatHandoff = {
  quote: "灯塔亮了，海风从窗边经过。",
  bookId: "book-7",
  bookTitle: "雨后山亭",
  author: "林野",
  location: {
    sectionId: "epub:two",
    fileVersion: 2,
    start: 3,
    end: 15,
    sectionTitle: "山路尽头",
    sectionOrder: 1,
  },
};

function session(id: string): ConversationChatSession {
  return {
    id,
    revision: 1,
    draft: null,
    context: [],
    activeRun: null,
    tasks: [],
    works: [],
    deleted: false,
  };
}

function sessionWithRetry(draft: string): ConversationChatSession {
  return {
    ...session("conversation-a"),
    revision: 4,
    draft: { text: draft, attachments: [] },
    context: [{ id: "request-failed:user", role: "user", text: draft, requestId: "request-failed" }],
  };
}

function sessionWithRetryResult(draft: string, requestId: string): ConversationChatSession {
  return {
    ...session("conversation-a"),
    revision: 5,
    context: [
      { id: `${requestId}:user`, role: "user", text: draft, requestId },
      { id: `${requestId}:assistant`, role: "assistant", text: "已收到。", requestId },
    ],
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("text reader chat handoff", () => {
  it("formats the exact quote with book identity and author for an editable composer", () => {
    const draft = formatTextReaderChatDraft(handoff);

    expect(draft).toContain(handoff.quote);
    expect(draft).toContain(handoff.bookId);
    expect(draft).toContain(`《${handoff.bookTitle}》`);
    expect(draft).toContain(handoff.author);
    expect(draft.match(new RegExp(handoff.quote, "g"))).toHaveLength(1);
  });

  it("derives a create intent from an explicit positive request and exact reader source only", () => {
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const expected = {
      kind: "create" as const,
      bookId: handoff.bookId,
      source: {
        locator: {
          kind: "text" as const,
          fileVersion: handoff.location.fileVersion,
          sectionId: handoff.location.sectionId,
          offset: handoff.location.start,
        },
        endOffset: handoff.location.end,
        quote: handoff.quote,
      },
    };

    expect(deriveTextReaderChatNoteIntent(handoff, `${handoffDraft}请整理成笔记`)).toEqual(expected);
    expect(deriveTextReaderChatNoteIntent(handoff, `${handoffDraft}请整理为笔记`)).toEqual(expected);
    expect(deriveTextReaderChatNoteIntent(handoff, `${handoffDraft}请解释这段话`)).toBeUndefined();
    expect(deriveTextReaderChatNoteIntent(handoff, `${handoffDraft}不要整理成笔记`)).toBeUndefined();
  });

  it("shows the stable reader section and character range, then keeps it after reload", () => {
    const draft = formatTextReaderChatDraft(handoff);
    const persisted = storage();
    const first = createTextReaderChatHandoffStore("account-a", persisted);
    first.publish(handoff);
    first.claim("conversation-a", draft);

    expect(draft).toContain("第 2 节");
    expect(draft).toContain("山路尽头");
    expect(draft).toContain("第 4–15 字");
    expect(createTextReaderChatHandoffStore("account-a", persisted).active()).toMatchObject({
      handoff: { location: handoff.location },
    });
  });

  it("prefers the conversation active before Reader, then the recent session", () => {
    const sessions = [session("recent"), session("older")];

    expect(chooseConversationForTextReaderHandoff(sessions, "older")?.id).toBe("older");
    expect(chooseConversationForTextReaderHandoff(sessions, "missing")?.id).toBe("recent");
    expect(chooseConversationForTextReaderHandoff([], "missing")).toBeNull();
  });

  it("consumes a handoff once and does not prefill it again after a storage reload", () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore("account-a", persisted);
    first.publish(handoff);

    expect(first.peek()).toEqual(handoff);
    expect(first.consume()).toEqual(handoff);
    expect(first.peek()).toBeNull();

    const refreshed = createTextReaderChatHandoffStore("account-a", persisted);
    expect(refreshed.peek()).toBeNull();
  });

  it("recovers a claimed unsubmitted draft after a fresh store, then clears it after a successful send", async () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore("account-a", persisted);
    const draft = formatTextReaderChatDraft(handoff);
    first.publish(handoff);

    expect(first.claim("conversation-a", draft)).toMatchObject({ conversationId: "conversation-a", draft, handoff });

    const refreshed = createTextReaderChatHandoffStore("account-a", persisted);
    expect(refreshed.draftFor("conversation-a")).toBe(draft);

    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: refreshed.draftFor("conversation-a") ?? undefined,
      onDraftChange: (nextDraft) => refreshed.updateDraft("conversation-a", nextDraft),
      onDraftCommit: () => { refreshed.complete("conversation-a"); },
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return session("conversation-a");
        },
        async sendText(): Promise<ConversationChatSendResult> {
          return {
            status: "completed",
            session: session("conversation-a"),
            reply: "已收到。",
          };
        },
      },
    });

    await controller.hydrate();
    expect(controller.getState().draft).toBe(draft);
    expect(controller.getState().messages).toHaveLength(0);
    await controller.send();

    const afterSend = createTextReaderChatHandoffStore("account-a", persisted);
    expect(afterSend.draftFor("conversation-a")).toBeNull();
  });

  it("retains the note handoff across a failed request and clears it after note success", async () => {
    const persisted = storage();
    const store = createTextReaderChatHandoffStore("account-a", persisted);
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const draft = `${handoffDraft}请整理成笔记`;
    store.publish(handoff);
    store.claim("conversation-a", draft);
    const requests: Array<{ requestId?: string; text: string; noteIntent?: ConversationNoteIntent }> = [];
    let attempts = 0;

    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: draft,
      noteIntentFactory: (text) => deriveTextReaderChatNoteIntent(handoff, text),
      onDraftChange: (nextDraft) => { store.updateDraft("conversation-a", nextDraft); },
      onDraftCommit: (_sentText, noteIntent) => {
        if (noteIntent?.kind === "create") {
          store.complete("conversation-a");
          return undefined;
        }
        return store.draftFor("conversation-a") ?? undefined;
      },
      requestIdFactory: () => "request-note-retry",
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return session("conversation-a");
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string; noteIntent?: ConversationNoteIntent }): Promise<ConversationChatSendResult> {
          requests.push({ ...input });
          attempts += 1;
          if (attempts === 1) {
            return {
              status: "failed",
              session: sessionWithRetry(draft),
              errorCode: "NOTE_SAVE_FAILED",
              retainedDraft: { text: draft, attachments: [] },
            };
          }
          return {
            status: "completed",
            session: sessionWithRetryResult(draft, input.requestId ?? "request-note-retry"),
            reply: "已整理。",
          };
        },
      },
    });

    await controller.hydrate();
    await controller.send();

    expect(store.active()).toMatchObject({
      conversationId: "conversation-a",
      draft,
      handoff,
    });
    expect(controller.getState()).toMatchObject({ draft, status: "error" });

    await controller.send();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]?.noteIntent).toMatchObject({
      kind: "create",
      bookId: handoff.bookId,
      source: {
        locator: {
          kind: "text",
          fileVersion: handoff.location.fileVersion,
          sectionId: handoff.location.sectionId,
          offset: handoff.location.start,
        },
        endOffset: handoff.location.end,
        quote: handoff.quote,
      },
    });
    expect(store.active()).toBeNull();
  });

  it("keeps handoff context after an ordinary success so a refreshed conversation can create a note", async () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore("account-a", persisted);
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const ordinaryDraft = `${handoffDraft}请解释这段话`;
    first.publish(handoff);
    first.claim("conversation-a", ordinaryDraft);

    const ordinaryController = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: ordinaryDraft,
      onDraftChange: (draft) => { first.updateDraft("conversation-a", draft); },
      onDraftCommit: (sentText, noteIntent) => resolveTextReaderChatDraftAfterSend(
        first,
        "conversation-a",
        ordinaryDraft,
        sentText,
        noteIntent,
      ),
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return session("conversation-a");
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
          return {
            status: "completed",
            session: sessionWithRetryResult(input.text, input.requestId ?? "ordinary-request"),
            reply: "已收到。",
          };
        },
      },
    });

    await ordinaryController.hydrate();
    await ordinaryController.send();

    expect(ordinaryController.getState().draft).toBe("");
    expect(first.active()).toMatchObject({ handoff, conversationId: "conversation-a", draft: "" });

    const refreshed = createTextReaderChatHandoffStore("account-a", persisted);
    expect(refreshed.active()).toMatchObject({ handoff, conversationId: "conversation-a", draft: "" });
    const requests: Array<{ requestId?: string; text: string; noteIntent?: ConversationNoteIntent }> = [];
    const followup = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: refreshed.draftFor("conversation-a") ?? undefined,
      noteIntentFactory: (text) => deriveTextReaderChatNoteIntent(handoff, text),
      onDraftChange: (draft) => { refreshed.updateDraft("conversation-a", draft); },
      onDraftCommit: (sentText, noteIntent) => resolveTextReaderChatDraftAfterSend(
        refreshed,
        "conversation-a",
        "",
        sentText,
        noteIntent,
      ),
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return session("conversation-a");
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string; noteIntent?: ConversationNoteIntent }): Promise<ConversationChatSendResult> {
          requests.push({ ...input });
          return {
            status: "completed",
            session: sessionWithRetryResult(input.text, input.requestId ?? "note-request"),
            reply: "已整理。",
          };
        },
      },
      requestIdFactory: () => "note-request",
    });

    await followup.hydrate();
    expect(followup.getState().draft).toBe("");
    expect(requests).toHaveLength(0);

    followup.setDraft("整理成笔记");
    expect(requests).toHaveLength(0);
    expect(refreshed.draftFor("conversation-a")).toBe("整理成笔记");
    await followup.send();

    expect(requests[0]).toMatchObject({
      requestId: "note-request",
      text: "整理成笔记",
      noteIntent: {
        kind: "create",
        bookId: handoff.bookId,
        source: {
          locator: {
            kind: "text",
            fileVersion: handoff.location.fileVersion,
            sectionId: handoff.location.sectionId,
            offset: handoff.location.start,
          },
          endOffset: handoff.location.end,
          quote: handoff.quote,
        },
      },
    });
    expect(refreshed.active()).toBeNull();
  });

  it("keeps the Reader handoff when a server retry draft is hydrated and sent", async () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore("account-a", persisted);
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const serverDraft = "发送失败后保留的原文";
    first.publish(handoff);
    first.claim("conversation-a", handoffDraft);

    const refreshed = createTextReaderChatHandoffStore("account-a", persisted);
    const requests: string[] = [];
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: refreshed.draftFor("conversation-a") ?? undefined,
      onDraftChange: (nextDraft) => { refreshed.updateDraft("conversation-a", nextDraft); },
      onDraftCommit: (sentText: string) => {
        const currentDraft = refreshed.draftFor("conversation-a") ?? handoffDraft;
        if (sentText === currentDraft) {
          refreshed.complete("conversation-a");
          return undefined;
        }
        return currentDraft;
      },
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return sessionWithRetry(serverDraft);
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
          requests.push(`${input.requestId}:${input.text}`);
          return {
            status: "completed",
            session: sessionWithRetryResult(serverDraft, input.requestId ?? "request-failed"),
            reply: "已收到。",
          };
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
    expect(refreshed.draftFor("conversation-a")).toBe(handoffDraft);

    await controller.send();

    expect(requests).toEqual(["request-failed:发送失败后保留的原文"]);
    expect(controller.getState()).toMatchObject({
      draft: handoffDraft,
      status: "idle",
    });
    expect(controller.getState().messages).toHaveLength(2);
    expect(refreshed.draftFor("conversation-a")).toBe(handoffDraft);
  });

  it("does not expose an unsubmitted account A handoff to account B", () => {
    const persisted = storage();
    const accountA = createTextReaderChatHandoffStore("account-a", persisted);
    const accountB = createTextReaderChatHandoffStore("account-b", persisted);

    accountA.publish(handoff);

    expect(accountB.peek()).toBeNull();
    expect(accountB.claim("conversation-b", formatTextReaderChatDraft(handoff))).toBeNull();
    expect(accountB.updateDraft("conversation-a", "账户 B 不应覆盖")).toBe(false);
    expect(accountB.complete("conversation-a")).toBe(false);
    expect(accountA.peek()).toEqual(handoff);
    expect(createTextReaderChatHandoffStore("account-a", persisted).peek()).toEqual(handoff);
  });

  it("clears the Reader handoff after sending an edited handoff draft", async () => {
    const persisted = storage();
    const store = createTextReaderChatHandoffStore("account-a", persisted);
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const editedDraft = `${handoffDraft}我的问题是：这句话让我想到了什么？`;
    store.publish(handoff);
    store.claim("conversation-a", handoffDraft);

    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: handoffDraft,
      onDraftChange: (draft) => { store.updateDraft("conversation-a", draft); },
      onDraftCommit: (sentText) => {
        const currentDraft = store.draftFor("conversation-a") ?? handoffDraft;
        if (sentText === currentDraft) {
          store.complete("conversation-a");
          return undefined;
        }
        return currentDraft;
      },
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return session("conversation-a");
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
          return {
            status: "completed",
            session: {
              ...session("conversation-a"),
              revision: 2,
              context: [{ id: `${input.requestId}:user`, role: "user", text: input.text, requestId: input.requestId }],
            },
            reply: "已收到。",
          };
        },
      },
    });

    await controller.hydrate();
    controller.setDraft(editedDraft);
    await controller.send();

    expect(store.draftFor("conversation-a")).toBeNull();
    expect(controller.getState().draft).toBe("");
  });

  it("does not persist edits to a server retry draft over the Reader handoff", async () => {
    const persisted = storage();
    const store = createTextReaderChatHandoffStore("account-a", persisted);
    const handoffDraft = formatTextReaderChatDraft(handoff);
    const serverDraft = "服务端保留的失败问题";
    const editedServerDraft = `${serverDraft}（用户修改）`;
    store.publish(handoff);
    store.claim("conversation-a", handoffDraft);

    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: handoffDraft,
      onDraftChange: (draft) => { store.updateDraft("conversation-a", draft); },
      onDraftCommit: (sentText) => {
        const currentDraft = store.draftFor("conversation-a") ?? handoffDraft;
        if (sentText === currentDraft) {
          store.complete("conversation-a");
          return undefined;
        }
        return currentDraft;
      },
      client: {
        async getSession(): Promise<ConversationChatSession> {
          return sessionWithRetry(serverDraft);
        },
        async sendText(_conversationId: string, input: { requestId?: string; text: string }): Promise<ConversationChatSendResult> {
          return {
            status: "completed",
            session: {
              ...session("conversation-a"),
              revision: 5,
              context: [{ id: `${input.requestId}:user`, role: "user", text: input.text, requestId: input.requestId }],
            },
            reply: "已收到。",
          };
        },
      },
    });

    await controller.hydrate();
    controller.setDraft(editedServerDraft);

    expect(store.draftFor("conversation-a")).toBe(handoffDraft);
    await controller.send();

    expect(controller.getState().draft).toBe(handoffDraft);
    expect(store.draftFor("conversation-a")).toBe(handoffDraft);
  });

  it("keeps an initial handoff draft when conversation hydration fails without auto-sending", async () => {
    let sends = 0;
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: formatTextReaderChatDraft(handoff),
      client: {
        async getSession(): Promise<ConversationChatSession> {
          throw new Error("HYDRATE_FAILED");
        },
        async sendText(): Promise<never> {
          sends += 1;
          throw new Error("NOT_EXPECTED");
        },
      },
    });

    await controller.hydrate();

    expect(sends).toBe(0);
    expect(controller.getState()).toMatchObject({
      draft: formatTextReaderChatDraft(handoff),
      status: "error",
    });
  });
});
