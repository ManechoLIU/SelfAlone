import type { BookSummary } from "../core/library-state";
import type { BookSection } from "../core/reader-state";
import type { DraftStage, TaskStatus } from "../core/ppt-state";

export type DevelopmentState = "normal" | "empty" | "failed" | "loading" | "filtered-empty";
export type ReadingBackground = "light" | "dark";

export type ReadingPosition = {
  sectionId: string;
  offset: number;
  progress: number;
  background: ReadingBackground;
  version: number;
};

export type BookContentItem = {
  id: string;
  body: string;
  quote?: string;
  meta: string;
};

export type PptWork = {
  id: string;
  title: string;
  status: "running" | "completed";
  meta: string;
};

export type BookDetail = {
  book: BookSummary;
  introduction: string;
  sections: BookSection[];
  position: ReadingPosition | null;
  highlights: BookContentItem[];
  notes: BookContentItem[];
  works: PptWork[];
};

export type OutlineNode = {
  level: 1 | 2 | 3;
  text: string;
};

export type PptPreviewPage = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
};

export type PptWorkspace = {
  draftId: string;
  version: number;
  stage: DraftStage;
  bookId: string;
  bookTitle: string;
  purpose: string;
  audience: string;
  pageRange: string;
  extra: string;
  outline: OutlineNode[];
  templateId:
    | "celadon-reading"
    | "editorial-paper"
    | "minimal-ink"
    | "modern-minimal"
    | "reading-notes"
    | "academic-lecture";
  task: null | {
    status: TaskStatus;
    completedPages: number;
    totalPages: number;
    error?: string;
  };
  previews: PptPreviewPage[];
};

export interface MiniappClient {
  readonly kind: "development" | "unavailable";
  readonly development: boolean;
  listBooks(state?: DevelopmentState): Promise<BookSummary[]>;
  getBook(bookId: string, state?: DevelopmentState): Promise<BookDetail>;
  savePosition(bookId: string, input: Omit<ReadingPosition, "version"> & { expectedVersion: number }): Promise<ReadingPosition>;
  getPptWorkspace(bookId?: string, state?: DevelopmentState): Promise<PptWorkspace>;
  savePptWorkspace(workspace: PptWorkspace): Promise<PptWorkspace>;
}

export class ClientBoundaryError extends Error {
  constructor(readonly code: "CLIENT_ADAPTER_UNAVAILABLE" | "DEVELOPMENT_STATE_FAILURE") {
    super(code === "CLIENT_ADAPTER_UNAVAILABLE"
      ? "真实客户端接口尚未进入当前主线"
      : "开发适配器模拟了可恢复失败");
    this.name = "ClientBoundaryError";
  }
}

export function parseDevelopmentState(
  value: unknown,
  developmentEnabled: boolean,
): DevelopmentState {
  if (!developmentEnabled || typeof value !== "string") return "normal";
  return ["normal", "empty", "failed", "loading", "filtered-empty"].includes(value)
    ? value as DevelopmentState
    : "normal";
}
