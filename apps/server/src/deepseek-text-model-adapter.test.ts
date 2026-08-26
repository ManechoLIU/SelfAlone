import { describe, expect, it, vi } from "vitest";
import { TextModelConfigurationError } from "@selfalone/domain";
import { createDeepSeekTextModelAdapter, type DeepSeekCatalog } from "./deepseek-text-model-adapter";

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
