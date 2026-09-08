import type { PptWorkspaceSnapshot } from "@selfalone/contracts";

export class PptWorkspaceClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "PptWorkspaceClientError";
  }
}

export type PptWorkspaceCreateResult = {
  status: "created" | "reused";
  workspace: PptWorkspaceSnapshot;
};

export type PptRequirementsSaveInput = {
  expectedVersion: number;
  purpose: string;
  audience: string;
  pageRange: { min: number; max: number };
  additionalRequirements: string;
};

export type PptWorkspaceClientOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  headers?: HeadersInit;
};

export function createPptWorkspaceClient(options: PptWorkspaceClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";

  return {
    async createOrReuse(
      conversationId: string,
      input: { requestId: string; bookId: string },
    ): Promise<PptWorkspaceCreateResult> {
      const response = await fetcher(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/ppt-drafts`,
        {
          method: "POST",
          headers: { ...options.headers, "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await responseBody(response);
      if (!response.ok) {
        const code = body && typeof body === "object" && "code" in body
          ? String((body as { code: unknown }).code)
          : "PPT_WORKSPACE_REQUEST_FAILED";
        throw new PptWorkspaceClientError(response.status, code);
      }
      if (response.status !== 201 && response.status !== 200) {
        throw new PptWorkspaceClientError(response.status, "PPT_WORKSPACE_RESPONSE_INVALID");
      }
      if (!isPptWorkspaceResponse(body)) {
        throw new PptWorkspaceClientError(response.status, "PPT_WORKSPACE_RESPONSE_INVALID");
      }
      return {
        status: response.status === 201 ? "created" : "reused",
        workspace: body.workspace,
      };
    },

    async saveRequirements(
      draftId: string,
      input: PptRequirementsSaveInput,
    ): Promise<PptWorkspaceSnapshot> {
      const response = await fetcher(
        `${baseUrl}/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/requirements`,
        {
          method: "PUT",
          headers: { ...options.headers, "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await responseBody(response);
      if (!response.ok) {
        const code = body && typeof body === "object" && "code" in body
          ? String((body as { code: unknown }).code)
          : "PPT_WORKSPACE_REQUEST_FAILED";
        throw new PptWorkspaceClientError(response.status, code);
      }
      if (!isPptWorkspaceResponse(body)) {
        throw new PptWorkspaceClientError(response.status, "PPT_WORKSPACE_RESPONSE_INVALID");
      }
      return body.workspace;
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isPptWorkspaceResponse(value: unknown): value is { workspace: PptWorkspaceSnapshot } {
  if (!value || typeof value !== "object" || !("workspace" in value)) return false;
  return isPptWorkspaceSnapshot((value as { workspace: unknown }).workspace);
}

function isPptWorkspaceSnapshot(value: unknown): value is PptWorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as { draft?: unknown; sources?: unknown };
  if (!isDraft(snapshot.draft) || !Array.isArray(snapshot.sources) || snapshot.sources.length !== 1) return false;
  const source = snapshot.sources[0];
  return Boolean(source && typeof source === "object"
    && typeof (source as { bookId?: unknown }).bookId === "string"
    && typeof (source as { title?: unknown }).title === "string"
    && (typeof (source as { author?: unknown }).author === "string" || (source as { author?: unknown }).author === null)
    && typeof (source as { sourceLabel?: unknown }).sourceLabel === "string");
}

function isDraft(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const draft = value as { id?: unknown; conversationId?: unknown; stage?: unknown; version?: unknown; requirements?: unknown };
  if (typeof draft.id !== "string" || typeof draft.conversationId !== "string" || draft.stage !== "requirements" || typeof draft.version !== "number") return false;
  return isRequirements(draft.requirements);
}

function isRequirements(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const requirements = value as { purpose?: unknown; audience?: unknown; pageRange?: unknown; additionalRequirements?: unknown };
  const nullableString = (candidate: unknown) => typeof candidate === "string" || candidate === null;
  const pageRange = requirements.pageRange;
  return nullableString(requirements.purpose)
    && nullableString(requirements.audience)
    && typeof requirements.additionalRequirements === "string"
    && (pageRange === null || Boolean(pageRange && typeof pageRange === "object"
      && typeof (pageRange as { min?: unknown }).min === "number"
      && typeof (pageRange as { max?: unknown }).max === "number"));
}
