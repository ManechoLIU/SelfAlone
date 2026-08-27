export type ConversationScopeOption = {
  id: "full-book" | "highlights" | "notes";
  label: string;
  checked: boolean;
};
type ScopeId = ConversationScopeOption["id"];

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments: string[];
  status: "sending" | "failed" | "sent";
  replyTo?: string;
};

export type ConversationPendingSend = {
  id: string;
  draft: string;
  attachmentPaths: string[];
};

export type ConversationLocalState = {
  version: 1;
  conversationId: string;
  intentTaskId: string | null;
  draft: string;
  attachmentPaths: string[];
  selectionDraftIds: string[];
  confirmedSelectionIds: string[];
  selectionSheetOpen: boolean;
  messages: ConversationMessage[];
  pendingSend: ConversationPendingSend | null;
};

export type ConversationStateStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

export type ConversationLocalStoreOptions = {
  enabled: boolean;
  /** A non-secret local namespace, such as a hash of the authenticated token. */
  scope?: string;
};

export const developmentConversationId = "development-current";
export const defaultSelectionIds = ["full-book"] as const;

const conversationStateKey = "selfalone.miniapp.development.conversation.v2";
const scopeOptions: Array<Pick<ConversationScopeOption, "id" | "label">> = [
  { id: "full-book", label: "全书" },
  { id: "highlights", label: "我的划线与想法" },
  { id: "notes", label: "老己笔记" },
];
const scopeIds = new Set(scopeOptions.map((option) => option.id));

function validScopeIds(value: unknown): ScopeId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is ScopeId => typeof item === "string" && scopeIds.has(item as ScopeId)))];
}

function validAttachmentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, 4);
}

function validMessage(value: unknown): ConversationMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConversationMessage>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  if (candidate.role !== "user" && candidate.role !== "assistant") return null;
  if (candidate.status !== "sending" && candidate.status !== "failed" && candidate.status !== "sent") return null;
  if (typeof candidate.text !== "string") return null;
  return {
    id: candidate.id,
    role: candidate.role,
    text: candidate.text,
    attachments: validAttachmentPaths(candidate.attachments),
    status: candidate.status,
    ...(typeof candidate.replyTo === "string" && candidate.replyTo ? { replyTo: candidate.replyTo } : {}),
  };
}

function validMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map(validMessage).filter((message): message is ConversationMessage => message !== null).slice(-100);
}

function validPendingSend(value: unknown): ConversationPendingSend | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConversationPendingSend>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  if (typeof candidate.draft !== "string") return null;
  return {
    id: candidate.id,
    draft: candidate.draft,
    attachmentPaths: validAttachmentPaths(candidate.attachmentPaths),
  };
}

function isConversationLocalState(value: unknown): value is ConversationLocalState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConversationLocalState>;
  return candidate.version === 1
    && typeof candidate.conversationId === "string"
    && candidate.conversationId.trim().length > 0
    && (candidate.intentTaskId === null || typeof candidate.intentTaskId === "string")
    && typeof candidate.draft === "string"
    && Array.isArray(candidate.attachmentPaths)
    && Array.isArray(candidate.selectionDraftIds)
    && Array.isArray(candidate.confirmedSelectionIds)
    && typeof candidate.selectionSheetOpen === "boolean"
    && (candidate.messages === undefined || Array.isArray(candidate.messages))
    && (candidate.pendingSend === undefined
      || candidate.pendingSend === null
      || typeof candidate.pendingSend === "object");
}

export function createConversationLocalStore(
  storage: ConversationStateStorage,
  enabledOrOptions: boolean | ConversationLocalStoreOptions,
) {
  const options: ConversationLocalStoreOptions = typeof enabledOrOptions === "boolean"
    ? { enabled: enabledOrOptions }
    : enabledOrOptions;
  const storageKey = options.scope?.trim()
    ? `${conversationStateKey}.${safeStorageScope(options.scope)}`
    : conversationStateKey;

  return {
    restore(): ConversationLocalState | null {
      if (!options.enabled) return null;
      const saved = storage.get(storageKey);
      if (!isConversationLocalState(saved)) return null;
      return {
        ...saved,
        attachmentPaths: validAttachmentPaths(saved.attachmentPaths),
        selectionDraftIds: validScopeIds(saved.selectionDraftIds),
        confirmedSelectionIds: validScopeIds(saved.confirmedSelectionIds),
        messages: validMessages(saved.messages),
        pendingSend: validPendingSend(saved.pendingSend),
      };
    },
    save(state: ConversationLocalState) {
      if (!options.enabled) return;
      storage.set(storageKey, {
        version: 1,
        conversationId: state.conversationId.trim() || developmentConversationId,
        intentTaskId: state.intentTaskId,
        draft: state.draft,
        attachmentPaths: validAttachmentPaths(state.attachmentPaths),
        selectionDraftIds: validScopeIds(state.selectionDraftIds),
        confirmedSelectionIds: validScopeIds(state.confirmedSelectionIds),
        selectionSheetOpen: state.selectionSheetOpen,
        messages: validMessages(state.messages),
        pendingSend: validPendingSend(state.pendingSend),
      } satisfies ConversationLocalState);
    },
  };
}

function safeStorageScope(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

export function conversationStorageScope(session: {
  kind: "signed-out" | "development" | "authenticated";
  token?: string;
}) {
  if (session.kind === "authenticated") return `authenticated-${safeStorageScope(session.token ?? "")}`;
  return session.kind;
}

export function nextConversationSendId(messages: readonly ConversationMessage[]): string {
  const largest = messages.reduce((max, message) => {
    const match = message.id.match(/^conversation-send-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `conversation-send-${largest + 1}`;
}

export function startConversationSend(
  messages: readonly ConversationMessage[],
  pendingSend: ConversationPendingSend | null,
  draft: string,
  attachmentPaths: readonly string[],
) {
  const pending: ConversationPendingSend = {
    id: pendingSend?.id ?? nextConversationSendId(messages),
    draft: draft.trim(),
    attachmentPaths: validAttachmentPaths(attachmentPaths),
  };
  const userMessage: ConversationMessage = {
    id: pending.id,
    role: "user",
    text: pending.draft,
    attachments: [...pending.attachmentPaths],
    status: "sending",
  };
  const existingIndex = messages.findIndex((message) => message.id === pending.id && message.role === "user");
  const nextMessages = [...messages];
  if (existingIndex >= 0) nextMessages[existingIndex] = userMessage;
  else nextMessages.push(userMessage);
  return { pendingSend: pending, messages: nextMessages };
}

export function failConversationSend(
  messages: readonly ConversationMessage[],
  pendingId: string,
): ConversationMessage[] {
  return messages.map((message) => message.id === pendingId && message.role === "user"
    ? { ...message, status: "failed" }
    : message);
}

export function completeConversationSend(
  messages: readonly ConversationMessage[],
  pendingSend: ConversationPendingSend,
  reply: string,
): ConversationMessage[] {
  const completedUser: ConversationMessage = {
    id: pendingSend.id,
    role: "user",
    text: pendingSend.draft,
    attachments: [...pendingSend.attachmentPaths],
    status: "sent",
  };
  const nextMessages = [...messages];
  const existingIndex = nextMessages.findIndex((message) => message.id === pendingSend.id && message.role === "user");
  if (existingIndex >= 0) nextMessages[existingIndex] = completedUser;
  else nextMessages.push(completedUser);

  if (nextMessages.some((message) => message.role === "assistant" && message.replyTo === pendingSend.id)) {
    return nextMessages;
  }
  nextMessages.push({
    id: `${pendingSend.id}-reply`,
    role: "assistant",
    text: reply,
    attachments: [],
    status: "sent",
    replyTo: pendingSend.id,
  });
  return nextMessages;
}

export function developmentConversationReply(pendingSend: ConversationPendingSend): string {
  return pendingSend.draft.trim()
    ? "我收到这条消息了，我们可以继续聊下去。"
    : "图片已经收到，你可以继续补充想聊的内容。";
}

export function selectionOptionsFor(selectedIds: readonly string[]): ConversationScopeOption[] {
  const selected = new Set(validScopeIds(selectedIds));
  return scopeOptions.map((option) => ({ ...option, checked: selected.has(option.id) }));
}

export function selectionSummary(selectedIds: readonly string[]): string {
  const selected = new Set(validScopeIds(selectedIds));
  return scopeOptions
    .filter((option) => selected.has(option.id))
    .map((option) => option.label)
    .join("、");
}

export function canConfirmSelection(selectedIds: readonly string[]): boolean {
  return validScopeIds(selectedIds).length > 0;
}

export function toggleSelectionId(selectedIds: readonly string[], id: string): string[] {
  const current = new Set(validScopeIds(selectedIds));
  const scopeId = id as ScopeId;
  if (!scopeIds.has(scopeId)) return [...current];
  if (current.has(scopeId)) current.delete(scopeId);
  else current.add(scopeId);
  return scopeOptions
    .map((option) => option.id)
    .filter((optionId) => current.has(optionId));
}

export function preserveConversationFailure(
  state: Pick<ConversationLocalState, "draft" | "attachmentPaths" | "selectionDraftIds" | "confirmedSelectionIds">,
  message: string,
) {
  return {
    draft: state.draft,
    attachmentPaths: validAttachmentPaths(state.attachmentPaths),
    selectionDraftIds: validScopeIds(state.selectionDraftIds),
    confirmedSelectionIds: validScopeIds(state.confirmedSelectionIds),
    boundaryMessage: message,
  };
}
