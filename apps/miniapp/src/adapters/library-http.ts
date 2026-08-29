import type { BookSummary } from "../core/library-state";
import type { BookSection } from "../core/reader-state";
import type { Session } from "../core/session";
import type { BookDetail, BookListOptions, LocalBookFile, MiniappClient, PptWorkspace, ReadingPosition } from "./client";
import { ClientBoundaryError, normalizeBookListOptions } from "./client";

export type LibraryHttpRequest = {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

export type LibraryHttpResponse = {
  status: number;
  data: unknown;
};

export type LibraryHttpTransport = {
  request(input: LibraryHttpRequest): Promise<LibraryHttpResponse>;
  readFile(path: string): Promise<ArrayBuffer>;
};

export type LibraryAuthProvider = () => Session | null | undefined;

export type LibraryHttpClientOptions = {
  baseUrl: string;
  /** M2-F1 session store is read immediately before every request. */
  authProvider?: LibraryAuthProvider;
  /** Compatibility seam for a host that already owns session-bound headers. */
  requestHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  onUnauthorized?: (status: number) => void;
  transport?: LibraryHttpTransport;
};

const parseStatuses = new Set(["processing", "ready_text", "ready_pages", "failed"]);
const formats = new Set(["epub", "txt", "pdf", "weread"]);
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableCoverVariant(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 3;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mappedProgress(value: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(value, "progressPercent")) {
    const percent = value.progressPercent;
    return typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? percent / 100
      : 0;
  }
  const progress = optionalNumber(value.progress);
  return progress === undefined ? 0 : Math.min(1, Math.max(0, progress));
}

function mapBookSummary(value: unknown): BookSummary {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !value.id
    || typeof value.title !== "string"
    || !value.title
    || typeof value.format !== "string"
    || !formats.has(value.format)) {
    throw new ClientBoundaryError("INVALID_LIBRARY_RESPONSE");
  }
  const format = value.format as BookSummary["format"];
  const source = value.source === "weread" || format === "weread" ? "weread" : "local";
  const coverVariant = optionalNumber(value.coverVariant);
  const parseStatus = typeof value.parseStatus === "string" && parseStatuses.has(value.parseStatus)
    ? value.parseStatus as NonNullable<BookSummary["parseStatus"]>
    : undefined;
  return {
    id: value.id,
    title: value.title,
    author: optionalString(value.author),
    source,
    sourceLabel: optionalString(value.sourceLabel) ?? (source === "weread" ? "微信读书" : "本地"),
    format,
    progress: mappedProgress(value),
    coverUrl: optionalString(value.coverUrl),
    coverVariant: coverVariant === undefined ? stableCoverVariant(value.id) : Math.abs(Math.trunc(coverVariant)) % 3,
    parseStatus,
    errorCode: optionalString(value.errorCode),
    sectionCount: optionalNumber(value.sectionCount),
    pageCount: optionalNumber(value.pageCount),
    createdAt: optionalString(value.createdAt),
  };
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function responseBooks(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.books)) {
    throw new ClientBoundaryError("INVALID_LIBRARY_RESPONSE");
  }
  return data.books;
}

type ServerTextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

type ServerReadingPosition = {
  locator: ServerTextLocator;
  background: "light" | "dark";
  version: number;
};

type ServerTextReading = {
  bookId: string;
  title: string;
  author: string | null;
  contentMode: "text";
  fileVersion: number;
  position: ServerReadingPosition | null;
};

type ServerTextSection = {
  sectionId: string;
  title: string;
  order: number;
  text: string;
};

type ServerTextReaderSections = {
  fileVersion: number;
  sections: ServerTextSection[];
};

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function positiveInteger(value: unknown): value is number {
  return safeInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidReaderResponse(): never {
  throw new ClientBoundaryError("INVALID_LIBRARY_RESPONSE");
}

function staleReaderResponse() {
  return new ClientBoundaryError("HTTP_REQUEST_FAILED", "书籍内容已经更新，请重新载入");
}

function parseReaderPosition(value: unknown): ServerReadingPosition | null {
  if (value === null) return null;
  if (!isRecord(value)
    || !isRecord(value.locator)
    || value.locator.kind !== "text"
    || !positiveInteger(value.locator.fileVersion)
    || !nonEmptyString(value.locator.sectionId)
    || !safeInteger(value.locator.offset)
    || value.locator.offset < 0
    || (value.background !== "light" && value.background !== "dark")
    || !safeInteger(value.version)
    || value.version < 0) {
    return invalidReaderResponse();
  }
  return {
    locator: {
      kind: "text",
      fileVersion: value.locator.fileVersion,
      sectionId: value.locator.sectionId,
      offset: value.locator.offset,
    },
    background: value.background,
    version: value.version,
  };
}

function parseTextReading(value: unknown, expectedBookId: string): ServerTextReading {
  if (!isRecord(value)
    || value.bookId !== expectedBookId
    || !nonEmptyString(value.title)
    || (value.author !== null && typeof value.author !== "string")
    || value.contentMode !== "text"
    || !positiveInteger(value.fileVersion)
    || !Object.prototype.hasOwnProperty.call(value, "position")) {
    return invalidReaderResponse();
  }
  return {
    bookId: value.bookId,
    title: value.title,
    author: value.author,
    contentMode: "text",
    fileVersion: value.fileVersion,
    position: parseReaderPosition(value.position),
  };
}

function parseTextReaderSections(value: unknown): ServerTextReaderSections {
  if (!isRecord(value) || !positiveInteger(value.fileVersion) || !Array.isArray(value.sections)) {
    return invalidReaderResponse();
  }
  const ids = new Set<string>();
  const orders = new Set<number>();
  const sections = value.sections.map((item) => {
    if (!isRecord(item)
      || !nonEmptyString(item.sectionId)
      || !nonEmptyString(item.title)
      || !safeInteger(item.order)
      || item.order < 0
      || typeof item.text !== "string"
      || ids.has(item.sectionId)
      || orders.has(item.order)) {
      return invalidReaderResponse();
    }
    ids.add(item.sectionId);
    orders.add(item.order);
    return {
      sectionId: item.sectionId,
      title: item.title,
      order: item.order,
      text: item.text,
    };
  });
  return { fileVersion: value.fileVersion, sections };
}

function readerProgress(locator: ServerTextLocator, sections: ServerTextSection[]) {
  const targetIndex = sections.findIndex((section) => section.sectionId === locator.sectionId);
  if (targetIndex < 0) return invalidReaderResponse();
  const target = sections[targetIndex];
  if (!target || locator.offset > target.text.length) return invalidReaderResponse();
  const totalLength = sections.reduce((total, section) => total + section.text.length, 0);
  const beforeLength = sections
    .slice(0, targetIndex)
    .reduce((total, section) => total + section.text.length, 0);
  if (totalLength <= 0) return 0;
  return Math.min(1, Math.max(0, (beforeLength + locator.offset) / totalLength));
}

// Server locators use UTF-16 code-unit offsets into the source section.text,
// while the Mini reader builds blocks from body.trim() starting at offset 0.
// Both directions therefore stay in UTF-16 code units, never code points.
function leadingTrimmedUnits(text: string) {
  return /^\s*/.exec(text)?.[0].length ?? 0;
}

function displayOffsetFromSource(section: ServerTextSection, sourceOffset: number) {
  return Math.min(
    Math.max(sourceOffset - leadingTrimmedUnits(section.text), 0),
    section.text.trim().length,
  );
}

function sourceOffsetFromDisplay(section: ServerTextSection, displayOffset: number) {
  return leadingTrimmedUnits(section.text)
    + Math.min(Math.max(displayOffset, 0), section.text.trim().length);
}

function mapReaderPosition(
  value: unknown,
  sections: ServerTextSection[],
  fileVersion: number,
): ReadingPosition | null {
  const position = parseReaderPosition(value);
  if (!position) return null;
  if (position.locator.fileVersion !== fileVersion) throw staleReaderResponse();
  const progress = readerProgress(position.locator, sections);
  const section = sections.find((candidate) => candidate.sectionId === position.locator.sectionId);
  if (!section) return invalidReaderResponse();
  return {
    sectionId: position.locator.sectionId,
    offset: displayOffsetFromSource(section, position.locator.offset),
    progress,
    background: position.background,
    version: position.version,
  };
}

function inferredTextFormat(sections: readonly BookSection[]) {
  return sections.some((section) => section.id.startsWith("epub:")) ? "epub" as const : "txt" as const;
}

type WxLibraryFileManager = {
  readFile(options: {
    filePath: string;
    success?: (result: { data: ArrayBuffer | ArrayBufferView }) => void;
    fail?: () => void;
  }): void;
};

type WxLibraryRuntime = {
  request(options: {
    url: string;
    method?: "GET" | "POST" | "PUT";
    header?: Record<string, string>;
    data?: unknown;
    success?: (response: { statusCode: number; data: unknown }) => void;
    fail?: () => void;
  }): void;
  getFileSystemManager?: () => WxLibraryFileManager;
};

function wxRuntime() {
  return wx as unknown as WxLibraryRuntime;
}

/** The only production transport: JSON responses use wx.request and local files use raw bytes. */
export function createWxLibraryTransport(): LibraryHttpTransport {
  return {
    request(input) {
      return new Promise((resolve, reject) => {
        try {
          wxRuntime().request({
            url: input.url,
            method: input.method,
            header: { ...input.headers },
            ...(input.body === undefined ? {} : { data: input.body }),
            success: (response) => resolve({ status: response.statusCode, data: response.data }),
            fail: () => reject(new ClientBoundaryError("HTTP_REQUEST_FAILED", "暂时无法连接，请稍后重试")),
          });
        } catch {
          reject(new ClientBoundaryError("HTTP_REQUEST_FAILED", "暂时无法连接，请稍后重试"));
        }
      });
    },
    readFile(path) {
      return new Promise((resolve, reject) => {
        let fileManager: WxLibraryFileManager | undefined;
        try {
          fileManager = wxRuntime().getFileSystemManager?.();
        } catch {
          reject(new ClientBoundaryError("CLIENT_CAPABILITY_UNAVAILABLE", "当前客户端不支持读取本地文件"));
          return;
        }
        if (!fileManager) {
          reject(new ClientBoundaryError("CLIENT_CAPABILITY_UNAVAILABLE", "当前客户端不支持读取本地文件"));
          return;
        }
        try {
          fileManager.readFile({
            filePath: path,
            success: ({ data }) => {
              if (data instanceof ArrayBuffer) {
                resolve(data);
                return;
              }
              if (ArrayBuffer.isView(data)) {
                const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                resolve(bytes.slice().buffer);
                return;
              }
              reject(new ClientBoundaryError("HTTP_REQUEST_FAILED", "无法读取所选文件"));
            },
            fail: () => reject(new ClientBoundaryError("HTTP_REQUEST_FAILED", "无法读取所选文件")),
          });
        } catch {
          reject(new ClientBoundaryError("HTTP_REQUEST_FAILED", "无法读取所选文件"));
        }
      });
    },
  };
}

export class LibraryHttpClient implements MiniappClient {
  readonly kind = "production" as const;
  readonly development = false;
  readonly #baseUrl: string;
  readonly #authProvider: LibraryHttpClientOptions["authProvider"];
  readonly #requestHeaders: LibraryHttpClientOptions["requestHeaders"];
  readonly #onUnauthorized: LibraryHttpClientOptions["onUnauthorized"];
  readonly #transport: LibraryHttpTransport;
  readonly #readerSnapshots = new Map<string, { fileVersion: number; sections: ServerTextSection[] }>();

  constructor(options: LibraryHttpClientOptions) {
    if (
      typeof options.baseUrl !== "string"
      || !options.baseUrl.trim()
      || (typeof options.authProvider !== "function" && typeof options.requestHeaders !== "function")
    ) {
      throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端缺少 API 地址或会话接缝");
    }
    this.#baseUrl = options.baseUrl;
    this.#authProvider = options.authProvider;
    this.#requestHeaders = options.requestHeaders;
    this.#onUnauthorized = options.onUnauthorized;
    this.#transport = options.transport ?? createWxLibraryTransport();
  }

  private async headers(contentType?: string) {
    let provided: Record<string, string>;
    if (this.#authProvider) {
      let session: ReturnType<NonNullable<LibraryHttpClientOptions["authProvider"]>>;
      try {
        session = this.#authProvider();
      } catch {
        throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端未提供会话请求头");
      }
      if (!session || session.kind !== "authenticated" || !session.token.trim()) {
        throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端未提供会话请求头");
      }
      provided = { Authorization: `Bearer ${session.token.trim()}` };
    } else {
      let candidate: Record<string, string> | Promise<Record<string, string>>;
      try {
        candidate = await this.#requestHeaders!();
      } catch {
        throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端未提供会话请求头");
      }
      if (!candidate || typeof candidate !== "object") {
        throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端未提供会话请求头");
      }
      provided = candidate;
    }
    const hasCallerSelectedAccount = Object.keys(provided)
      .some((key) => key.toLocaleLowerCase() === "x-selfalone-account");
    if (hasCallerSelectedAccount) {
      throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "书架客户端不接受调用方指定账户");
    }
    return {
      ...provided,
      accept: provided.accept ?? "application/json",
      ...(contentType ? { "content-type": contentType } : {}),
    };
  }

  private async request(input: LibraryHttpRequest) {
    try {
      const response = await this.#transport.request(input);
      if (response.status === 401) {
        try {
          this.#onUnauthorized?.(response.status);
        } catch {
          // Session cleanup must not hide the original protected-request failure.
        }
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ClientBoundaryError("HTTP_REQUEST_FAILED", `书架请求失败（${response.status}）`);
      }
      return response.data;
    } catch (error) {
      if (error instanceof ClientBoundaryError) throw error;
      throw new ClientBoundaryError("HTTP_REQUEST_FAILED");
    }
  }

  async listBooks(input?: BookListOptions | import("./client").DevelopmentState) {
    const { query } = normalizeBookListOptions(input);
    const data = await this.request({
      method: "GET",
      url: endpoint(this.#baseUrl, `/api/v1/books?query=${encodeURIComponent(query)}`),
      headers: await this.headers(),
    });
    return responseBooks(data).map(mapBookSummary);
  }

  async importBook(file: LocalBookFile) {
    const extension = file.name.split(".").at(-1)?.toLocaleLowerCase();
    if (!extension || !["epub", "txt", "pdf"].includes(extension)) {
      throw new ClientBoundaryError("UNSUPPORTED_BOOK_FORMAT");
    }
    let body: ArrayBuffer;
    try {
      body = await this.#transport.readFile(file.path);
    } catch (error) {
      if (error instanceof ClientBoundaryError) throw error;
      throw new ClientBoundaryError("HTTP_REQUEST_FAILED", "无法读取所选文件");
    }
    if (!(body instanceof ArrayBuffer) || body.byteLength > MAX_IMPORT_BYTES) {
      if (body instanceof ArrayBuffer && body.byteLength > MAX_IMPORT_BYTES) {
        throw new ClientBoundaryError("BOOK_FILE_TOO_LARGE");
      }
      throw new ClientBoundaryError("HTTP_REQUEST_FAILED", "无法读取所选文件");
    }
    const data = await this.request({
      method: "POST",
      url: endpoint(this.#baseUrl, "/api/v1/books/import"),
      headers: {
        ...(await this.headers("application/octet-stream")),
        "x-file-name": encodeURIComponent(file.name),
      },
      body,
    });
    return mapBookSummary(data);
  }

  private unsupported<T>(): Promise<T> {
    return Promise.reject(new ClientBoundaryError("CLIENT_CAPABILITY_UNAVAILABLE"));
  }

  async getBook(bookId: string): Promise<BookDetail> {
    const [readingData, sectionsData] = await Promise.all([
      this.request({
        method: "GET",
        url: endpoint(this.#baseUrl, `/api/v1/books/${encodeURIComponent(bookId)}/reading`),
        headers: await this.headers(),
      }),
      this.request({
        method: "GET",
        url: endpoint(this.#baseUrl, `/api/v1/books/${encodeURIComponent(bookId)}/content/sections`),
        headers: await this.headers(),
      }),
    ]);
    const reading = parseTextReading(readingData, bookId);
    const sections = parseTextReaderSections(sectionsData);
    if (reading.fileVersion !== sections.fileVersion) {
      throw staleReaderResponse();
    }
    const position = mapReaderPosition(reading.position, sections.sections, reading.fileVersion);
    const progress = position?.progress ?? 0;
    const mappedSections = sections.sections.map((section) => ({
      id: section.sectionId,
      index: section.order,
      title: section.title,
      body: section.text,
      locator: section.sectionId,
    }));
    this.#readerSnapshots.set(bookId, { fileVersion: reading.fileVersion, sections: sections.sections });
    return {
      book: {
        id: reading.bookId,
        title: reading.title,
        author: optionalString(reading.author),
        source: "local",
        sourceLabel: "本地",
        format: inferredTextFormat(mappedSections),
        progress,
        coverVariant: stableCoverVariant(reading.bookId),
        parseStatus: "ready_text",
        sectionCount: mappedSections.length,
      },
      introduction: "",
      sections: mappedSections,
      position,
      highlights: [],
      notes: [],
      works: [],
    };
  }

  async savePosition(
    bookId: string,
    input: Omit<ReadingPosition, "version"> & { expectedVersion: number },
  ): Promise<ReadingPosition> {
    const snapshot = this.#readerSnapshots.get(bookId);
    if (!snapshot) {
      throw new ClientBoundaryError("CLIENT_CAPABILITY_UNAVAILABLE", "书籍尚未载入，无法保存阅读位置");
    }
    const section = snapshot.sections.find((candidate) => candidate.sectionId === input.sectionId);
    const sourceOffset = section ? sourceOffsetFromDisplay(section, input.offset) : input.offset;
    const data = await this.request({
      method: "PUT",
      url: endpoint(this.#baseUrl, `/api/v1/books/${encodeURIComponent(bookId)}/position`),
      headers: await this.headers("application/json"),
      body: {
        expectedVersion: input.expectedVersion,
        locator: {
          kind: "text",
          fileVersion: snapshot.fileVersion,
          sectionId: input.sectionId,
          offset: sourceOffset,
        },
        background: input.background,
      },
    });
    const saved = mapReaderPosition(data, snapshot.sections, snapshot.fileVersion);
    if (!saved) return invalidReaderResponse();
    return saved;
  }
  getPptWorkspace(_bookId?: string): Promise<PptWorkspace> { return this.unsupported(); }
  savePptWorkspace(_workspace: PptWorkspace): Promise<PptWorkspace> { return this.unsupported(); }
}

export function createLibraryHttpClient(options: LibraryHttpClientOptions) {
  return new LibraryHttpClient(options);
}
