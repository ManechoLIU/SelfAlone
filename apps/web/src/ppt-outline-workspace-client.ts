export type PptOutlineParagraph = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

export type PptOutlinePublicSource = {
  url: string;
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  usageScope: string;
};

/** Mirrors the frozen server snapshot in apps/server/src/ppt-outline-runtime.ts. */
export type PptOutlineSnapshot = {
  version: number;
  pageCount: number;
  paragraphs: PptOutlineParagraph[];
  publicSources: PptOutlinePublicSource[];
};

export class PptOutlineClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "PptOutlineClientError";
  }
}

export type PptOutlineWorkspaceClientOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  headers?: HeadersInit;
};

export function createPptOutlineWorkspaceClient(options: PptOutlineWorkspaceClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";

  async function request(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      headers: { ...options.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await responseBody(response) };
  }

  function outlineUrl(draftId: string, suffix = "") {
    return `/api/v1/ppt-drafts/${encodeURIComponent(draftId)}/outline${suffix}`;
  }

  return {
    async getOutline(draftId: string): Promise<PptOutlineSnapshot | null> {
      const { status, body } = await request("GET", outlineUrl(draftId));
      if (status === 404) return null;
      if (status !== 200) throw failureError(status, body);
      if (!isPptOutlineResponse(body)) throw new PptOutlineClientError(status, "PPT_OUTLINE_RESPONSE_INVALID");
      return body.outline;
    },

    async saveOutline(
      draftId: string,
      input: { expectedVersion: number; paragraphs: PptOutlineParagraph[] },
    ): Promise<PptOutlineSnapshot> {
      const { status, body } = await request("PUT", outlineUrl(draftId), input);
      if (status !== 200) throw failureError(status, body);
      if (!isPptOutlineResponse(body)) throw new PptOutlineClientError(status, "PPT_OUTLINE_RESPONSE_INVALID");
      return body.outline;
    },

    async generateOutline(
      draftId: string,
      input: { expectedVersion: number },
    ): Promise<PptOutlineSnapshot> {
      const { status, body } = await request("POST", outlineUrl(draftId, "/generate"), input);
      if (status !== 200) throw failureError(status, body);
      if (!isPptOutlineResponse(body)) throw new PptOutlineClientError(status, "PPT_OUTLINE_RESPONSE_INVALID");
      return body.outline;
    },
  };
}

function failureError(status: number, body: unknown): PptOutlineClientError {
  const code = body && typeof body === "object" && "code" in body
    ? String((body as { code: unknown }).code)
    : "PPT_OUTLINE_REQUEST_FAILED";
  return new PptOutlineClientError(status, code);
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

function isPptOutlineResponse(value: unknown): value is { outline: PptOutlineSnapshot } {
  if (!value || typeof value !== "object" || !("outline" in value)) return false;
  return isPptOutlineSnapshot((value as { outline: unknown }).outline);
}

function isPptOutlineSnapshot(value: unknown): value is PptOutlineSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as {
    version?: unknown;
    pageCount?: unknown;
    paragraphs?: unknown;
    publicSources?: unknown;
  };
  return typeof snapshot.version === "number"
    && typeof snapshot.pageCount === "number"
    && Array.isArray(snapshot.paragraphs)
    && snapshot.paragraphs.every(isPptOutlineParagraph)
    && Array.isArray(snapshot.publicSources)
    && snapshot.publicSources.every(isPptPublicSource);
}

function isPptOutlineParagraph(value: unknown): value is PptOutlineParagraph {
  if (!value || typeof value !== "object") return false;
  const paragraph = value as { id?: unknown; level?: unknown; text?: unknown };
  return typeof paragraph.id === "string"
    && (paragraph.level === 1 || paragraph.level === 2 || paragraph.level === 3)
    && typeof paragraph.text === "string";
}

function isPptPublicSource(value: unknown): value is PptOutlinePublicSource {
  if (!value || typeof value !== "object") return false;
  const source = value as {
    url?: unknown;
    title?: unknown;
    publishedAt?: unknown;
    fetchedAt?: unknown;
    usageScope?: unknown;
  };
  return typeof source.url === "string"
    && typeof source.title === "string"
    && (typeof source.publishedAt === "string" || source.publishedAt === null)
    && typeof source.fetchedAt === "string"
    && typeof source.usageScope === "string";
}
