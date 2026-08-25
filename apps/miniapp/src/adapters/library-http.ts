import type { BookSummary } from "../core/library-state";
import type { BookDetail, BookListOptions, LocalBookFile, MiniappClient, PptWorkspace, ReadingPosition } from "./client";
import { ClientBoundaryError, normalizeBookListOptions } from "./client";

export type LibraryHttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: ArrayBuffer;
};

export type LibraryHttpResponse = {
  status: number;
  data: unknown;
};

export type LibraryHttpTransport = {
  request(input: LibraryHttpRequest): Promise<LibraryHttpResponse>;
  readFile(path: string): Promise<ArrayBuffer>;
};

export type LibraryHttpClientOptions = {
  baseUrl: string;
  /** M2-F1 supplies the session-bound Cookie or Authorization headers. */
  requestHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  transport: LibraryHttpTransport;
};

const parseStatuses = new Set(["processing", "ready_text", "ready_pages", "failed"]);
const formats = new Set(["epub", "txt", "pdf", "weread"]);

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
  const progress = optionalNumber(value.progress);
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
    progress: progress === undefined ? 0 : Math.min(1, Math.max(0, progress)),
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

export class LibraryHttpClient implements MiniappClient {
  readonly kind = "unavailable" as const;
  readonly development = false;
  readonly #baseUrl: string;
  readonly #requestHeaders: LibraryHttpClientOptions["requestHeaders"];
  readonly #transport: LibraryHttpTransport;

  constructor(options: LibraryHttpClientOptions) {
    if (!options.baseUrl.trim() || typeof options.requestHeaders !== "function") {
      throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端缺少 API 地址或会话接缝");
    }
    this.#baseUrl = options.baseUrl;
    this.#requestHeaders = options.requestHeaders;
    this.#transport = options.transport;
  }

  private async headers(contentType?: string) {
    const provided = await this.#requestHeaders();
    if (!provided || typeof provided !== "object") {
      throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端未提供会话请求头");
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

  getBook(_bookId: string): Promise<BookDetail> { return this.unsupported(); }
  savePosition(_bookId: string, _input: Omit<ReadingPosition, "version"> & { expectedVersion: number }): Promise<ReadingPosition> { return this.unsupported(); }
  getPptWorkspace(_bookId?: string): Promise<PptWorkspace> { return this.unsupported(); }
  savePptWorkspace(_workspace: PptWorkspace): Promise<PptWorkspace> { return this.unsupported(); }
}

export function createLibraryHttpClient(options: LibraryHttpClientOptions) {
  return new LibraryHttpClient(options);
}
