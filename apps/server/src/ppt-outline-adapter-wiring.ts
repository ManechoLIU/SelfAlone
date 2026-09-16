import { assertDevelopmentAdapterAllowed } from "./runtime-policy";
import type { ChatResponderPort } from "./conversation-responder";
import {
  createFakePptOutlineGenerationAdapter,
  createFakePptPublicSourceAdapter,
  type PptOutlineAdapters,
} from "./ppt-outline-adapters";
import { createRealPptOutlineGenerationAdapter } from "./ppt-outline-generation-adapter";
import { createRealPptPublicSourceAdapter } from "./ppt-outline-public-source-adapter";

/** Selects fake or real PPT outline generation at composition time. */
export const PPT_OUTLINE_GENERATION_ADAPTER_ENV = "PPT_OUTLINE_GENERATION_ADAPTER" as const;
/** Selects fake or real public-source research. */
export const PPT_PUBLIC_SOURCE_ADAPTER_ENV = "PPT_PUBLIC_SOURCE_ADAPTER" as const;

export const PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED =
  "PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED" as const;
export const PPT_PUBLIC_SOURCE_ADAPTER_UNSUPPORTED =
  "PPT_PUBLIC_SOURCE_ADAPTER_UNSUPPORTED" as const;
/** @deprecated SA-P2 implements real; retained only so old references stay greppable. */
export const PPT_PUBLIC_SOURCE_ADAPTER_REAL_NOT_IMPLEMENTED =
  "PPT_PUBLIC_SOURCE_ADAPTER_REAL_NOT_IMPLEMENTED" as const;

export type PptOutlineAdapterWiringEnvironment = Record<string, string | undefined>;

export type ResolvePptOutlineAdaptersInput = {
  environment: PptOutlineAdapterWiringEnvironment;
  appEnv: string | undefined;
  /** Required when generation mode is `real`. */
  chat?: ChatResponderPort;
};

/**
 * Composition seam for PPT outline adapters.
 *
 * - `PPT_OUTLINE_GENERATION_ADAPTER=fake|real` (default `fake`)
 * - `PPT_PUBLIC_SOURCE_ADAPTER=fake|real` (default `fake`)
 *
 * Fake adapters remain for unit tests and local regression; acceptance must use
 * generation=`real` once credentials are available (SA-P0). Public-source `real`
 * is safe without keys: body-sufficient skips network; otherwise bounded lookup
 * degrades to [] (never fabricates whole-book analysis sources).
 */
export function resolvePptOutlineAdapters(
  input: ResolvePptOutlineAdaptersInput,
): PptOutlineAdapters {
  const generationMode = normalizeAdapterMode(
    input.environment[PPT_OUTLINE_GENERATION_ADAPTER_ENV],
  );
  const publicSourceMode = normalizeAdapterMode(
    input.environment[PPT_PUBLIC_SOURCE_ADAPTER_ENV],
  );

  return {
    generation: resolveGenerationAdapter(generationMode, input),
    publicSources: resolvePublicSourceAdapter(publicSourceMode, input.appEnv),
  };
}

function resolveGenerationAdapter(
  mode: string,
  input: ResolvePptOutlineAdaptersInput,
) {
  if (mode === "fake") {
    assertDevelopmentAdapterAllowed(input.appEnv);
    return createFakePptOutlineGenerationAdapter();
  }
  if (mode === "real") {
    if (!input.chat) {
      throw new Error(PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED);
    }
    return createRealPptOutlineGenerationAdapter({ chat: input.chat });
  }
  throw new Error(PPT_OUTLINE_GENERATION_ADAPTER_UNSUPPORTED);
}

function resolvePublicSourceAdapter(mode: string, appEnv: string | undefined) {
  if (mode === "fake") {
    assertDevelopmentAdapterAllowed(appEnv);
    return createFakePptPublicSourceAdapter();
  }
  if (mode === "real") {
    return createRealPptPublicSourceAdapter();
  }
  throw new Error(PPT_PUBLIC_SOURCE_ADAPTER_UNSUPPORTED);
}

function normalizeAdapterMode(value: string | undefined): string {
  return value?.trim().toLowerCase() || "fake";
}
