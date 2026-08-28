import { describe, expect, it } from "vitest";
import {
  chooseConversationForTextReaderHandoff,
  createTextReaderChatHandoffStore,
  formatTextReaderChatDraft,
  type TextReaderChatHandoff,
} from "./text-reader-chat-handoff";
import { createConversationChatController } from "./conversation-chat-controller";
import type { ConversationChatSendResult, ConversationChatSession } from "./conversation-chat-state";

const handoff: TextReaderChatHandoff = {
  quote: "灯塔亮了，海风从窗边经过。",
  bookId: "book-7",
  bookTitle: "雨后山亭",
  author: "林野",
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

  it("prefers the conversation active before Reader, then the recent session", () => {
    const sessions = [session("recent"), session("older")];

    expect(chooseConversationForTextReaderHandoff(sessions, "older")?.id).toBe("older");
    expect(chooseConversationForTextReaderHandoff(sessions, "missing")?.id).toBe("recent");
    expect(chooseConversationForTextReaderHandoff([], "missing")).toBeNull();
  });

  it("consumes a handoff once and does not prefill it again after a storage reload", () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore(persisted);
    first.publish(handoff);

    expect(first.peek()).toEqual(handoff);
    expect(first.consume()).toEqual(handoff);
    expect(first.peek()).toBeNull();

    const refreshed = createTextReaderChatHandoffStore(persisted);
    expect(refreshed.peek()).toBeNull();
  });

  it("recovers a claimed unsubmitted draft after a fresh store, then clears it after a successful send", async () => {
    const persisted = storage();
    const first = createTextReaderChatHandoffStore(persisted);
    const draft = formatTextReaderChatDraft(handoff);
    first.publish(handoff);

    expect(first.claim("conversation-a", draft)).toEqual({ conversationId: "conversation-a", draft });

    const refreshed = createTextReaderChatHandoffStore(persisted);
    expect(refreshed.draftFor("conversation-a")).toBe(draft);

    const controller = createConversationChatController({
      conversationId: "conversation-a",
      initialDraft: refreshed.draftFor("conversation-a") ?? undefined,
      onDraftChange: (nextDraft) => refreshed.updateDraft("conversation-a", nextDraft),
      onDraftCommit: () => refreshed.complete("conversation-a"),
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

    const afterSend = createTextReaderChatHandoffStore(persisted);
    expect(afterSend.draftFor("conversation-a")).toBeNull();
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
