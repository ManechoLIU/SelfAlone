import type { BookSummary } from "../core/library-state";
import type { MiniappClient, BookDetail, BookListOptions, DevelopmentState, LocalBookFile, PptWorkspace, ReadingPosition } from "./client";
import { ClientBoundaryError, normalizeBookListOptions } from "./client";

const books: BookSummary[] = [
  {
    id: "dev-local-ink",
    title: "山窗读书札记",
    author: "开发适配器",
    source: "local",
    sourceLabel: "本地",
    format: "epub",
    progress: 0.36,
    coverVariant: 0,
  },
  {
    id: "dev-local-bridge",
    title: "桥下的风",
    author: "开发适配器",
    source: "local",
    sourceLabel: "本地",
    format: "epub",
    progress: 0.18,
    coverVariant: 1,
  },
  {
    id: "dev-local-paper",
    title: "纸上微光：一段很长的阅读札记标题",
    author: "开发适配器",
    source: "local",
    sourceLabel: "本地",
    format: "txt",
    progress: 0.64,
    coverVariant: 2,
  },
];

const longBody = [
  "这段文字只用于验证小程序正文的自然连续纵向滚动。它不是线上书籍内容，也不会写入服务端。阅读区域不设置固定页高，不启用整页吸附；字号、行距和窗口宽度变化时，段落会自然重排。",
  "当读者继续向上滑动，介绍内容与章节正文处于同一条滚动流中。定位块只帮助记录全书位置，不参与视觉分页。滚动停止后，开发适配器仅在当前运行内存中记录最近位置。",
  "轻点正文非交互区域可以呼出阅读操作层，继续滚动会再次隐藏。目录、书籍内容、阅读设置和制作 PPT 保持清晰返回路径，并为底部安全区留出空间。",
].join("\n\n");

function developmentBook(bookId: string): BookDetail {
  const book = books.find((item) => item.id === bookId) ?? books[0]!;
  return {
    book,
    introduction: "用于核对介绍首屏、连续阅读与书籍内容面板的本地开发样本。所有状态均明确标为开发适配器，不代表服务端已经接入。",
    sections: [
      { id: "dev-section-1", index: 0, title: "第一章 · 连续阅读", body: `${longBody}\n\n${longBody}`, locator: "section:0" },
      { id: "dev-section-2", index: 1, title: "第二章 · 状态恢复", body: `${longBody}\n\n${longBody}`, locator: "section:1" },
    ],
    position: null,
    highlights: [
      { id: "dev-highlight", body: "定位存在时才显示，并且不能只靠颜色表达。", quote: "定位块只帮助记录全书位置。", meta: "第一章 · 开发样本" },
    ],
    notes: [
      { id: "dev-note", body: "正文第一行保持普通正文层级，不被放大成标题。", meta: "开发适配器 · 未持久化" },
    ],
    works: [
      { id: "dev-work-running", title: "读书分享版式", status: "running", meta: "正在生成" },
      { id: "dev-work-complete", title: "阅读札记版式", status: "completed", meta: "今天" },
    ],
  };
}

function cloneWorkspace(workspace: PptWorkspace): PptWorkspace {
  return JSON.parse(JSON.stringify(workspace)) as PptWorkspace;
}

function developmentWorkspace(bookId = books[0]!.id): PptWorkspace {
  const book = books.find((item) => item.id === bookId) ?? books[0]!;
  return {
    draftId: "dev-draft",
    version: 1,
    stage: "requirements",
    bookId: book.id,
    bookTitle: book.title,
    purpose: "读书分享",
    audience: "读书会成员",
    pageRange: "6–8 页",
    extra: "",
    outline: [
      { level: 1, text: "从书中提出一个问题" },
      { level: 2, text: "解释问题为何值得讨论" },
      { level: 3, text: "保留一个可继续思考的线索" },
      { level: 1, text: "把阅读带回日常" },
      { level: 2, text: "列出可以尝试的行动" },
    ],
    templateId: "celadon-reading",
    task: null,
    previews: [
      { id: "dev-slide-1", eyebrow: "阅读札记", title: "从一个问题开始", body: "清晰标题与克制留白" },
      { id: "dev-slide-2", eyebrow: "核心观点", title: "把概念放回生活", body: "版式预览不代表真实 PPTX" },
      { id: "dev-slide-3", eyebrow: "行动提示", title: "留下可继续的路径", body: "真实产物等待 F5 接入" },
    ],
  };
}

function applyState<T>(state: DevelopmentState | undefined, value: T): Promise<T> {
  if (state === "failed") return Promise.reject(new ClientBoundaryError("DEVELOPMENT_STATE_FAILURE"));
  return Promise.resolve(value);
}

export class DevelopmentClient implements MiniappClient {
  readonly kind = "development" as const;
  readonly development = true;
  private readonly positions = new Map<string, ReadingPosition>();
  private workspace = developmentWorkspace();

  listBooks(input: BookListOptions | DevelopmentState = "normal") {
    const { query, state } = normalizeBookListOptions(input);
    const result = state === "empty" ? [] : books
      .filter((book) => !query || [book.title, book.author ?? "", book.sourceLabel]
        .some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
      .map((book) => ({ ...book }));
    return applyState(state, result);
  }

  importBook(_file: LocalBookFile): Promise<BookSummary> {
    return Promise.reject(new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "开发适配器不会伪造文件上传"));
  }

  getBook(bookId: string, state: DevelopmentState = "normal") {
    const detail = developmentBook(bookId);
    detail.position = this.positions.get(detail.book.id) ?? null;
    if (state === "empty" || state === "filtered-empty") detail.sections = [];
    return applyState(state, detail);
  }

  savePosition(bookId: string, input: Omit<ReadingPosition, "version"> & { expectedVersion: number }) {
    const current = this.positions.get(bookId);
    const position = { ...input, version: (current?.version ?? input.expectedVersion) + 1 };
    this.positions.set(bookId, position);
    return Promise.resolve(position);
  }

  getPptWorkspace(bookId?: string, state: DevelopmentState = "normal") {
    if (bookId && this.workspace.bookId !== bookId) this.workspace = developmentWorkspace(bookId);
    return applyState(state, cloneWorkspace(this.workspace));
  }

  savePptWorkspace(workspace: PptWorkspace) {
    this.workspace = cloneWorkspace({ ...workspace, version: workspace.version + 1 });
    return Promise.resolve(cloneWorkspace(this.workspace));
  }
}
