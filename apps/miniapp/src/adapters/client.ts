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

/** Frozen Server contract: PPT draft workspace in the requirements stage. */
export type PptDraftRequirements = {
  purpose: string | null;
  audience: string | null;
  pageRange: { min: number; max: number } | null;
  additionalRequirements: string;
};

export type PptDraftSource = {
  bookId: string;
  title: string;
  author: string | null;
  sourceLabel: string;
};

export type PptDraftSnapshot = {
  draft: {
    id: string;
    conversationId: string;
    stage: "requirements";
    version: number;
    requirements: PptDraftRequirements;
  };
  sources: readonly [PptDraftSource];
};

export type PptOutlineParagraph = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

/** Frozen Server contract: provenance for a public source used by the outline. */
export type PptPublicSource = {
  url: string;
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  usageScope: string;
};

export type PptOutlineSnapshot = {
  version: number;
  pageCount: number;
  paragraphs: PptOutlineParagraph[];
  publicSources: PptPublicSource[];
};

export type PptDraftCreateResult = {
  status: "created" | "reused";
  workspace: PptDraftSnapshot;
};

export type PptRequirementsWrite = {
  expectedVersion: number;
  purpose: string;
  audience: string;
  pageRange: { min: number; max: number };
  additionalRequirements: string;
};

export type PptOutlineWrite = {
  expectedVersion: number;
  paragraphs: PptOutlineParagraph[];
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
  readonly kind: "development" | "production" | "unavailable";
  readonly development: boolean;
  listBooks(options?: BookListOptions | DevelopmentState): Promise<BookSummary[]>;
  importBook(file: LocalBookFile): Promise<BookSummary>;
  getBook(bookId: string, state?: DevelopmentState): Promise<BookDetail>;
  savePosition(bookId: string, input: Omit<ReadingPosition, "version"> & { expectedVersion: number }): Promise<ReadingPosition>;
  getPptWorkspace(bookId?: string, state?: DevelopmentState): Promise<PptWorkspace>;
  savePptWorkspace(workspace: PptWorkspace): Promise<PptWorkspace>;
  createPptDraft(input: { conversationId: string; requestId: string; bookId: string }): Promise<PptDraftCreateResult>;
  getPptDraftWorkspace(draftId: string): Promise<PptDraftSnapshot>;
  savePptRequirements(draftId: string, input: PptRequirementsWrite): Promise<PptDraftSnapshot>;
  getPptOutline(draftId: string): Promise<PptOutlineSnapshot>;
  savePptOutline(draftId: string, input: PptOutlineWrite): Promise<PptOutlineSnapshot>;
  generatePptOutline(draftId: string, input: { expectedVersion: number }): Promise<PptOutlineSnapshot>;
}

export type ClientBoundaryErrorCode =
  | "CLIENT_ADAPTER_UNAVAILABLE"
  | "CLIENT_CAPABILITY_UNAVAILABLE"
  | "DEVELOPMENT_STATE_FAILURE"
  | "HTTP_REQUEST_FAILED"
  | "INVALID_LIBRARY_RESPONSE"
  | "INVALID_PPT_RESPONSE"
  | "BOOK_FILE_TOO_LARGE"
  | "UNSUPPORTED_BOOK_FORMAT"
  | "PPT_INTENT_CONFLICT"
  | "PPT_INTENT_NOT_SENT"
  | "PPT_OUTLINE_ORPHAN_CHILD"
  | "PPT_OUTLINE_UNAVAILABLE"
  | "PPT_WORKSPACE_NOT_FOUND"
  | "PPT_WORKSPACE_STALE";

export class ClientBoundaryError extends Error {
  constructor(readonly code: ClientBoundaryErrorCode, message?: string) {
    super(message ?? (code === "CLIENT_ADAPTER_UNAVAILABLE"
      ? "真实客户端接口尚未进入当前主线"
      : code === "CLIENT_CAPABILITY_UNAVAILABLE"
        ? "当前客户端能力尚未接入"
        : code === "DEVELOPMENT_STATE_FAILURE"
          ? "开发适配器模拟了可恢复失败"
          : code === "BOOK_FILE_TOO_LARGE"
            ? "文件超过 50 MB 上限"
            : code === "UNSUPPORTED_BOOK_FORMAT"
            ? "仅支持 EPUB、TXT 或 PDF 文件"
            : code === "INVALID_LIBRARY_RESPONSE"
              ? "书架响应无法识别"
              : code === "INVALID_PPT_RESPONSE"
                ? "PPT 工作区响应无法识别"
                : code === "PPT_INTENT_NOT_SENT"
                  ? "PPT 意图尚未发送，无法创建工作区"
                  : code === "PPT_INTENT_CONFLICT"
                    ? "PPT 意图与已有草稿不一致"
                    : code === "PPT_OUTLINE_ORPHAN_CHILD"
                      ? "需要页面层级才能确认大纲"
                      : code === "PPT_OUTLINE_UNAVAILABLE"
                        ? "大纲生成暂不可用，请稍后重试"
                        : code === "PPT_WORKSPACE_NOT_FOUND"
                          ? "PPT 草稿不存在或已失效"
                          : code === "PPT_WORKSPACE_STALE"
                            ? "PPT 草稿已在别处更新，请刷新后重试"
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
