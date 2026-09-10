import { randomUUID } from "node:crypto";
import { isPptTemplateId, type PptTemplateId } from "@selfalone/contracts";

export type PptDraftStage = "requirements" | "outline" | "template" | "submitted";

export interface PptDraft {
  stage: PptDraftStage;
  version: number;
  templateId?: PptTemplateId | null;
}

export type PptOutlineLevel = 1 | 2 | 3;

export type PptOutlineStructureNode = {
  level: PptOutlineLevel;
};

export type PptTaskStatus = "queued" | "running" | "stopped" | "completed" | "failed";

export interface PptTask {
  id: string;
  draftId: string;
  idempotencyKey: string;
  status: PptTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
}

const nextStage: Partial<Record<PptDraftStage, PptDraftStage>> = {
  requirements: "outline",
  outline: "template",
  template: "submitted",
};

export function advanceDraft(
  draft: PptDraft,
  targetStage: PptDraftStage,
  expectedVersion: number,
): PptDraft {
  if (draft.version !== expectedVersion) {
    throw new Error("STALE_VERSION");
  }

  if (nextStage[draft.stage] !== targetStage) {
    throw new Error("INVALID_STAGE_TRANSITION");
  }

  return {
    stage: targetStage,
    version: draft.version + 1,
  };
}

export function confirmOutlineToTemplate(
  draft: PptDraft,
  expectedVersion: number,
  outline: readonly PptOutlineStructureNode[],
): PptDraft {
  assertIncrementableDraftVersion(draft, expectedVersion);
  if (draft.stage !== "requirements" && draft.stage !== "outline") {
    throw new Error("INVALID_STAGE_TRANSITION");
  }
  if (!isConfirmableOutline(outline)) {
    throw new Error("INVALID_OUTLINE");
  }

  return {
    stage: "template",
    version: draft.version + 1,
  };
}

export function selectDraftTemplate(
  draft: PptDraft,
  expectedVersion: number,
  templateId: string,
): PptDraft {
  assertIncrementableDraftVersion(draft, expectedVersion);
  if (draft.stage !== "template") {
    throw new Error("INVALID_STAGE_TRANSITION");
  }
  if (!isPptTemplateId(templateId)) {
    throw new Error("UNKNOWN_TEMPLATE");
  }

  return {
    stage: "template",
    version: draft.version + 1,
    templateId,
  };
}

export function createTask(
  existingTask: PptTask | undefined,
  draftId: string,
  idempotencyKey: string,
  totalPages: number,
): PptTask {
  if (
    existingTask?.draftId === draftId &&
    existingTask.idempotencyKey === idempotencyKey
  ) {
    return existingTask;
  }

  return {
    id: randomUUID(),
    draftId,
    idempotencyKey,
    status: "queued",
    completedPages: 0,
    totalPages,
    version: 1,
  };
}

export function stopTask(task: PptTask, expectedVersion: number): PptTask {
  if (task.version !== expectedVersion) {
    throw new Error("STALE_VERSION");
  }

  if (task.status !== "queued" && task.status !== "running") {
    return task;
  }

  return {
    ...task,
    status: "stopped",
    version: task.version + 1,
  };
}

function assertIncrementableDraftVersion(draft: PptDraft, expectedVersion: number) {
  if (
    !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 1
    || expectedVersion >= 2_147_483_647
    || draft.version !== expectedVersion
  ) {
    throw new Error("STALE_VERSION");
  }
}

function isConfirmableOutline(outline: readonly PptOutlineStructureNode[]) {
  if (outline.length === 0 || outline[0]?.level !== 1) return false;
  let previousLevel: PptOutlineLevel = 1;
  for (const node of outline) {
    if (node.level > previousLevel + 1) return false;
    previousLevel = node.level;
  }
  return true;
}
