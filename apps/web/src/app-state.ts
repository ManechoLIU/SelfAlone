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
  staleTask?: TaskSnapshot;
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

export function outlineDraftStorageKey(draftId: string) {
  return `selfalone:m1:outline-draft:${draftId}`;
}

export function requirementsDraftStorageKey(draftId: string) {
  return `selfalone:m1:requirements-draft:${draftId}`;
}

export function serializeRequirementsDraft(requirements: string) {
  return JSON.stringify({ version: 1, requirements });
}

export function parseRequirementsDraft(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("requirements" in parsed) || typeof parsed.requirements !== "string") {
      return null;
    }
    return parsed.requirements;
  } catch {
    return null;
  }
}

export function conversationHash(stage: WorkspaceScreen | null = null) {
  return stage ? `#/conversation?stage=${encodeURIComponent(stage)}` : "#/conversation";
}

export function stageFromConversationHash(hash: string): WorkspaceScreen | null {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return null;
  const requested = new URLSearchParams(query).get("stage");
  const screens: WorkspaceScreen[] = ["requirements", "outline", "template", "generating", "completed", "failed", "stopped"];
  return requested && screens.includes(requested as WorkspaceScreen) ? requested as WorkspaceScreen : null;
}

export function serializeOutlineDraft(outline: OutlineItem[]) {
  return JSON.stringify({
    version: 1,
    outline: outline.map((page) => ({ title: page.title, body: page.body })),
  });
}

export function parseOutlineDraft(value: string | null): OutlineItem[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("outline" in parsed) || !Array.isArray(parsed.outline)) {
      return null;
    }
    if (parsed.outline.some((page) => (
      !page ||
      typeof page !== "object" ||
      !("title" in page) ||
      !("body" in page) ||
      typeof page.title !== "string" ||
      typeof page.body !== "string"
    ))) {
      return null;
    }
    return parsed.outline.map((page) => ({ title: page.title, body: page.body }));
  } catch {
    return null;
  }
}
