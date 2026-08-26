import {
  TextModelConfigurationError,
  type TextModelAdapter,
  type TextModelCredentialValidationInput,
} from "@selfalone/domain";

export type DeepSeekCatalog = {
  /** Server-owned base URL. It is never accepted from the browser. */
  endpoint: string;
  /** Server-owned model selection. It is never accepted from the browser. */
  model: string;
  validationPath?: string;
};

export type DeepSeekTextModelAdapterOptions = {
  catalog: DeepSeekCatalog;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * DeepSeek validation is intentionally a small injected seam. Production
 * wiring supplies the catalog and fetch implementation; tests use fake HTTP
 * responses and never contact the provider.
 */
export function createDeepSeekTextModelAdapter(
  options: DeepSeekTextModelAdapterOptions,
): TextModelAdapter {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!fetcher || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE");
  }
  const endpoint = joinEndpoint(options.catalog.endpoint, options.catalog.validationPath ?? "/chat/completions");
  if (!endpoint || !options.catalog.model.trim()) {
    throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE");
  }

  return {
    async validateCredential(input: TextModelCredentialValidationInput) {
      if (input.provider !== "deepseek") {
        throw new TextModelConfigurationError("MODEL_CREDENTIALS_INVALID_REQUEST");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.catalog.model,
            messages: [{ role: "user", content: "Reply with OK." }],
            max_tokens: 1,
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw providerResponseError(response.status);
        }
        const payload = await readJson(response);
        if (!hasCompletion(payload)) {
          throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_FAILED");
        }
      } catch (error) {
        if (error instanceof TextModelConfigurationError) throw error;
        throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Explicit local-only seam for browser acceptance. The expected value must be
 * injected by the caller; there is no built-in development key or fallback.
 */
export function createDevelopmentTextModelValidator(expectedApiKey: string | undefined): TextModelAdapter {
  if (!expectedApiKey?.trim()) {
    throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE");
  }
  const expected = expectedApiKey.trim();
  return {
    async validateCredential(input) {
      if (input.provider !== "deepseek" || input.apiKey !== expected) {
        throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_FAILED");
      }
    },
  };
}

function joinEndpoint(endpoint: string, path: string) {
  const base = endpoint.trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (!/^https:\/\//i.test(base)) return "";
  return `${base}${suffix}`;
}

function providerResponseError(status: number) {
  return new TextModelConfigurationError(
    status === 408 || status === 425 || status === 429 || status >= 500
      ? "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE"
      : "MODEL_CREDENTIAL_VALIDATION_FAILED",
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function hasCompletion(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("choices" in value)) return false;
  const choices = (value as { choices?: unknown }).choices;
  return Array.isArray(choices) && choices.length > 0;
}
