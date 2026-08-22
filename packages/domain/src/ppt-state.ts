import { randomUUID } from "node:crypto";

export type PptDraftStage = "requirements" | "outline" | "template" | "submitted";

export interface PptDraft {
  stage: PptDraftStage;
  version: number;
}

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
