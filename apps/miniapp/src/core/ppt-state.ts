export type DraftStage = "requirements" | "outline" | "template" | "submitted";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";
export type PptScreen = DraftStage | "generating" | "completed" | "failed" | "stopped";

export type RecoverableWorkspace = {
  draft: { stage: DraftStage };
  task: { status: TaskStatus } | null;
};

export function resolvePptScreen(workspace: RecoverableWorkspace): PptScreen {
  if (workspace.task?.status === "completed") return "completed";
  if (workspace.task?.status === "failed") return "failed";
  if (workspace.task?.status === "stopped") return "stopped";
  if (workspace.task || workspace.draft.stage === "submitted") return "generating";
  return workspace.draft.stage;
}

export function shouldPollTask(task: { status: TaskStatus }) {
  return task.status === "queued" || task.status === "running";
}

export function summarizeTask(task: { status: TaskStatus; completedPages: number; totalPages: number }) {
  if (task.status === "failed" || task.status === "stopped") {
    return `已保留 ${task.completedPages} / ${task.totalPages} 页`;
  }
  return `${task.completedPages} / ${task.totalPages} 页`;
}

export function taskIdempotencyKey(draftId: string, version: number) {
  return `miniapp:task:${draftId}:v${version}`;
}

export function requiresBookContextConfirmation(requestedBookId: string, workspaceBookId: string) {
  return Boolean(requestedBookId) && requestedBookId !== workspaceBookId;
}

export function isOutlineHierarchyValid(outline: Array<{ level: 1 | 2 | 3 }>) {
  let hasPage = false;
  let hasSection = false;
  for (const node of outline) {
    if (node.level === 1) {
      hasPage = true;
      hasSection = false;
    } else if (node.level === 2) {
      if (!hasPage) return false;
      hasSection = true;
    } else if (!hasPage || !hasSection) {
      return false;
    }
  }
  return hasPage;
}
