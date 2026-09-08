import type {
  PptDraftCreateResult,
  PptDraftSnapshot,
  PptDraftSource,
  PptOutlineParagraph,
  PptOutlineSnapshot,
  PptOutlineWrite,
  PptRequirementsWrite,
} from "./client";
import { ClientBoundaryError } from "./client";
import {
  createWxLibraryTransport,
  resolveSessionHeaders,
  type LibraryHttpClientOptions,
  type LibraryHttpRequest,
  type LibraryHttpTransport,
} from "./library-http";

export type PptWorkspaceHttpClientOptions = LibraryHttpClientOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function invalidPptResponse(): never {
  throw new ClientBoundaryError("INVALID_PPT_RESPONSE");
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function parsePageRange(value: unknown): { min: number; max: number } | null {
  if (value === null) return null;
  if (!isRecord(value)
    || !safeInteger(value.min)
    || !safeInteger(value.max)
    || value.min < 1
    || value.max < value.min) {
    return invalidPptResponse();
  }
  return { min: value.min, max: value.max };
}

function parseWorkspace(value: unknown): PptDraftSnapshot {
  if (!isRecord(value) || !isRecord(value.draft)) return invalidPptResponse();
  const { draft } = value;
  if (!nonEmptyString(draft.id)
    || !nonEmptyString(draft.conversationId)
    || draft.stage !== "requirements"
    || !safeInteger(draft.version)
    || draft.version < 1
    || !isRecord(draft.requirements)
    || !nullableString(draft.requirements.purpose)
    || !nullableString(draft.requirements.audience)
    || typeof draft.requirements.additionalRequirements !== "string") {
    return invalidPptResponse();
  }
  const pageRange = parsePageRange(draft.requirements.pageRange);
  if (!Array.isArray(value.sources) || value.sources.length !== 1) return invalidPptResponse();
  const [source] = value.sources;
  if (!isRecord(source)
    || !nonEmptyString(source.bookId)
    || typeof source.title !== "string"
    || !nullableString(source.author)
    || typeof source.sourceLabel !== "string") {
    return invalidPptResponse();
  }
  return {
    draft: {
      id: draft.id,
      conversationId: draft.conversationId,
      stage: "requirements",
      version: draft.version,
      requirements: {
        purpose: draft.requirements.purpose,
        audience: draft.requirements.audience,
        pageRange,
        additionalRequirements: draft.requirements.additionalRequirements,
      },
    },
    sources: [{
      bookId: source.bookId,
      title: source.title,
      author: source.author,
      sourceLabel: source.sourceLabel,
    } satisfies PptDraftSource],
  };
}

function parseParagraph(value: unknown): PptOutlineParagraph {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || (value.level !== 1 && value.level !== 2 && value.level !== 3)
    || !nonEmptyString(value.text)) {
    return invalidPptResponse();
  }
  return { id: value.id, level: value.level, text: value.text };
}

function parseOutline(value: unknown): PptOutlineSnapshot {
  if (!isRecord(value)
    || !safeInteger(value.version)
    || value.version < 1
    || !safeInteger(value.pageCount)
    || value.pageCount < 0
    || !Array.isArray(value.paragraphs)) {
    return invalidPptResponse();
  }
  return {
    version: value.version,
    pageCount: value.pageCount,
    paragraphs: value.paragraphs.map(parseParagraph),
  };
}

/** Production adapter for the frozen Server PPT workspace routes (requirements + outline slice). */
export class PptWorkspaceHttpClient {
  readonly #baseUrl: string;
  readonly #headersSource: Pick<LibraryHttpClientOptions, "authProvider" | "requestHeaders">;
  readonly #onUnauthorized: LibraryHttpClientOptions["onUnauthorized"];
  readonly #transport: LibraryHttpTransport;

  constructor(options: PptWorkspaceHttpClientOptions) {
    if (
      typeof options.baseUrl !== "string"
      || !options.baseUrl.trim()
      || (typeof options.authProvider !== "function" && typeof options.requestHeaders !== "function")
    ) {
      throw new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE", "真实客户端缺少 API 地址或会话接缝");
    }
    this.#baseUrl = options.baseUrl;
    this.#headersSource = { authProvider: options.authProvider, requestHeaders: options.requestHeaders };
    this.#onUnauthorized = options.onUnauthorized;
    this.#transport = options.transport ?? createWxLibraryTransport();
  }

  private async request(input: LibraryHttpRequest): Promise<unknown> {
    let response: Awaited<ReturnType<LibraryHttpTransport["request"]>>;
    try {
      response = await this.#transport.request(input);
    } catch (error) {
      if (error instanceof ClientBoundaryError) throw error;
      throw new ClientBoundaryError("HTTP_REQUEST_FAILED");
    }
    if (response.status === 401) {
      try {
        this.#onUnauthorized?.(response.status);
      } catch {
        // Session cleanup must not hide the original protected-request failure.
      }
      throw new ClientBoundaryError("HTTP_REQUEST_FAILED", "PPT 工作区请求失败（401）");
    }
    if (response.status >= 200 && response.status < 300) return response.data;
    const code = isRecord(response.data) && typeof response.data.code === "string"
      ? response.data.code
      : "";
    if (response.status === 404) throw new ClientBoundaryError("PPT_WORKSPACE_NOT_FOUND");
    if (response.status === 422 && code === "PPT_INTENT_NOT_SENT") {
      throw new ClientBoundaryError("PPT_INTENT_NOT_SENT");
    }
    if (response.status === 409 && code === "PPT_WORKSPACE_STALE") {
      throw new ClientBoundaryError("PPT_WORKSPACE_STALE");
    }
    if (response.status === 409 && code === "PPT_INTENT_CONFLICT") {
      throw new ClientBoundaryError("PPT_INTENT_CONFLICT");
    }
    if (response.status === 400 && code === "PPT_OUTLINE_ORPHAN_CHILD") {
      throw new ClientBoundaryError("PPT_OUTLINE_ORPHAN_CHILD");
    }
    if (response.status === 503) throw new ClientBoundaryError("PPT_OUTLINE_UNAVAILABLE");
    throw new ClientBoundaryError("HTTP_REQUEST_FAILED", `PPT 工作区请求失败（${response.status}）`);
  }

  async createDraft(input: {
    conversationId: string;
    requestId: string;
    bookId: string;
  }): Promise<PptDraftCreateResult> {
    const data = await this.request({
      method: "POST",
      url: endpoint(this.#baseUrl, `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/ppt-drafts`),
      headers: await resolveSessionHeaders(this.#headersSource, "application/json"),
      body: { requestId: input.requestId, bookId: input.bookId },
    });
    if (!isRecord(data) || (data.status !== "created" && data.status !== "reused")) {
      return invalidPptResponse();
    }
    return { status: data.status, workspace: parseWorkspace(data.workspace) };
  }

  async getWorkspace(draftId: string): Promise<PptDraftSnapshot> {
    const data = await this.request({
      method: "GET",
      url: endpoint(this.#baseUrl, `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/workspace`),
      headers: await resolveSessionHeaders(this.#headersSource),
    });
    if (!isRecord(data)) return invalidPptResponse();
    return parseWorkspace(data.workspace);
  }

  async saveRequirements(draftId: string, input: PptRequirementsWrite): Promise<PptDraftSnapshot> {
    const data = await this.request({
      method: "PUT",
      url: endpoint(this.#baseUrl, `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/requirements`),
      headers: await resolveSessionHeaders(this.#headersSource, "application/json"),
      body: {
        expectedVersion: input.expectedVersion,
        purpose: input.purpose,
        audience: input.audience,
        pageRange: input.pageRange,
        additionalRequirements: input.additionalRequirements,
      },
    });
    if (!isRecord(data)) return invalidPptResponse();
    return parseWorkspace(data.workspace);
  }

  async getOutline(draftId: string): Promise<PptOutlineSnapshot> {
    const data = await this.request({
      method: "GET",
      url: endpoint(this.#baseUrl, `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/outline`),
      headers: await resolveSessionHeaders(this.#headersSource),
    });
    if (!isRecord(data)) return invalidPptResponse();
    return parseOutline(data.outline);
  }

  async saveOutline(draftId: string, input: PptOutlineWrite): Promise<PptOutlineSnapshot> {
    const data = await this.request({
      method: "PUT",
      url: endpoint(this.#baseUrl, `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/outline`),
      headers: await resolveSessionHeaders(this.#headersSource, "application/json"),
      body: { expectedVersion: input.expectedVersion, paragraphs: input.paragraphs },
    });
    if (!isRecord(data)) return invalidPptResponse();
    return parseOutline(data.outline);
  }

  async generateOutline(draftId: string, input: { expectedVersion: number }): Promise<PptOutlineSnapshot> {
    const data = await this.request({
      method: "POST",
      url: endpoint(this.#baseUrl, `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/outline/generate`),
      headers: await resolveSessionHeaders(this.#headersSource, "application/json"),
      body: { expectedVersion: input.expectedVersion },
    });
    if (!isRecord(data)) return invalidPptResponse();
    return parseOutline(data.outline);
  }
}

export function createPptWorkspaceHttpClient(options: PptWorkspaceHttpClientOptions) {
  return new PptWorkspaceHttpClient(options);
}
