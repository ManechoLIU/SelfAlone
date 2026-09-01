import { createHash, randomUUID } from "node:crypto";
import type {
  ChatInput,
  ChatResponderPort,
  ChatResult,
} from "./conversation-responder";
import {
  createDeepSeekPlatformTextModelFromEnvironment,
  type DeepSeekPlatformTextModelEnvironment,
} from "./deepseek-text-model-adapter";

export const PLATFORM_EXHAUSTION = "PLATFORM_EXHAUSTION" as const;
export const PLATFORM_CONFIGURATION_REQUIRED = "PLATFORM_CONFIGURATION_REQUIRED" as const;
export const PLATFORM_UNAVAILABLE = "PLATFORM_UNAVAILABLE" as const;

export type PlatformTextCapabilityErrorCode =
  | typeof PLATFORM_EXHAUSTION
  | typeof PLATFORM_CONFIGURATION_REQUIRED
  | typeof PLATFORM_UNAVAILABLE;

export type MeteredPlatformChatResult = ChatResult & {
  actualCostMicros: number;
};

export type MeteredPlatformChatPort = {
  chat(input: ChatInput, signal: AbortSignal): Promise<MeteredPlatformChatResult>;
};

export type PlatformTextCapabilityOptions = {
  configuredUserModel: ChatResponderPort;
  modelConfiguration: {
    getStatus(accountId: string): Promise<unknown | null>;
  };
  trialQuota: {
    getStatus(accountId: string): Promise<{ status: "unclaimed" | "claimed" }>;
  };
  costLedger: {
    reserve(input: {
      accountId: string;
      operationId: string;
      reservationId: string;
      amountMicros: number;
    }): Promise<unknown>;
    settle(input: {
      accountId: string;
      operationId: string;
      reservationId: string;
      actualMicros: number;
    }): Promise<unknown>;
    release(input: {
      accountId: string;
      operationId: string;
      reservationId: string;
    }): Promise<unknown>;
  };
  platformModel?: MeteredPlatformChatPort;
  reservationAmountMicros: number;
  attemptIdFactory?: () => string;
};

export type PlatformTextCapabilityRuntimeOptions = Omit<
  PlatformTextCapabilityOptions,
  "platformModel"
> & {
  environment: DeepSeekPlatformTextModelEnvironment;
  fetcher?: typeof fetch;
};

export function createPlatformTextCapabilityFromEnvironment(
  options: PlatformTextCapabilityRuntimeOptions,
): ChatResponderPort {
  const { environment, fetcher, ...capabilityOptions } = options;
  const platformModel = createDeepSeekPlatformTextModelFromEnvironment({
    environment,
    ...(fetcher ? { fetcher } : {}),
  });
  return createPlatformTextCapability({ ...capabilityOptions, platformModel });
}

export function createPlatformTextCapability(
  options: PlatformTextCapabilityOptions,
): ChatResponderPort {
  return {
    async chat(input, signal) {
      const configured = await readConfigurationStatus(options, input.accountId);
      if (configured) {
        return options.configuredUserModel.chat(input, signal);
      }

      const trial = await readTrialStatus(options, input.accountId);
      if (trial.status !== "claimed") {
        throw new Error(PLATFORM_CONFIGURATION_REQUIRED);
      }
      if (!options.platformModel) {
        throw new Error(PLATFORM_UNAVAILABLE);
      }

      const requestId = currentRequestId(input);
      if (!requestId) throw new Error(PLATFORM_UNAVAILABLE);
      const attemptId = safeId(options.attemptIdFactory?.() ?? randomUUID());
      const requestScope = safeId(requestId);
      const operationId = `platform-text:${requestScope}:${attemptId}`;
      const reservation = {
        accountId: input.accountId,
        operationId,
        reservationId: operationId,
      };

      try {
        await options.costLedger.reserve({
          ...reservation,
          amountMicros: options.reservationAmountMicros,
        });
      } catch (error) {
        throw new Error(isCostLimit(error) ? PLATFORM_EXHAUSTION : PLATFORM_UNAVAILABLE);
      }

      try {
        const result = await options.platformModel.chat(input, signal);
        if (
          !result
          || typeof result.text !== "string"
          || !result.text.trim()
          || !Number.isSafeInteger(result.actualCostMicros)
          || result.actualCostMicros < 0
        ) {
          throw new Error(PLATFORM_UNAVAILABLE);
        }
        await options.costLedger.settle({
          ...reservation,
          actualMicros: result.actualCostMicros,
        });
        return { text: result.text };
      } catch (error) {
        await releaseReservation(options, reservation);
        throw new Error(isCostLimit(error) ? PLATFORM_EXHAUSTION : PLATFORM_UNAVAILABLE);
      }
    },
  };
}

async function readConfigurationStatus(
  options: PlatformTextCapabilityOptions,
  accountId: string,
) {
  try {
    return await options.modelConfiguration.getStatus(accountId);
  } catch {
    throw new Error(PLATFORM_UNAVAILABLE);
  }
}

async function readTrialStatus(
  options: PlatformTextCapabilityOptions,
  accountId: string,
) {
  try {
    return await options.trialQuota.getStatus(accountId);
  } catch {
    throw new Error(PLATFORM_UNAVAILABLE);
  }
}

async function releaseReservation(
  options: PlatformTextCapabilityOptions,
  reservation: { accountId: string; operationId: string; reservationId: string },
) {
  try {
    await options.costLedger.release(reservation);
  } catch {
    // The caller still receives a stable unavailable state; the ledger owns
    // reconciliation evidence for an independently failed release.
  }
}

function currentRequestId(input: ChatInput) {
  for (let index = input.context.length - 1; index >= 0; index -= 1) {
    const entry = input.context[index];
    if (entry?.role === "user" && entry.requestId?.trim()) {
      return entry.requestId.trim();
    }
  }
  return undefined;
}

function safeId(value: string) {
  const normalized = value.trim();
  if (normalized && normalized.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(normalized)) {
    return normalized;
  }
  return createHash("sha256").update(normalized).digest("hex");
}

function isCostLimit(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "COST_LIMIT_EXCEEDED",
  );
}
