import { describe, expect, it } from "vitest";
import {
  conversationHash,
  outlineDraftStorageKey,
  parseOutlineDraft,
  serializeOutlineDraft,
  requirementsDraftStorageKey,
  serializeRequirementsDraft,
  parseRequirementsDraft,
  resolveScreen,
  stageFromConversationHash,
  taskProgressLabel,
  withDraftOutline,
  withDraftRequirements,
  type WorkspaceSnapshot,
} from "./app-state";

const workspace: WorkspaceSnapshot = {
  book: { id: "book-1", title: "长安的荔枝", sourceLabel: "开发种子书" },
  conversation: { id: "conversation-1" },
  draft: {
    id: "draft-1",
    stage: "requirements",
    version: 1,
    requirements: "",
    templateId: null,
  },
  outline: [],
  task: null,
};

describe("M0 workspace screen", () => {
  it("restores the submitted task screen instead of restarting the flow", () => {
    expect(
      resolveScreen({
        ...workspace,
        draft: { ...workspace.draft, stage: "submitted", version: 4 },
        task: {
          id: "task-1",
          status: "running",
          completedPages: 2,
          totalPages: 3,
          version: 4,
        },
      }),
    ).toBe("generating");
  });

  it("shows completion and an exact compact page count", () => {
    const task = {
      id: "task-1",
      status: "completed" as const,
      completedPages: 3,
      totalPages: 3,
      version: 5,
      artifactId: "artifact-1",
    };
    expect(resolveScreen({ ...workspace, task })).toBe("completed");
    expect(taskProgressLabel(task)).toBe("3 / 3");
  });

  it("keeps unsaved requirements isolated from the server snapshot", () => {
    const retained = withDraftRequirements(workspace, "离线时仍要保留这段输入");

    expect(retained.draft.requirements).toBe("离线时仍要保留这段输入");
    expect(workspace.draft.requirements).toBe("");
  });

  it("keeps unsaved outline edits isolated from the server snapshot", () => {
    const retained = withDraftOutline(workspace, [{ title: "离线保留", body: "重连前不丢失" }]);

    expect(retained.outline).toEqual([{ title: "离线保留", body: "重连前不丢失" }]);
    expect(workspace.outline).toEqual([]);
  });

  it("round-trips an outline draft through the explicit local recovery format", () => {
    expect(outlineDraftStorageKey("draft-1")).toBe("selfalone:m1:outline-draft:draft-1");
    const outline = [{ title: "本地标题", body: "刷新前仍要保留" }];
    const encoded = serializeOutlineDraft(outline);
    expect(parseOutlineDraft(encoded)).toEqual(outline);
    expect(parseOutlineDraft('{"version":1,"outline":[{"title":7,"body":"不合法"}]}')).toBeNull();
  });

  it("round-trips requirements drafts and preserves explicit conversation stage routes", () => {
    expect(requirementsDraftStorageKey("draft-1")).toBe("selfalone:m1:requirements-draft:draft-1");
    expect(parseRequirementsDraft(serializeRequirementsDraft("刷新后仍保留"))).toBe("刷新后仍保留");
    expect(parseRequirementsDraft('{"version":1,"requirements":7}')).toBeNull();

    expect(conversationHash("outline")).toBe("#/conversation?stage=outline");
    expect(stageFromConversationHash("#/conversation?stage=outline")).toBe("outline");
    expect(stageFromConversationHash("#/library")).toBeNull();
    expect(stageFromConversationHash("#/conversation?stage=unknown")).toBeNull();
  });
});
