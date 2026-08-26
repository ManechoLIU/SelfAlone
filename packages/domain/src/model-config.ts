/** The provider catalog is deliberately closed; clients never choose a URL or model. */
export const TEXT_MODEL_PROVIDERS = ["deepseek", "kimi", "glm", "qwen"] as const;

export type TextModelProvider = (typeof TEXT_MODEL_PROVIDERS)[number];

export type TextModelProviderOption = {
  readonly id: TextModelProvider;
  readonly label: string;
};

export const TEXT_MODEL_PROVIDER_OPTIONS: readonly TextModelProviderOption[] = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "kimi", label: "Kimi（月之暗面）" },
  { id: "glm", label: "GLM（智谱）" },
  { id: "qwen", label: "通义千问（阿里云百炼）" },
];

/** Bump only when the server-owned provider catalog is intentionally changed. */
export const TEXT_MODEL_CATALOG_VERSION = "text-models-v1";

export type TextModelCatalogEntry = {
  readonly provider: TextModelProvider;
  readonly displayName: string;
};

export const TEXT_MODEL_CATALOG: Readonly<Record<TextModelProvider, TextModelCatalogEntry>> =
  Object.fromEntries(TEXT_MODEL_PROVIDER_OPTIONS.map((option) => [option.id, {
    provider: option.id,
    displayName: option.label,
  }])) as Readonly<Record<TextModelProvider, TextModelCatalogEntry>>;

export type TextModelCredentialInput = {
  provider: string;
  apiKey: string;
  workspaceId?: string;
};

export type NormalizedTextModelCredentialInput = {
  provider: TextModelProvider;
  apiKey: string;
  workspaceId?: string;
};

export type TextModelCredentialValidationInput = NormalizedTextModelCredentialInput;

export interface TextModelAdapter {
  validateCredential(input: TextModelCredentialValidationInput): Promise<void>;
}

export type TextModelConfigurationErrorCode =
  | "MODEL_CREDENTIALS_INVALID_REQUEST"
  | "MODEL_CREDENTIAL_VALIDATION_FAILED"
  | "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE"
  | "MODEL_ENCRYPTION_KEY_REQUIRED"
  | "STALE_VERSION";

export class TextModelConfigurationError extends Error {
  readonly code: TextModelConfigurationErrorCode;

  constructor(code: TextModelConfigurationErrorCode) {
    super(code);
    this.name = "TextModelConfigurationError";
    this.code = code;
  }
}

export function isTextModelProvider(value: string): value is TextModelProvider {
  return (TEXT_MODEL_PROVIDERS as readonly string[]).includes(value);
}

function invalidRequest(): never {
  throw new TextModelConfigurationError("MODEL_CREDENTIALS_INVALID_REQUEST");
}

export function normalizeTextModelCredentialInput(
  input: TextModelCredentialInput,
): NormalizedTextModelCredentialInput {
  if (!input || typeof input !== "object") return invalidRequest();
  const unknownField = Object.keys(input).some((key) => !["provider", "apiKey", "workspaceId"].includes(key));
  if (unknownField || typeof input.provider !== "string" || !isTextModelProvider(input.provider)) {
    return invalidRequest();
  }
  if (typeof input.apiKey !== "string") return invalidRequest();
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0 || apiKey.length > 4_096) return invalidRequest();

  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : undefined;
  if (workspaceId !== undefined && (workspaceId.length === 0 || workspaceId.length > 256)) {
    return invalidRequest();
  }
  if (input.provider === "qwen" && !workspaceId) return invalidRequest();
  if (input.provider !== "qwen" && workspaceId !== undefined) return invalidRequest();

  return {
    provider: input.provider,
    apiKey,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

export function maskTextModelApiKey(apiKey: string) {
  if (apiKey.length <= 4) return "••••";
  return `••••••••${apiKey.slice(-4)}`;
}
