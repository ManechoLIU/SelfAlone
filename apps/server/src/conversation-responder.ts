import { createHash } from "node:crypto";
import type { ConversationRuntimeContextEntry } from "./conversation-runtime";
import { assertDevelopmentAdapterAllowed } from "./runtime-policy";

/**
 * The smallest chat input shared by the conversation store and a text-model
 * adapter. The store supplies the current text as well as the complete
 * ordered context, including the current user entry.
 */
export type ChatInput = {
  text: string;
  context: readonly ConversationRuntimeContextEntry[];
};

export type ChatResult = {
  text: string;
};

/**
 * The chat-only server port compatible with TextModelAdapter.chat. It is not
 * the complete technical adapter, which also owns credential validation and
 * PPT-specific methods.
 */
export type ChatResponderPort = {
  chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult>;
};

export type TextModelChatAdapter = ChatResponderPort;

export type ConversationResponder = (
  text: string,
  context: readonly ConversationRuntimeContextEntry[],
  signal?: AbortSignal,
) => Promise<string>;

export const CONVERSATION_RESPONDER_NOT_CONFIGURED =
  "CONVERSATION_RESPONDER_NOT_CONFIGURED" as const;
export const CONVERSATION_REPLY_INVALID = "CONVERSATION_REPLY_INVALID" as const;
export const CONVERSATION_RESPONDER_MODE_UNSUPPORTED =
  "CONVERSATION_RESPONDER_MODE_UNSUPPORTED" as const;

/**
 * Adapts the TECH text-model chat method to the store's narrow responder port.
 * No adapter is intentionally represented by a responder that fails when
 * called, so callers retain the existing failed-send/draft-recovery path.
 */
export function createConversationResponder(
  adapter?: ChatResponderPort,
): ConversationResponder {
  return async (text, context, signal = new AbortController().signal) => {
    if (!adapter) throw new Error(CONVERSATION_RESPONDER_NOT_CONFIGURED);

    const result = await adapter.chat(
      {
        text,
        context: context.map((entry) => ({ ...entry })),
      },
      signal,
    );
    if (!result || typeof result.text !== "string" || !result.text.trim()) {
      throw new Error(CONVERSATION_REPLY_INVALID);
    }
    return result.text;
  };
}

/**
 * Explicit deterministic adapter for local contract and H3 checks. It is
 * never selected by default and deliberately includes the full context in its
 * output so a canned "acknowledged" reply cannot mask a missing context.
 */
export class DevelopmentTextModelAdapter implements ChatResponderPort {
  async chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult> {
    if (signal.aborted) throw new Error("CONVERSATION_REPLY_ABORTED");
    const roleCounts = input.context.reduce(
      (counts, entry) => ({ ...counts, [entry.role]: counts[entry.role] + 1 }),
      { user: 0, assistant: 0, system: 0 },
    );
    const contextFingerprint = createHash("sha256")
      .update(JSON.stringify(input.context))
      .digest("hex")
      .slice(0, 10);
    return {
      text: `基于 ${input.context.length} 条对话上下文摘要（用户 ${roleCounts.user}、老己 ${roleCounts.assistant}、系统 ${roleCounts.system}、指纹 ${contextFingerprint}）回应当前问题。`,
    };
  }
}

export function createDevelopmentTextModelAdapter(): ChatResponderPort {
  return new DevelopmentTextModelAdapter();
}

export function createDevelopmentConversationResponder(): ConversationResponder {
  return createConversationResponder(createDevelopmentTextModelAdapter());
}

/**
 * Resolves the local responder composition seam. The fake is opt-in and is
 * rejected outside development; an absent mode deliberately leaves the store
 * on its fail-closed responder until a real configured adapter is available.
 */
export function createConversationResponderForMode(
  mode: string | undefined,
  environment: string | undefined,
): ConversationResponder | undefined {
  const normalizedMode = mode?.trim();
  if (!normalizedMode) return undefined;
  if (normalizedMode !== "development") {
    throw new Error(CONVERSATION_RESPONDER_MODE_UNSUPPORTED);
  }
  assertDevelopmentAdapterAllowed(environment);
  return createDevelopmentConversationResponder();
}
