import { describe, expect, it, vi } from "vitest";
import { TextModelConfigurationError } from "@selfalone/domain";
import {
  createDeepSeekTextModelAdapter,
  type DeepSeekCatalog,
  type DeepSeekCredentialLease,
  type DeepSeekCredentialProvider,
} from "./deepseek-text-model-adapter";

const catalog: DeepSeekCatalog = {
  endpoint: "https://fake.deepseek.invalid/v1",
  model: "fake-deepseek-model",
};

describe("DeepSeek credential validation seam", () => {
  it("uses only the injected catalog and fetcher, with no client endpoint or model input", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const adapter = createDeepSeekTextModelAdapter({ fetcher, catalog });

    await expect(adapter.validateCredential({ provider: "deepseek", apiKey: "secret-key" }))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://fake.deepseek.invalid/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret-key" }),
      }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(String(request?.body)).toContain('"model":"fake-deepseek-model"');
    expect(String(request?.body)).not.toContain("endpoint");
  });

  it("maps provider HTTP failures and malformed success to a stable validation error without echoing the key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 401 }));
    const adapter = createDeepSeekTextModelAdapter({ fetcher, catalog });
    await expect(adapter.validateCredential({ provider: "deepseek", apiKey: "secret-key" }))
      .rejects.toMatchObject({ code: "MODEL_CREDENTIAL_VALIDATION_FAILED" });

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(adapter.validateCredential({ provider: "deepseek", apiKey: "secret-key" }))
      .rejects.toMatchObject({ code: "MODEL_CREDENTIAL_VALIDATION_FAILED" });
    await expect(Promise.reject(new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_FAILED")))
      .rejects.not.toThrow("secret-key");
  });
});

describe("DeepSeek chat adapter", () => {
  it("leases the account credential and sends the complete ordered context with the bounded chat contract", async () => {
    const key = "unit-only-deepseek-chat-secret";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "真实回答" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const credentialProvider: DeepSeekCredentialProvider = {
      async withVerifiedTextModelCredential<T>(
        accountId: string,
        consume: (lease: DeepSeekCredentialLease) => Promise<T>,
      ) {
        expect(accountId).toBe("account-a");
        return consume({ provider: "deepseek", apiKey: key });
      },
    };
    const adapter = createDeepSeekTextModelAdapter({ fetcher, catalog, credentialProvider });

    await expect(adapter.chat({
      accountId: "account-a",
      text: "当前问题",
      context: [
        { id: "system-1", role: "system", text: "系统约束" },
        { id: "user-1", role: "user", text: "第一轮", requestId: "request-1" },
        { id: "assistant-1", role: "assistant", text: "第一答", requestId: "request-1" },
        { id: "user-2", role: "user", text: "当前问题", requestId: "request-2" },
      ],
    }, new AbortController().signal)).resolves.toEqual({ text: "真实回答" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://fake.deepseek.invalid/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "application/json",
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "fake-deepseek-model",
      messages: [
        { role: "system", content: "系统约束" },
        { role: "user", content: "第一轮" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "当前问题" },
      ],
      thinking: { type: "disabled" },
      max_tokens: 128,
      stream: false,
    });
    expect(JSON.stringify({ body })).not.toContain(key);
  });

  it("maps missing credentials, provider failures, network failures, aborts, and empty choices to safe chat failures", async () => {
    const key = "unit-only-chat-failure-secret";
    const credentialProvider: DeepSeekCredentialProvider = {
      async withVerifiedTextModelCredential<T>(
        _accountId: string,
        consume: (lease: DeepSeekCredentialLease) => Promise<T>,
      ) {
        return consume({ provider: "deepseek", apiKey: key });
      },
    };
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createDeepSeekTextModelAdapter({ fetcher, catalog, credentialProvider });
    const input = {
      accountId: "account-a",
      text: "需要失败关闭",
      context: [{ id: "user-1", role: "user" as const, text: "需要失败关闭" }],
    };

    const noCredential = createDeepSeekTextModelAdapter({ fetcher, catalog });
    await expect(noCredential.chat(input, new AbortController().signal))
      .rejects.toThrow("DEEPSEEK_CREDENTIAL_UNAVAILABLE");

    for (const status of [401, 403, 429, 500]) {
      fetcher.mockResolvedValueOnce(new Response(`provider body ${key}`, { status }));
      const error = await adapter.chat(input, new AbortController().signal).catch((reason) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "DEEPSEEK_CHAT_FAILED" });
      expect(String(error)).not.toContain(key);
    }

    fetcher.mockRejectedValueOnce(new Error(`network body ${key}`));
    await expect(adapter.chat(input, new AbortController().signal))
      .rejects.toThrow("DEEPSEEK_CHAT_FAILED");

    const aborted = new AbortController();
    aborted.abort();
    await expect(adapter.chat(input, aborted.signal))
      .rejects.toThrow("DEEPSEEK_CHAT_FAILED");

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(adapter.chat(input, new AbortController().signal))
      .rejects.toThrow("DEEPSEEK_CHAT_FAILED");
  });
});
