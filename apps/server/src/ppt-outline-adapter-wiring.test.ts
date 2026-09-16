import { describe, expect, it } from "vitest";
import type { ChatResponderPort } from "./conversation-responder";
import {
  PPT_OUTLINE_GENERATION_ADAPTER_ENV,
  PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED,
  PPT_PUBLIC_SOURCE_ADAPTER_ENV,
  PPT_PUBLIC_SOURCE_ADAPTER_REAL_NOT_IMPLEMENTED,
  PPT_PUBLIC_SOURCE_ADAPTER_UNSUPPORTED,
  resolvePptOutlineAdapters,
} from "./ppt-outline-adapter-wiring";
import { FakePptOutlineGenerationAdapter, FakePptPublicSourceAdapter } from "./ppt-outline-adapters";
import { RealPptOutlineGenerationAdapter } from "./ppt-outline-generation-adapter";

describe("PPT outline adapter wiring", () => {
  const chat: ChatResponderPort = {
    async chat() {
      return { text: "[]" };
    },
  };

  it("defaults to fake generation and fake public sources in development", () => {
    const adapters = resolvePptOutlineAdapters({
      environment: {},
      appEnv: "development",
      chat,
    });
    expect(adapters.generation).toBeInstanceOf(FakePptOutlineGenerationAdapter);
    expect(adapters.publicSources).toBeInstanceOf(FakePptPublicSourceAdapter);
  });

  it("selects real generation when PPT_OUTLINE_GENERATION_ADAPTER=real", () => {
    const adapters = resolvePptOutlineAdapters({
      environment: { [PPT_OUTLINE_GENERATION_ADAPTER_ENV]: "real" },
      appEnv: "development",
      chat,
    });
    expect(adapters.generation).toBeInstanceOf(RealPptOutlineGenerationAdapter);
    expect(adapters.publicSources).toBeInstanceOf(FakePptPublicSourceAdapter);
  });

  it("rejects unsupported modes and unimplemented real public sources", () => {
    expect(() => resolvePptOutlineAdapters({
      environment: { [PPT_OUTLINE_GENERATION_ADAPTER_ENV]: "mystery" },
      appEnv: "development",
      chat,
    })).toThrow(PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED);

    expect(() => resolvePptOutlineAdapters({
      environment: { [PPT_PUBLIC_SOURCE_ADAPTER_ENV]: "mystery" },
      appEnv: "development",
      chat,
    })).toThrow(PPT_PUBLIC_SOURCE_ADAPTER_UNSUPPORTED);

    expect(() => resolvePptOutlineAdapters({
      environment: { [PPT_PUBLIC_SOURCE_ADAPTER_ENV]: "real" },
      appEnv: "development",
      chat,
    })).toThrow(PPT_PUBLIC_SOURCE_ADAPTER_REAL_NOT_IMPLEMENTED);

    expect(() => resolvePptOutlineAdapters({
      environment: {},
      appEnv: "production",
      chat,
    })).toThrow("DEVELOPMENT_ADAPTER_DISABLED");
  });
});
