export type DraftStage = "requirements" | "outline" | "template" | "submitted";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type TaskSnapshot = {
  id: string;
  status: TaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string;
  error?: string;
};

export type OutlineItem = {
  title: string;
  body: string;
};

export type WorkspaceSnapshot = {
  book: { id: string; title: string; sourceLabel: string };
  conversation: { id: string };
  draft: {
    id: string;
    stage: DraftStage;
    version: number;
    requirements: string;
    templateId: string | null;
  };
  outline: OutlineItem[];
  task: TaskSnapshot | null;
};

export type WorkspaceScreen =
  | "requirements"
  | "outline"
  | "template"
  | "generating"
  | "completed"
  | "failed"
  | "stopped";

export function resolveScreen(workspace: WorkspaceSnapshot): WorkspaceScreen {
  if (workspace.task?.status === "completed") {
    return "completed";
  }
  if (workspace.task?.status === "failed") {
    return "failed";
  }
  if (workspace.task?.status === "stopped") {
    return "stopped";
  }
  if (workspace.task || workspace.draft.stage === "submitted") {
    return "generating";
  }
  return workspace.draft.stage;
}

export function taskProgressLabel(task: TaskSnapshot) {
  return `${task.completedPages} / ${task.totalPages}`;
}

export function withDraftRequirements(workspace: WorkspaceSnapshot, requirements: string): WorkspaceSnapshot {
  return {
    ...workspace,
    draft: { ...workspace.draft, requirements },
  };
}

export function withDraftOutline(workspace: WorkspaceSnapshot, outline: OutlineItem[]): WorkspaceSnapshot {
  return {
    ...workspace,
    outline: outline.map((page) => ({ ...page })),
  };
}
