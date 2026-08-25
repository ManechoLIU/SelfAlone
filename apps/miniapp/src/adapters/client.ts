import type { BookSummary } from "../core/library-state";
import type { BookSection } from "../core/reader-state";
import type { DraftStage, TaskStatus } from "../core/ppt-state";

export type DevelopmentState = "normal" | "empty" | "failed" | "loading" | "filtered-empty";
export type ReadingBackground = "light" | "dark";
export type BookListOptions = { query?: string; state?: DevelopmentState };
export type LocalBookFile = { path: string; name: string };

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
  listBooks(options?: BookListOptions | DevelopmentState): Promise<BookSummary[]>;
  importBook(file: LocalBookFile): Promise<BookSummary>;
  getBook(bookId: string, state?: DevelopmentState): Promise<BookDetail>;
  savePosition(bookId: string, input: Omit<ReadingPosition, "version"> & { expectedVersion: number }): Promise<ReadingPosition>;
  getPptWorkspace(bookId?: string, state?: DevelopmentState): Promise<PptWorkspace>;
  savePptWorkspace(workspace: PptWorkspace): Promise<PptWorkspace>;
}

export type ClientBoundaryErrorCode =
  | "CLIENT_ADAPTER_UNAVAILABLE"
  | "CLIENT_CAPABILITY_UNAVAILABLE"
  | "DEVELOPMENT_STATE_FAILURE"
  | "HTTP_REQUEST_FAILED"
  | "INVALID_LIBRARY_RESPONSE"
  | "UNSUPPORTED_BOOK_FORMAT";

export class ClientBoundaryError extends Error {
  constructor(readonly code: ClientBoundaryErrorCode, message?: string) {
    super(message ?? (code === "CLIENT_ADAPTER_UNAVAILABLE"
      ? "真实客户端接口尚未进入当前主线"
      : code === "CLIENT_CAPABILITY_UNAVAILABLE"
        ? "当前客户端能力尚未接入"
        : code === "DEVELOPMENT_STATE_FAILURE"
          ? "开发适配器模拟了可恢复失败"
          : code === "UNSUPPORTED_BOOK_FORMAT"
            ? "仅支持 EPUB、TXT 或 PDF 文件"
            : code === "INVALID_LIBRARY_RESPONSE"
              ? "书架响应无法识别"
              : "书架请求失败"));
    this.name = "ClientBoundaryError";
  }
}

export function normalizeBookListOptions(
  input?: BookListOptions | DevelopmentState,
): Required<BookListOptions> {
  if (typeof input === "string") return { query: "", state: input };
  return { query: input?.query ?? "", state: input?.state ?? "normal" };
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
