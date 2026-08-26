import type { ConversationRuntimeContextEntry } from "./conversation-runtime";

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

/** The chat-only portion of the TextModelAdapter described by TECHNICAL.md. */
export type TextModelChatAdapter = {
  chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult>;
};

/** Alias for callers that refer to the complete technical adapter by name. */
export type TextModelAdapter = TextModelChatAdapter;

export type ConversationResponder = (
  text: string,
  context: readonly ConversationRuntimeContextEntry[],
  signal?: AbortSignal,
) => Promise<string>;

export const CONVERSATION_RESPONDER_NOT_CONFIGURED =
  "CONVERSATION_RESPONDER_NOT_CONFIGURED" as const;
export const CONVERSATION_REPLY_INVALID = "CONVERSATION_REPLY_INVALID" as const;

/**
 * Adapts the TECH text-model chat method to the store's narrow responder port.
 * No adapter is intentionally represented by a responder that fails when
 * called, so callers retain the existing failed-send/draft-recovery path.
 */
export function createConversationResponder(
  adapter?: TextModelChatAdapter,
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
export class DevelopmentTextModelAdapter implements TextModelChatAdapter {
  async chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult> {
    if (signal.aborted) throw new Error("CONVERSATION_REPLY_ABORTED");
    const context = input.context
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join(" | ");
    return {
      text: context
        ? `基于 ${input.context.length} 条对话上下文回应：${context}`
        : `基于当前问题回应：${input.text}`,
    };
  }
}

export function createDevelopmentTextModelAdapter(): TextModelChatAdapter {
  return new DevelopmentTextModelAdapter();
}

export function createDevelopmentConversationResponder(): ConversationResponder {
  return createConversationResponder(createDevelopmentTextModelAdapter());
}
