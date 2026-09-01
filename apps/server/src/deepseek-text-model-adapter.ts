import {
  TextModelConfigurationError,
  type TextModelAdapter,
  type TextModelCredentialValidationInput,
} from "@selfalone/domain";
import type {
  ChatInput,
  ChatResponderPort,
  ChatResult,
} from "./conversation-responder";

export type DeepSeekCatalog = {
  /** Server-owned base URL. It is never accepted from the browser. */
  endpoint: string;
  /** Server-owned model selection. It is never accepted from the browser. */
  model: string;
  validationPath?: string;
};

export const DEFAULT_DEEPSEEK_CATALOG: DeepSeekCatalog = Object.freeze({
  endpoint: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
});

export type DeepSeekCredentialLease = {
  readonly provider: "deepseek";
  readonly apiKey: string;
  readonly workspaceId?: string;
};

export type DeepSeekCredentialProvider = {
  withVerifiedTextModelCredential<T>(
    accountId: string,
    consume: (lease: DeepSeekCredentialLease) => Promise<T>,
  ): Promise<T>;
};

export type DeepSeekTextModelAdapterOptions = {
  catalog: DeepSeekCatalog;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  credentialProvider?: DeepSeekCredentialProvider;
};

const DEFAULT_TIMEOUT_MS = 10_000;
export const DEEPSEEK_CREDENTIAL_UNAVAILABLE = "DEEPSEEK_CREDENTIAL_UNAVAILABLE" as const;
export const DEEPSEEK_CHAT_FAILED = "DEEPSEEK_CHAT_FAILED" as const;
export const PLATFORM_MODEL_CONFIGURATION_INVALID =
  "PLATFORM_MODEL_CONFIGURATION_INVALID" as const;

export const PLATFORM_DEEPSEEK_API_KEY_ENV = "PLATFORM_DEEPSEEK_API_KEY" as const;
export const PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_PRICE_ENV =
  "PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION" as const;
export const PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_PRICE_ENV =
  "PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION" as const;
export const PLATFORM_DEEPSEEK_OUTPUT_PRICE_ENV =
  "PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION" as const;

export type DeepSeekPlatformTextModelEnvironment = Record<string, string | undefined>;

export type DeepSeekPlatformTextModelOptions = {
  environment: DeepSeekPlatformTextModelEnvironment;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  catalog?: DeepSeekCatalog;
};

export type DeepSeekMeteredPlatformChatPort = {
  chat(
    input: ChatInput,
    signal: AbortSignal,
  ): Promise<ChatResult & { actualCostMicros: number }>;
};

/**
 * Resolves the server-owned platform credential and pricing snapshot. An
 * absent configuration keeps the free capability unavailable; a partial or
 * malformed configuration fails startup instead of silently undercounting.
 */
export function createDeepSeekPlatformTextModelFromEnvironment(
  options: DeepSeekPlatformTextModelOptions,
): DeepSeekMeteredPlatformChatPort | undefined {
  const rawApiKey = options.environment[PLATFORM_DEEPSEEK_API_KEY_ENV];
  const apiKey = rawApiKey?.trim();
  const cacheHitPrice = options.environment[PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_PRICE_ENV]?.trim();
  const cacheMissPrice = options.environment[PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_PRICE_ENV]?.trim();
  const outputPrice = options.environment[PLATFORM_DEEPSEEK_OUTPUT_PRICE_ENV]?.trim();
  const configuredValues = [apiKey, cacheHitPrice, cacheMissPrice, outputPrice];
  if (configuredValues.every((value) => !value)) return undefined;
  if (
    configuredValues.some((value) => !value)
    || !apiKey
    || apiKey.length > 4_096
    || (rawApiKey !== undefined && /[\u0000-\u001F\u007F-\u009F]/.test(rawApiKey))
  ) {
    throw new Error(PLATFORM_MODEL_CONFIGURATION_INVALID);
  }

  const pricing = {
    cacheHitMicrosPerMillion: parsePositivePrice(cacheHitPrice),
    cacheMissMicrosPerMillion: parsePositivePrice(cacheMissPrice),
    outputMicrosPerMillion: parsePositivePrice(outputPrice),
  };
  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const catalog = options.catalog ?? DEFAULT_DEEPSEEK_CATALOG;
  if (!fetcher || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(PLATFORM_MODEL_CONFIGURATION_INVALID);
  }
  const endpoint = joinEndpoint(catalog.endpoint, catalog.validationPath ?? "/chat/completions");
  if (!endpoint || !catalog.model.trim()) {
    throw new Error(PLATFORM_MODEL_CONFIGURATION_INVALID);
  }

  return {
    async chat(input, signal) {
      const payload = await requestChatPayload({
        fetcher,
        endpoint,
        model: catalog.model,
        timeoutMs,
        input,
        apiKey,
        signal,
      });
      const text = extractChatText(payload);
      const usage = extractChatUsage(payload);
      if (!text || !usage) throw new Error(DEEPSEEK_CHAT_FAILED);
      return {
        text,
        actualCostMicros: calculateActualCostMicros(usage, pricing),
      };
    },
  };
}

/**
 * DeepSeek validation is intentionally a small injected seam. Production
 * wiring supplies the catalog and fetch implementation; tests use fake HTTP
 * responses and never contact the provider.
 */
export function createDeepSeekTextModelAdapter(
  options: DeepSeekTextModelAdapterOptions,
): TextModelAdapter & ChatResponderPort {
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
            thinking: { type: "disabled" },
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
    async chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult> {
      if (!options.credentialProvider) {
        throw new Error(DEEPSEEK_CREDENTIAL_UNAVAILABLE);
      }
      if (signal.aborted) throw new Error(DEEPSEEK_CHAT_FAILED);

      try {
        return await options.credentialProvider.withVerifiedTextModelCredential(
          input.accountId,
          async (lease) => {
            if (
              lease.provider !== "deepseek"
              || typeof lease.apiKey !== "string"
              || !lease.apiKey.trim()
            ) {
              throw new Error(DEEPSEEK_CREDENTIAL_UNAVAILABLE);
            }
            return requestChat({
              fetcher,
              endpoint,
              model: options.catalog.model,
              timeoutMs,
              input,
              apiKey: lease.apiKey,
              signal,
            });
          },
        );
      } catch (error) {
        if (
          error instanceof Error
          && (
            error.message === DEEPSEEK_CREDENTIAL_UNAVAILABLE
            || error.message === "MODEL_CREDENTIAL_NOT_CONFIGURED"
            || error.message === "MODEL_CREDENTIAL_UNAVAILABLE"
            || error.message === "MODEL_CREDENTIAL_PROVIDER_UNSUPPORTED"
          )
        ) {
          throw new Error(DEEPSEEK_CREDENTIAL_UNAVAILABLE);
        }
        if (error instanceof Error && error.message === DEEPSEEK_CHAT_FAILED) {
          throw error;
        }
        throw new Error(DEEPSEEK_CHAT_FAILED);
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

async function requestChat(input: {
  fetcher: typeof fetch;
  endpoint: string;
  model: string;
  timeoutMs: number;
  input: ChatInput;
  apiKey: string;
  signal: AbortSignal;
}): Promise<ChatResult> {
  const payload = await requestChatPayload(input);
  const text = extractChatText(payload);
  if (!text) throw new Error(DEEPSEEK_CHAT_FAILED);
  return { text };
}

async function requestChatPayload(input: {
  fetcher: typeof fetch;
  endpoint: string;
  model: string;
  timeoutMs: number;
  input: ChatInput;
  apiKey: string;
  signal: AbortSignal;
}): Promise<unknown> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (input.signal.aborted) {
    controller.abort();
  } else {
    input.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.input.context.map((entry) => ({
          role: entry.role,
          content: entry.text,
        })),
        thinking: { type: "disabled" },
        max_tokens: 128,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(DEEPSEEK_CHAT_FAILED);
    return await readJson(response);
  } catch {
    throw new Error(DEEPSEEK_CHAT_FAILED);
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", forwardAbort);
  }
}

type DeepSeekChatUsage = {
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
};

function extractChatUsage(value: unknown): DeepSeekChatUsage | undefined {
  if (!value || typeof value !== "object" || !("usage" in value)) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage as Record<string, unknown>;
  const promptTokens = safeTokenCount(input.prompt_tokens);
  const promptCacheHitTokens = safeTokenCount(input.prompt_cache_hit_tokens);
  const promptCacheMissTokens = safeTokenCount(input.prompt_cache_miss_tokens);
  const completionTokens = safeTokenCount(input.completion_tokens);
  const totalTokens = safeTokenCount(input.total_tokens);
  if (
    promptTokens === undefined
    || promptCacheHitTokens === undefined
    || promptCacheMissTokens === undefined
    || completionTokens === undefined
    || totalTokens === undefined
    || promptTokens !== promptCacheHitTokens + promptCacheMissTokens
    || totalTokens !== promptTokens + completionTokens
  ) {
    return undefined;
  }
  return { promptCacheHitTokens, promptCacheMissTokens, completionTokens };
}

function safeTokenCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function parsePositivePrice(value: string | undefined) {
  if (!value || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(PLATFORM_MODEL_CONFIGURATION_INVALID);
  }
  const price = Number(value);
  if (!Number.isSafeInteger(price)) throw new Error(PLATFORM_MODEL_CONFIGURATION_INVALID);
  return price;
}

function calculateActualCostMicros(
  usage: DeepSeekChatUsage,
  pricing: {
    cacheHitMicrosPerMillion: number;
    cacheMissMicrosPerMillion: number;
    outputMicrosPerMillion: number;
  },
) {
  const numerator =
    BigInt(usage.promptCacheHitTokens) * BigInt(pricing.cacheHitMicrosPerMillion)
    + BigInt(usage.promptCacheMissTokens) * BigInt(pricing.cacheMissMicrosPerMillion)
    + BigInt(usage.completionTokens) * BigInt(pricing.outputMicrosPerMillion);
  const micros = (numerator + 999_999n) / 1_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(DEEPSEEK_CHAT_FAILED);
  }
  return Number(micros);
}

function extractChatText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("choices" in value)) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return undefined;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object" || !("content" in message)) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content : undefined;
}

function hasCompletion(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("choices" in value)) return false;
  const choices = (value as { choices?: unknown }).choices;
  return Array.isArray(choices) && choices.length > 0;
}
