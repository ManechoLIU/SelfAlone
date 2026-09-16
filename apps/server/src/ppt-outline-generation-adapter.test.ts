import { describe, expect, it, vi } from "vitest";
import type { ChatInput, ChatResponderPort } from "./conversation-responder";
import {
  createRealPptOutlineGenerationAdapter,
  parseOutlineParagraphs,
  PPT_OUTLINE_GENERATION_FAILED,
} from "./ppt-outline-generation-adapter";
import {
  createDeepSeekTextModelAdapter,
  type DeepSeekCatalog,
  type DeepSeekCredentialLease,
  type DeepSeekCredentialProvider,
} from "./deepseek-text-model-adapter";

describe("real PPT outline generation adapter", () => {
  it("parses model JSON into hierarchical paragraphs without network I/O when chat is injected", async () => {
    const chat: ChatResponderPort = {
      async chat(input) {
        expect(input.maxTokens).toBe(2048);
        expect(input.context.some((entry) => entry.role === "system")).toBe(true);
        return {
          text: JSON.stringify([
            { level: 1, text: "开场：为什么读这本书" },
            { level: 2, text: "核心矛盾" },
            { level: 3, text: "用一页讲清冲突" },
            { level: 1, text: "收束行动" },
            { level: 2, text: "下一步" },
          ]),
        };
      },
    };
    let sequence = 0;
    const adapter = createRealPptOutlineGenerationAdapter({
      chat,
      createParagraphId: () => `p-${++sequence}`,
    });

    const result = await adapter.createOutline({
      accountId: "account-a",
      draftId: "draft-a",
      purpose: "读书会",
      audience: "产品团队",
      pageRange: { min: 2, max: 4 },
      additionalRequirements: "偏实践",
      sources: [{ bookId: "book-a", title: "第一本书", author: "甲作者" }],
      publicSources: [],
    }, new AbortController().signal);

    expect(result.paragraphs).toEqual([
      { id: "p-1", level: 1, text: "开场：为什么读这本书" },
      { id: "p-2", level: 2, text: "核心矛盾" },
      { id: "p-3", level: 3, text: "用一页讲清冲突" },
      { id: "p-4", level: 1, text: "收束行动" },
      { id: "p-5", level: 2, text: "下一步" },
    ]);
  });

  it("rejects malformed model output and orphan hierarchies", async () => {
    const chat: ChatResponderPort = {
      async chat() {
        return { text: "不是 JSON" };
      },
    };
    const adapter = createRealPptOutlineGenerationAdapter({ chat });
    await expect(adapter.createOutline({
      accountId: "account-a",
      draftId: "draft-a",
      purpose: null,
      audience: null,
      pageRange: null,
      additionalRequirements: "",
      sources: [],
      publicSources: [],
    }, new AbortController().signal)).rejects.toThrow(PPT_OUTLINE_GENERATION_FAILED);

    expect(parseOutlineParagraphs('[{"level":2,"text":"孤儿子层"}]', () => "x")).toEqual([
      { id: "x", level: 2, text: "孤儿子层" },
    ]);
    const orphanChat: ChatResponderPort = {
      async chat() {
        return { text: '[{"level":2,"text":"孤儿子层"}]' };
      },
    };
    await expect(createRealPptOutlineGenerationAdapter({ chat: orphanChat }).createOutline({
      accountId: "account-a",
      draftId: "draft-b",
      purpose: null,
      audience: null,
      pageRange: null,
      additionalRequirements: "",
      sources: [],
      publicSources: [],
    }, new AbortController().signal)).rejects.toThrow(PPT_OUTLINE_GENERATION_FAILED);
  });

  it("reuses DeepSeek chat adapter over fake HTTP and never logs the credential", async () => {
    const key = "unit-only-outline-secret-key";
    const outlineJson = JSON.stringify([
      { level: 1, text: "模型页" },
      { level: 2, text: "模型点" },
    ]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: outlineJson }, finish_reason: "stop" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const catalog: DeepSeekCatalog = {
      endpoint: "https://fake.deepseek.invalid/v1",
      model: "fake-deepseek-model",
    };
    const credentialProvider: DeepSeekCredentialProvider = {
      async withVerifiedTextModelCredential<T>(
        accountId: string,
        consume: (lease: DeepSeekCredentialLease) => Promise<T>,
      ) {
        expect(accountId).toBe("account-a");
        return consume({ provider: "deepseek", apiKey: key });
      },
    };
    const chat = createDeepSeekTextModelAdapter({ fetcher, catalog, credentialProvider });
    const adapter = createRealPptOutlineGenerationAdapter({
      chat,
      createParagraphId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      maxTokens: 512,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await adapter.createOutline({
      accountId: "account-a",
      draftId: "draft-live-shape",
      purpose: "分享",
      audience: "同学",
      pageRange: { min: 1, max: 3 },
      additionalRequirements: "",
      sources: [{ bookId: "book-a", title: "第二本书", author: null }],
      publicSources: [{
        url: "https://publisher.example.invalid/catalog/book",
        title: "出版社公开目录",
        publishedAt: null,
        fetchedAt: "2026-09-06T00:00:00.000Z",
        usageScope: "outline",
      }],
    }, new AbortController().signal);

    expect(result.paragraphs).toEqual([
      { id: "id-1", level: 1, text: "模型页" },
      { id: "id-2", level: 2, text: "模型点" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.max_tokens).toBe(512);
    expect(body.messages.some((message) => message.role === "system")).toBe(true);
    expect(JSON.stringify(fetcher.mock.calls)).toContain(`Bearer ${key}`);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(key);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(key);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(key);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("maps chat port failures to a stable generation failure without echoing secrets", async () => {
    const secret = "must-not-appear";
    const chat: ChatResponderPort = {
      async chat(_input: ChatInput) {
        throw new Error(`upstream exploded ${secret}`);
      },
    };
    await expect(createRealPptOutlineGenerationAdapter({ chat }).createOutline({
      accountId: "account-a",
      draftId: "draft-a",
      purpose: null,
      audience: null,
      pageRange: null,
      additionalRequirements: "",
      sources: [],
      publicSources: [],
    }, new AbortController().signal)).rejects.toThrow(PPT_OUTLINE_GENERATION_FAILED);
  });
});
