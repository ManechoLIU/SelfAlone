import { describe, expect, it } from "vitest";
import {
  TEXT_MODEL_PROVIDERS,
  createTextModelDraft,
  getTextModelErrorMessage,
  isCurrentTextModelRequest,
  requiresWorkspaceId,
  validateTextModelDraft,
  type TextModelCredential,
} from "./model-config";

const configured: TextModelCredential = {
  provider: "qwen",
  maskedApiKey: "••••••••1234",
  workspaceId: "workspace-1",
  verifiedAt: "2026-08-23T00:00:00.000Z",
  catalogVersion: "text-models-v1",
  status: "verified",
};

describe("text model configuration state", () => {
  it("keeps the four fixed providers and only asks Qwen for a workspace", () => {
    expect(TEXT_MODEL_PROVIDERS).toEqual([
      { id: "deepseek", label: "DeepSeek" },
      { id: "kimi", label: "Kimi（月之暗面）" },
      { id: "glm", label: "GLM（智谱）" },
      { id: "qwen", label: "通义千问（阿里云百炼）" },
    ]);
    expect(requiresWorkspaceId("qwen")).toBe(true);
    expect(requiresWorkspaceId("deepseek")).toBe(false);
  });

  it("starts an existing configuration with a masked display and an empty replacement key", () => {
    expect(createTextModelDraft(configured)).toMatchObject({
      provider: "qwen",
      existingMaskedApiKey: "••••••••1234",
      apiKey: "",
      workspaceId: "workspace-1",
      showApiKey: false,
    });
  });

  it("validates the key and conditional workspace without losing input", () => {
    expect(validateTextModelDraft({
      provider: "qwen",
      apiKey: "",
      workspaceId: "",
      existingMaskedApiKey: "••••••••1234",
      showApiKey: false,
    })).toEqual({ apiKey: "请输入 API Key。", workspaceId: "请输入业务空间 ID。" });

    expect(validateTextModelDraft({
      provider: "qwen",
      apiKey: "new-secret",
      workspaceId: "workspace-2",
      existingMaskedApiKey: "••••••••1234",
      showApiKey: false,
    })).toEqual({});
  });

  it("maps validation, unavailable, stale and auth failures to actionable copy", () => {
    expect(getTextModelErrorMessage("MODEL_CREDENTIAL_VALIDATION_FAILED")).toContain("校验未通过");
    expect(getTextModelErrorMessage("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE")).toContain("暂时无法连接");
    expect(getTextModelErrorMessage("STALE_VERSION")).toContain("配置已更新");
    expect(getTextModelErrorMessage("AUTH_REQUIRED")).toContain("登录");
  });

  it("ignores a late response after a newer request or route change", () => {
    expect(isCurrentTextModelRequest(3, 3, "#/settings/text-model", "#/settings/text-model")).toBe(true);
    expect(isCurrentTextModelRequest(2, 3, "#/settings/text-model", "#/settings/text-model")).toBe(false);
    expect(isCurrentTextModelRequest(3, 3, "#/settings/text-model", "#/settings")).toBe(false);
  });
});
