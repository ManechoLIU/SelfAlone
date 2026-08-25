export type ConversationChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  requestId?: string;
};

export type ConversationChatSession = {
  id: string;
  revision: number;
  draft: { text: string; attachments: readonly string[] } | null;
  context: readonly ConversationChatMessage[];
  activeRun: { requestId: string; kind: "response" | "task"; status: "running"; startedRevision: number; taskId?: string } | null;
  tasks: readonly unknown[];
  works: readonly unknown[];
  deleted: boolean;
};

export type ConversationChatState = {
  conversationId: string;
  revision: number | null;
  draft: string;
  messages: readonly ConversationChatMessage[];
  status: "idle" | "sending" | "error";
  errorCode: string | null;
};

export type ConversationChatSendResult =
  | {
      status: "completed";
      session: ConversationChatSession;
      reply: string;
    }
  | {
      status: "failed";
      session: ConversationChatSession;
      errorCode: string;
      retainedDraft: { text: string; attachments: readonly string[] };
    };

export type ConversationRouteKind = "chat" | "workspace";

export function classifyConversationRoute(hash: string): ConversationRouteKind {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return "workspace";
  const parameters = new URLSearchParams(query);
  return parameters.has("stage") || parameters.has("book") ? "workspace" : "chat";
}

export function canonicalizeConversationStageRoute(hash: string, stage: string): string {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return hash;
  const parameters = new URLSearchParams(query);
  parameters.set("stage", stage);
  const nextQuery = parameters.toString();
  return `#${route}${nextQuery ? `?${nextQuery}` : ""}`;
}

export function createConversationChatState(conversationId: string): ConversationChatState {
  return {
    conversationId,
    revision: null,
    draft: "",
    messages: [],
    status: "idle",
    errorCode: null,
  };
}

export function updateConversationDraft(
  state: ConversationChatState,
  draft: string,
): ConversationChatState {
  return { ...state, draft, errorCode: null };
}

export function beginConversationSend(
  state: ConversationChatState,
  _requestId: string,
): ConversationChatState {
  return { ...state, status: "sending", errorCode: null };
}

export function applyConversationSnapshot(
  state: ConversationChatState,
  session: ConversationChatSession,
): ConversationChatState {
  return {
    ...state,
    conversationId: session.id,
    revision: session.revision,
    draft: session.draft?.text ?? "",
    messages: session.context.map((entry) => ({ ...entry })),
    status: "idle",
    errorCode: null,
  };
}

export function applyConversationSendResult(
  state: ConversationChatState,
  result: ConversationChatSendResult,
): ConversationChatState {
  return {
    ...state,
    conversationId: result.session.id,
    revision: result.session.revision,
    draft: result.status === "completed" ? "" : result.retainedDraft.text,
    messages: result.session.context.map((entry) => ({ ...entry })),
    status: result.status === "completed" ? "idle" : "error",
    errorCode: result.status === "completed" ? null : result.errorCode,
  };
}
