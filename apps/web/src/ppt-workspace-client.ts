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
      const body = await response.json() as unknown;
      if (!response.ok) {
        const code = body && typeof body === "object" && "code" in body
          ? String((body as { code: unknown }).code)
          : "PPT_WORKSPACE_REQUEST_FAILED";
        throw new PptWorkspaceClientError(response.status, code);
      }
      return body as PptWorkspaceCreateResult;
    },
  };
}
