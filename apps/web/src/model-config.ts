import type { TextModelCredentialStatus, TextModelProvider } from "@selfalone/contracts";

export type TextModelProviderId = TextModelProvider;

export const TEXT_MODEL_PROVIDERS: ReadonlyArray<{ id: TextModelProviderId; label: string }> = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "kimi", label: "Kimi（月之暗面）" },
  { id: "glm", label: "GLM（智谱）" },
  { id: "qwen", label: "通义千问（阿里云百炼）" },
];

export type TextModelCredential = TextModelCredentialStatus;

export type TextModelDraft = {
  provider: TextModelProviderId;
  apiKey: string;
  workspaceId: string;
  existingMaskedApiKey: string;
  showApiKey: boolean;
};

export function requiresWorkspaceId(provider: TextModelProviderId) {
  return provider === "qwen";
}

export function createTextModelDraft(credential?: TextModelCredential | null): TextModelDraft {
  const provider = credential?.provider ?? "deepseek";
  return {
    provider,
    apiKey: "",
    workspaceId: credential?.workspaceId ?? "",
    existingMaskedApiKey: credential?.maskedApiKey ?? "",
    showApiKey: false,
  };
}

export function validateTextModelDraft(draft: TextModelDraft) {
  const errors: Record<string, string> = {};
  if (!TEXT_MODEL_PROVIDERS.some((option) => option.id === draft.provider)) {
    errors.provider = "请选择列表中的供应商。";
  }
  if (!draft.apiKey.trim()) errors.apiKey = "请输入 API Key。";
  if (requiresWorkspaceId(draft.provider) && !draft.workspaceId.trim()) {
    errors.workspaceId = "请输入业务空间 ID。";
  }
  return errors;
}

export function getTextModelErrorMessage(code: string) {
  switch (code) {
    case "MODEL_CREDENTIAL_VALIDATION_FAILED":
    case "MODEL_VALIDATION_FAILED":
      return "校验未通过，请检查 API Key 和业务空间 ID。";
    case "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE":
    case "MODEL_VALIDATION_UNAVAILABLE":
      return "暂时无法连接供应商进行校验，请稍后重试。";
    case "INVALID_REQUEST":
    case "MODEL_CREDENTIALS_INVALID_REQUEST":
      return "请检查配置内容后重试。";
    case "MODEL_CREDENTIALS_STALE":
    case "STALE_VERSION":
      return "配置已更新，请重新打开此页后再试。";
    case "AUTH_REQUIRED":
      return "登录状态已失效，请重新登录。";
    default:
      return "配置暂时没有保存，已保留你填写的内容，可重试。";
  }
}

export function isCurrentTextModelRequest(
  requestVersion: number,
  currentVersion: number,
  requestRoute: string,
  currentRoute: string,
) {
  return requestVersion === currentVersion && requestRoute === currentRoute;
}

export function textModelProviderLabel(provider: TextModelProviderId) {
  return TEXT_MODEL_PROVIDERS.find((option) => option.id === provider)?.label ?? provider;
}
