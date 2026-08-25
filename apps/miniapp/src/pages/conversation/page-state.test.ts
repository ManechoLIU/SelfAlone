import { describe, expect, it } from "vitest";
import {
  canConfirmSelection,
  createConversationLocalStore,
  developmentConversationId,
  preserveConversationFailure,
  selectionOptionsFor,
  selectionSummary,
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
});
