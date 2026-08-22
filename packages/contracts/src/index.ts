export type PptDraftStage = "requirements" | "outline" | "template" | "submitted";

export type PptTaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type PptTaskSnapshot = {
  id: string;
  status: PptTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string;
};
