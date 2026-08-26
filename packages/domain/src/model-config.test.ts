import { describe, expect, it } from "vitest";
import {
  TEXT_MODEL_PROVIDERS,
  TEXT_MODEL_PROVIDER_OPTIONS,
  maskTextModelApiKey,
  normalizeTextModelCredentialInput,
} from "./model-config";

describe("text model credential domain contract", () => {
  it("accepts only the four fixed providers and keeps provider metadata server-owned", () => {
    expect(TEXT_MODEL_PROVIDERS).toEqual(["deepseek", "kimi", "glm", "qwen"]);
    expect(TEXT_MODEL_PROVIDER_OPTIONS.map((option) => option.id)).toEqual([
      "deepseek",
      "kimi",
      "glm",
      "qwen",
    ]);
    expect(TEXT_MODEL_PROVIDER_OPTIONS.map((option) => option.label)).toEqual([
      "DeepSeek",
      "Kimi（月之暗面）",
      "GLM（智谱）",
      "通义千问（阿里云百炼）",
    ]);
    expect(() => normalizeTextModelCredentialInput({ provider: "other", apiKey: "secret" }))
      .toThrow("MODEL_CREDENTIALS_INVALID_REQUEST");
    expect(() => normalizeTextModelCredentialInput({
      provider: "deepseek",
      apiKey: "secret",
      endpoint: "https://attacker.invalid",
      model: "attacker-model",
    } as never)).toThrow("MODEL_CREDENTIALS_INVALID_REQUEST");
  });

  it("requires Qwen workspace only for Qwen and masks the key without echoing it", () => {
    expect(normalizeTextModelCredentialInput({
      provider: "deepseek",
      apiKey: "  deepseek-secret-1234  ",
    })).toEqual({ provider: "deepseek", apiKey: "deepseek-secret-1234" });
    expect(normalizeTextModelCredentialInput({
      provider: "qwen",
      apiKey: "qwen-secret",
      workspaceId: " workspace-1 ",
    })).toEqual({ provider: "qwen", apiKey: "qwen-secret", workspaceId: "workspace-1" });
    expect(() => normalizeTextModelCredentialInput({ provider: "qwen", apiKey: "qwen-secret" }))
      .toThrow("MODEL_CREDENTIALS_INVALID_REQUEST");
    expect(() => normalizeTextModelCredentialInput({
      provider: "deepseek",
      apiKey: "deepseek-secret",
      workspaceId: "unexpected",
    })).toThrow("MODEL_CREDENTIALS_INVALID_REQUEST");
    expect(maskTextModelApiKey("deepseek-secret-1234")).toBe("••••••••1234");
  });
});
