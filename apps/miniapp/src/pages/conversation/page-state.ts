export type ConversationScopeOption = {
  id: "full-book" | "highlights" | "notes";
  label: string;
  checked: boolean;
};
type ScopeId = ConversationScopeOption["id"];

export type ConversationLocalState = {
  version: 1;
  conversationId: string;
  intentTaskId: string | null;
  draft: string;
  attachmentPaths: string[];
  selectionDraftIds: string[];
  confirmedSelectionIds: string[];
  selectionSheetOpen: boolean;
};

export type ConversationStateStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
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

function isConversationLocalState(value: unknown): value is ConversationLocalState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConversationLocalState>;
  return candidate.version === 1
    && candidate.conversationId === developmentConversationId
    && (candidate.intentTaskId === null || typeof candidate.intentTaskId === "string")
    && typeof candidate.draft === "string"
    && Array.isArray(candidate.attachmentPaths)
    && Array.isArray(candidate.selectionDraftIds)
    && Array.isArray(candidate.confirmedSelectionIds)
    && typeof candidate.selectionSheetOpen === "boolean";
}

export function createConversationLocalStore(
  storage: ConversationStateStorage,
  enabled: boolean,
) {
  return {
    restore(): ConversationLocalState | null {
      if (!enabled) return null;
      const saved = storage.get(conversationStateKey);
      if (!isConversationLocalState(saved)) return null;
      return {
        ...saved,
        attachmentPaths: validAttachmentPaths(saved.attachmentPaths),
        selectionDraftIds: validScopeIds(saved.selectionDraftIds),
        confirmedSelectionIds: validScopeIds(saved.confirmedSelectionIds),
      };
    },
    save(state: ConversationLocalState) {
      if (!enabled) return;
      storage.set(conversationStateKey, {
        version: 1,
        conversationId: developmentConversationId,
        intentTaskId: state.intentTaskId,
        draft: state.draft,
        attachmentPaths: validAttachmentPaths(state.attachmentPaths),
        selectionDraftIds: validScopeIds(state.selectionDraftIds),
        confirmedSelectionIds: validScopeIds(state.confirmedSelectionIds),
        selectionSheetOpen: state.selectionSheetOpen,
      } satisfies ConversationLocalState);
    },
  };
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
