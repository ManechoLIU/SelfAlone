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
      environment: {
        PLATFORM_DEEPSEEK_API_KEY: "platform-only-test-key",
        PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
        PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
        PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
      },
      fetcher,
      attemptIdFactory: () => "attempt-runtime",
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
        PLATFORM_DEEPSEEK_API_KEY: "platform-key\nInjected: value",
        PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
        PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
        PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
      },
    })).toThrow("PLATFORM_MODEL_CONFIGURATION_INVALID");
    expect(() => createPlatformTextCapabilityFromEnvironment({
      ...options,
      environment: {
        PLATFORM_DEEPSEEK_API_KEY: "\nplatform-key",
        PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION: "100000",
        PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION: "200000",
        PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION: "400000",
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
});
