import { describe, expect, it } from "vitest";
import { resolveScreen, taskProgressLabel, withDraftRequirements, type WorkspaceSnapshot } from "./app-state";

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
});
