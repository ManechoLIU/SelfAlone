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

export type LocalBookFormat = "epub" | "txt" | "pdf";

export type BookParseStatus = "processing" | "ready_text" | "ready_pages" | "failed";

export type LibraryBookSummary = {
  id: string;
  title: string;
  author: string | null;
  format: LocalBookFormat;
  sourceLabel: "本地";
  parseStatus: BookParseStatus;
  errorCode: string | null;
  sectionCount: number;
  pageCount: number | null;
  createdAt: string;
};

export type LibrarySnapshot = {
  books: LibraryBookSummary[];
};
