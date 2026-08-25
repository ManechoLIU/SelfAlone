import { describe, expect, it } from "vitest";
import {
  canConfirmSelection,
  completeConversationSend,
  createConversationLocalStore,
  developmentConversationReply,
  developmentConversationId,
  failConversationSend,
  preserveConversationFailure,
  selectionOptionsFor,
  selectionSummary,
  startConversationSend,
  toggleSelectionId,
} from "./page-state";

describe("conversation selection and local recovery state", () => {
  it("requires one scope and derives the summary in the displayed order", () => {
    expect(canConfirmSelection([])).toBe(false);
    expect(toggleSelectionId(["full-book"], "highlights")).toEqual(["full-book", "highlights"]);
    expect(selectionSummary(["notes", "full-book"])).toBe("全书、老己笔记");
    expect(selectionOptionsFor(["notes"])).toEqual([
      { id: "full-book", label: "全书", checked: false },
      { id: "highlights", label: "我的划线与想法", checked: false },
      { id: "notes", label: "老己笔记", checked: true },
    ]);
  });

  it("restores the current conversation draft, pending scope, and confirmation boundary locally", () => {
    let saved: unknown;
    const storage = {
      get: () => saved,
      set: (_key: string, value: unknown) => { saved = value; },
    };
    const store = createConversationLocalStore(storage, true);
    store.save({
      version: 1,
      conversationId: developmentConversationId,
      intentTaskId: "development-ppt-book",
      draft: "保留这段补充要求",
      attachmentPaths: ["wxfile://one"],
      selectionDraftIds: ["full-book", "notes"],
      confirmedSelectionIds: ["full-book"],
      selectionSheetOpen: false,
      messages: [],
      pendingSend: null,
    });

    expect(store.restore()).toEqual({
      version: 1,
      conversationId: developmentConversationId,
      intentTaskId: "development-ppt-book",
      draft: "保留这段补充要求",
      attachmentPaths: ["wxfile://one"],
      selectionDraftIds: ["full-book", "notes"],
      confirmedSelectionIds: ["full-book"],
      selectionSheetOpen: false,
      messages: [],
      pendingSend: null,
    });
  });

  it("keeps input and the in-progress selection when a send or confirmation fails", () => {
    expect(preserveConversationFailure({
      draft: "不要丢掉这段话",
      attachmentPaths: ["wxfile://one", "wxfile://two"],
      selectionDraftIds: ["full-book", "notes"],
      confirmedSelectionIds: ["full-book"],
    }, "暂时无法发送")).toEqual({
      draft: "不要丢掉这段话",
      attachmentPaths: ["wxfile://one", "wxfile://two"],
      selectionDraftIds: ["full-book", "notes"],
      confirmedSelectionIds: ["full-book"],
      boundaryMessage: "暂时无法发送",
    });
  });

  it("uses one pending id and one assistant reply when a send is retried", () => {
    const started = startConversationSend([], null, "保留这句话", ["wxfile://one"]);
    const failed = failConversationSend(started.messages, started.pendingSend.id);
    const retried = startConversationSend(
      failed,
      started.pendingSend,
      "保留这句话",
      ["wxfile://one"],
    );
    const completed = completeConversationSend(
      retried.messages,
      retried.pendingSend,
      developmentConversationReply(retried.pendingSend),
    );
    const completedAgain = completeConversationSend(
      completed,
      retried.pendingSend,
      developmentConversationReply(retried.pendingSend),
    );

    expect(retried.pendingSend.id).toBe(started.pendingSend.id);
    expect(retried.messages).toHaveLength(1);
    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({ id: started.pendingSend.id, status: "sent" });
    expect(completed[1]).toMatchObject({
      role: "assistant",
      replyTo: started.pendingSend.id,
      text: "我收到这条消息了，我们可以继续聊下去。",
    });
    expect(completedAgain).toEqual(completed);
  });

  it("keeps attachment-only replies neutral about image contents", () => {
    expect(developmentConversationReply({
      id: "conversation-send-1",
      draft: "",
      attachmentPaths: ["wxfile://one"],
    })).toBe("图片已经收到，你可以继续补充想聊的内容。");
  });
});
