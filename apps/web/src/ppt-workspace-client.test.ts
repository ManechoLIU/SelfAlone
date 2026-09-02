import { describe, expect, it } from "vitest";
import { createPptWorkspaceClient, PptWorkspaceClientError } from "./ppt-workspace-client";

describe("PPT workspace client", () => {
  it("creates or reuses the workspace only through the sent-intent endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createPptWorkspaceClient({
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ status: "created", workspace: { draft: { id: "draft-1" } } }), { status: 201 });
      },
    });

    await expect(client.createOrReuse("conversation/1", { requestId: "request-1", bookId: "book/1" })).resolves.toMatchObject({
      status: "created",
    });
    expect(requests).toEqual([{
      url: "/api/v1/conversations/conversation%2F1/ppt-drafts",
      method: "POST",
      body: { requestId: "request-1", bookId: "book/1" },
    }]);
  });

  it("preserves a server failure as a typed client error", async () => {
    const client = createPptWorkspaceClient({
      fetch: async () => new Response(JSON.stringify({ code: "PPT_INTENT_NOT_SENT" }), { status: 409 }),
    });
    await expect(client.createOrReuse("conversation-1", { requestId: "request-1", bookId: "book-1" }))
      .rejects.toEqual(new PptWorkspaceClientError(409, "PPT_INTENT_NOT_SENT"));
  });
});
