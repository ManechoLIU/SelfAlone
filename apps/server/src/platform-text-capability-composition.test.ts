import { describe, expect, it } from "vitest";
import {
  createConversationResponder,
  type ChatResponderPort,
  type ConversationResponder,
} from "./conversation-responder";
import { createPlatformTextCapabilityFromEnvironment } from "./platform-text-capability";

describe("platform text capability composition", () => {
  it("wires the separate platform credential and settles provider-reported token usage", async () => {
    const events: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      events.push("platform-model");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer platform-only-test-key",
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "平台体验回答" } }],
        usage: {
          prompt_tokens: 30,
          prompt_cache_hit_tokens: 10,
          prompt_cache_miss_tokens: 20,
          completion_tokens: 5,
          total_tokens: 35,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const capability = createPlatformTextCapabilityFromEnvironment({
      configuredUserModel: {
        async chat() {
          throw new Error("USER_MODEL_MUST_NOT_RUN");
        },
      },
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" }; } },
      costLedger: {
        async reserve(input) {
          events.push(`reserve:${input.amountMicros}`);
          return {};
        },
        async settle(input) {
          events.push(`settle:${input.actualMicros}`);
          return {};
        },
        async release() {
          events.push("release");
          return {};
        },
        async getReservation() {
          throw new Error("COST_RESERVATION_NOT_FOUND");
        },
      },
      reservationAmountMicros: 500_000,
      environment: SIX_PERIOD_PRICES,
      fetcher,
      attemptIdFactory: () => "attempt-runtime",
      now: () => new Date("2026-09-01T12:00:00+08:00"),
    });

    const result = await capability.chat({
      accountId: "account-a",
      text: "继续当前问题",
      context: [{
        id: "request-runtime:user",
        role: "user",
        text: "继续当前问题",
        requestId: "request-runtime",
      }],
    }, new AbortController().signal);

    expect(result).toEqual({ text: "平台体验回答" });
    expect(events).toEqual(["reserve:500000", "platform-model", "settle:7"]);
  });

  it("rejects partial or control-character platform credentials before serving requests", () => {
    const options = {
      configuredUserModel: { async chat() { return { text: "unused" }; } },
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" as const }; } },
      costLedger: {
        async reserve() { return {}; },
        async settle() { return {}; },
        async release() { return {}; },
        async getReservation() {
          throw new Error("COST_RESERVATION_NOT_FOUND");
        },
      },
      reservationAmountMicros: 500_000,
      fetcher: async () => new Response(null, { status: 500 }),
      attemptIdFactory: () => "attempt-runtime",
    };

    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...options,
      environment: { PLATFORM_DEEPSEEK_API_KEY: "partial-key" },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");
    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...options,
      environment: {
        ...SIX_PERIOD_PRICES,
        PLATFORM_DEEPSEEK_API_KEY: "platform-key\nInjected: value",
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");
    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...options,
      environment: {
        ...SIX_PERIOD_PRICES,
        PLATFORM_DEEPSEEK_API_KEY: "\nplatform-key",
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");
  });

  it("uses the eligible platform capability when no configured user model is available", async () => {
    let platformCalls = 0;
    const platformCapability: ChatResponderPort = {
      async chat(input) {
        platformCalls += 1;
        expect(input).toEqual({
          accountId: "account-a",
          text: "继续当前问题",
          context: [
            {
              id: "request-a:user",
              role: "user",
              text: "继续当前问题",
              requestId: "request-a",
            },
          ],
        });
        return { text: "平台体验回答" };
      },
    };
    const composeResponder = createConversationResponder as unknown as (
      configuredUserModel: ChatResponderPort | undefined,
      eligiblePlatformCapability: ChatResponderPort,
    ) => ConversationResponder;
    const responder = composeResponder(undefined, platformCapability);

    await expect(responder("account-a", "继续当前问题", [
      {
        id: "request-a:user",
        role: "user",
        text: "继续当前问题",
        requestId: "request-a",
      },
    ])).resolves.toBe("平台体验回答");
    expect(platformCalls).toBe(1);
  });

  it("selects peak and off-peak prices at Beijing weekday 11:59→12:00, 14:00→18:00, and weekend boundaries", async () => {
    const cases = [
      { at: "2026-09-01T08:59:00+08:00", settle: "settle:7" },
      { at: "2026-09-01T09:00:00+08:00", settle: "settle:20" },
      { at: "2026-09-01T11:59:00+08:00", settle: "settle:20" },
      { at: "2026-09-01T12:00:00+08:00", settle: "settle:7" },
      { at: "2026-09-01T14:00:00+08:00", settle: "settle:20" },
      { at: "2026-09-01T18:00:00+08:00", settle: "settle:7" },
      { at: "2026-09-05T10:00:00+08:00", settle: "settle:7" },
      { at: "2026-09-06T15:00:00+08:00", settle: "settle:7" },
    ];

    for (const row of cases) {
      const events: string[] = [];
      const options = scheduledCapabilityOptions({
        events,
        environment: SIX_PERIOD_PRICES,
        now: () => new Date(row.at),
        fetcher: async () => {
          events.push("platform-model");
          return platformUsageResponse();
        },
      });
      const capability = createPlatformTextCapabilityFromEnvironment(options);
      await expect(capability.chat(platformChatInput, new AbortController().signal))
        .resolves.toEqual({ text: "平台体验回答" });
      expect(events, row.at).toEqual(["reserve:500000", "platform-model", row.settle]);
    }
  });

  it("reads the injected clock once before fetch and keeps the request-start period", async () => {
    let current = new Date("2026-09-01T11:59:00+08:00");
    let clockCalls = 0;
    const events: string[] = [];
    const options = scheduledCapabilityOptions({
      events,
      environment: SIX_PERIOD_PRICES,
      now: () => {
        clockCalls += 1;
        return current;
      },
      fetcher: async () => {
        current = new Date("2026-09-01T12:00:00+08:00");
        events.push("platform-model");
        return platformUsageResponse();
      },
    });
    const capability = createPlatformTextCapabilityFromEnvironment(options);
    await expect(capability.chat(platformChatInput, new AbortController().signal))
      .resolves.toEqual({ text: "平台体验回答" });
    expect(events).toEqual(["reserve:500000", "platform-model", "settle:20"]);
    expect(clockCalls).toBe(1);
  });

  it("requires a key plus all six peak and off-peak prices and fails closed on legacy, partial, invalid, or illegal-clock config", async () => {
    const base = scheduledCapabilityOptions({ environment: {} });

    const unavailable = createPlatformTextCapabilityFromEnvironment({
      ...base,
      environment: {},
    });
    await expect(unavailable.chat(platformChatInput, new AbortController().signal))
      .rejects.toThrow("PLATFORM_UNAVAILABLE");

    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...base,
      environment: {
        PLATFORM_DEEPSEEK_API_KEY: "platform-only-test-key",
        PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
        PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
        PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");

    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...base,
      environment: {
        ...SIX_PERIOD_PRICES,
        PLATFORM_DEEPSEEK_OFF_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: undefined,
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");

    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...base,
      environment: {
        PLATFORM_DEEPSEEK_PEAK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "300000",
        PLATFORM_DEEPSEEK_PEAK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "600000",
        PLATFORM_DEEPSEEK_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: "900000",
        PLATFORM_DEEPSEEK_OFF_PEAK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
        PLATFORM_DEEPSEEK_OFF_PEAK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
        PLATFORM_DEEPSEEK_OFF_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");

    for (const invalidPrice of ["0", "01", "-1", "1.5"]) {
      expect(() => createPlatformTextCapabilityFromEnvironment({
        ...base,
        environment: {
          ...SIX_PERIOD_PRICES,
          PLATFORM_DEEPSEEK_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: invalidPrice,
        },
      })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");
    }

    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...base,
      environment: SIX_PERIOD_PRICES,
      now: 1 as never,
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");

    for (const now of [
      () => new Date(Number.NaN),
      () => "not-a-date" as never,
      () => { throw new Error("clock failed"); },
    ]) {
      let fetchCalls = 0;
      const invalidClock = createPlatformTextCapabilityFromEnvironment({
        ...base,
        environment: SIX_PERIOD_PRICES,
        now,
        fetcher: async () => {
          fetchCalls += 1;
          return platformUsageResponse();
        },
      });
      await expect(invalidClock.chat(platformChatInput, new AbortController().signal))
        .rejects.toThrow("PLATFORM_UNAVAILABLE");
      expect(fetchCalls).toBe(0);
    }
  });
});

const platformChatInput = {
  accountId: "account-a",
  text: "继续当前问题",
  context: [{
    id: "request-runtime:user" as const,
    role: "user" as const,
    text: "继续当前问题",
    requestId: "request-runtime",
  }],
};

const SIX_PERIOD_PRICES = {
  PLATFORM_DEEPSEEK_API_KEY: "platform-only-test-key",
  PLATFORM_DEEPSEEK_PEAK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "300000",
  PLATFORM_DEEPSEEK_PEAK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "600000",
  PLATFORM_DEEPSEEK_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: "900000",
  PLATFORM_DEEPSEEK_OFF_PEAK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
  PLATFORM_DEEPSEEK_OFF_PEAK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
  PLATFORM_DEEPSEEK_OFF_PEAK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
};

function platformUsageResponse() {
  return new Response(JSON.stringify({
    choices: [{ message: { content: "平台体验回答" } }],
    usage: {
      prompt_tokens: 30,
      prompt_cache_hit_tokens: 10,
      prompt_cache_miss_tokens: 20,
      completion_tokens: 5,
      total_tokens: 35,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function scheduledCapabilityOptions(input: {
  environment: Record<string, string | undefined>;
  events?: string[];
  now?: () => Date;
  fetcher?: typeof fetch;
}) {
  const events = input.events ?? [];
  return {
    configuredUserModel: {
      async chat() {
        throw new Error("USER_MODEL_MUST_NOT_RUN");
      },
    },
    modelConfiguration: { async getStatus() { return null; } },
    trialQuota: { async getStatus() { return { status: "claimed" as const }; } },
    costLedger: {
      async reserve(value: { amountMicros: number }) {
        events.push(`reserve:${value.amountMicros}`);
        return {};
      },
      async settle(value: { actualMicros: number }) {
        events.push(`settle:${value.actualMicros}`);
        return {};
      },
      async release() {
        events.push("release");
        return {};
      },
      async getReservation() {
        throw new Error("COST_RESERVATION_NOT_FOUND");
      },
    },
    reservationAmountMicros: 500_000,
    environment: input.environment,
    fetcher: input.fetcher ?? (async () => new Response(null, { status: 500 })),
    attemptIdFactory: () => "attempt-runtime",
    ...(input.now ? { now: input.now } : {}),
  };
}
