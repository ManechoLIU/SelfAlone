import { describe, expect, it } from "vitest";
import type { ChatInput, ChatResponderPort } from "./conversation-responder";
import {
  createPlatformTextCapability,
  PLATFORM_CONFIGURATION_REQUIRED,
  PLATFORM_EXHAUSTION,
  PLATFORM_UNAVAILABLE,
  type MeteredPlatformChatPort,
  type PlatformTextCapabilityOptions,
} from "./platform-text-capability";

const input: ChatInput = {
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
};

describe("platform text capability gate", () => {
  it("uses a configured user model without touching platform cost", async () => {
    const events: string[] = [];
    const capability = createPlatformTextCapability(createOptions({
      configured: true,
      configuredUserModel: responder("用户模型回答", () => events.push("user-model")),
      platformModel: meteredResponder("平台回答", 9, () => events.push("platform-model")),
      onTrialStatus: () => events.push("trial-status"),
      onReserve: () => events.push("reserve"),
      onSettle: () => events.push("settle"),
      onRelease: () => events.push("release"),
    }));

    await expect(capability.chat(input, signal())).resolves.toEqual({ text: "用户模型回答" });
    expect(events).toEqual(["user-model"]);
  });

  it("requires a claimed trial before reserving platform capacity", async () => {
    const events: string[] = [];
    const capability = createPlatformTextCapability(createOptions({
      configured: false,
      claimed: false,
      onTrialStatus: () => events.push("trial-status"),
      onReserve: () => events.push("reserve"),
    }));

    await expect(capability.chat(input, signal())).rejects.toThrow(
      PLATFORM_CONFIGURATION_REQUIRED,
    );
    expect(events).toEqual(["trial-status"]);
  });

  it("reserves before platform use and settles the provider-reported actual cost", async () => {
    const events: string[] = [];
    const capability = createPlatformTextCapability(createOptions({
      configured: false,
      claimed: true,
      attemptIds: ["attempt-success"],
      platformModel: meteredResponder("平台回答", 7, () => events.push("platform-model")),
      onTrialStatus: () => events.push("trial-status"),
      onReserve: (value) => events.push(`reserve:${value.amountMicros}:${value.operationId}`),
      onSettle: (value) => events.push(`settle:${value.actualMicros}:${value.operationId}`),
      onRelease: () => events.push("release"),
    }));

    await expect(capability.chat(input, signal())).resolves.toEqual({ text: "平台回答" });
    expect(events).toEqual([
      "trial-status",
      "reserve:10:platform-text:request-a:attempt-success",
      "platform-model",
      "settle:7:platform-text:request-a:attempt-success",
    ]);
  });

  it("releases and reports exhaustion when a failed settlement is still reserved", async () => {
    const events: string[] = [];
    const capability = createPlatformTextCapability({
      configuredUserModel: responder("unused"),
      modelConfiguration: { async getStatus() { return null; } },
      trialQuota: { async getStatus() { return { status: "claimed" }; } },
      costLedger: {
        async reserve() {
          events.push("reserve");
          return {};
        },
        async settle() {
          events.push("settle");
          throw Object.assign(new Error("COST_LIMIT_EXCEEDED"), {
            code: "COST_LIMIT_EXCEEDED",
          });
        },
        async getReservation() {
          events.push("read-reservation");
          return { status: "reserved" as const, actualMicros: null };
        },
        async release() {
          events.push("release");
          return {};
        },
      },
      platformModel: meteredResponder("平台回答", 7, () => events.push("platform-model")),
      reservationAmountMicros: 10,
      attemptIdFactory: () => "attempt-settle-failed",
    });

    await expect(capability.chat(input, signal())).rejects.toThrow(PLATFORM_EXHAUSTION);
    expect(events).toEqual([
      "reserve",
      "platform-model",
      "settle",
      "read-reservation",
      "release",
    ]);
  });

  it("maps exhausted capacity without calling the platform provider", async () => {
    const events: string[] = [];
    const capability = createPlatformTextCapability(createOptions({
      configured: false,
      claimed: true,
      platformModel: meteredResponder("不应调用", 1, () => events.push("platform-model")),
      onReserve: () => {
        events.push("reserve");
        throw Object.assign(new Error("COST_LIMIT_EXCEEDED"), { code: "COST_LIMIT_EXCEEDED" });
      },
    }));

    await expect(capability.chat(input, signal())).rejects.toThrow(PLATFORM_EXHAUSTION);
    expect(events).toEqual(["reserve"]);
  });

  it("releases a failed provider attempt and lets the same request retry with a new reservation", async () => {
    const events: string[] = [];
    let providerCalls = 0;
    const platformModel: MeteredPlatformChatPort = {
      async chat() {
        providerCalls += 1;
        events.push(`platform:${providerCalls}`);
        if (providerCalls === 1) throw new Error("PROVIDER_FAILED");
        return { text: "重试成功", actualCostMicros: 4 };
      },
    };
    const capability = createPlatformTextCapability(createOptions({
      configured: false,
      claimed: true,
      attemptIds: ["attempt-first", "attempt-retry"],
      platformModel,
      onReserve: (value) => events.push(`reserve:${value.operationId}`),
      onSettle: (value) => events.push(`settle:${value.operationId}`),
      onRelease: (value) => events.push(`release:${value.operationId}`),
    }));

    await expect(capability.chat(input, signal())).rejects.toThrow(PLATFORM_UNAVAILABLE);
    await expect(capability.chat(input, signal())).resolves.toEqual({ text: "重试成功" });
    expect(events).toEqual([
      "reserve:platform-text:request-a:attempt-first",
      "platform:1",
      "release:platform-text:request-a:attempt-first",
      "reserve:platform-text:request-a:attempt-retry",
      "platform:2",
      "settle:platform-text:request-a:attempt-retry",
    ]);
  });
});

type Input = {
  configured?: boolean;
  claimed?: boolean;
  configuredUserModel?: ChatResponderPort;
  platformModel?: MeteredPlatformChatPort;
  attemptIds?: string[];
  onTrialStatus?: () => void;
  onReserve?: (input: LedgerInput) => void;
  onSettle?: (input: LedgerInput & { actualMicros: number }) => void;
  onRelease?: (input: LedgerInput) => void;
};

type LedgerInput = {
  accountId: string;
  operationId: string;
  reservationId: string;
  amountMicros?: number;
};

function createOptions(overrides: Input): PlatformTextCapabilityOptions {
  const attemptIds = [...(overrides.attemptIds ?? ["attempt-default"])];
  return {
    configuredUserModel: overrides.configuredUserModel ?? responder("unused"),
    modelConfiguration: {
      async getStatus() {
        return overrides.configured === false ? null : { status: "verified" };
      },
    },
    trialQuota: {
      async getStatus() {
        overrides.onTrialStatus?.();
        return { status: overrides.claimed === false ? "unclaimed" : "claimed" };
      },
    },
    costLedger: {
      async reserve(value) {
        overrides.onReserve?.(value);
        return {};
      },
      async settle(value) {
        overrides.onSettle?.(value);
        return {};
      },
      async release(value) {
        overrides.onRelease?.(value);
        return {};
      },
      async getReservation() {
        throw new Error("COST_RESERVATION_NOT_FOUND");
      },
    },
    platformModel: overrides.platformModel,
    reservationAmountMicros: 10,
    attemptIdFactory: () => attemptIds.shift() ?? "unexpected-attempt",
  };
}

function responder(text: string, onChat?: () => void): ChatResponderPort {
  return {
    async chat() {
      onChat?.();
      return { text };
    },
  };
}

function meteredResponder(
  text: string,
  actualCostMicros: number,
  onChat?: () => void,
): MeteredPlatformChatPort {
  return {
    async chat() {
      onChat?.();
      return { text, actualCostMicros };
    },
  };
}

function signal() {
  return new AbortController().signal;
}
