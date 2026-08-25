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
  retryRequestId: string | null;
  retryText: string | null;
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

export type ConversationChatLoadOutcome = "success" | "failure";

export type ConversationChatLoadCoordinator = {
  request: (navigationId: number) => "start" | "pending" | "ignore";
  settle: (navigationId: number, outcome: ConversationChatLoadOutcome) => number | null;
};

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

export function createConversationChatLoadCoordinator(): ConversationChatLoadCoordinator {
  let inFlightNavigationId: number | null = null;
  let pendingNavigationId: number | null = null;

  return {
    request(navigationId) {
      if (inFlightNavigationId === null) {
        inFlightNavigationId = navigationId;
        return "start";
      }
      if (inFlightNavigationId === navigationId) return "ignore";
      pendingNavigationId = navigationId;
      return "pending";
    },
    settle(navigationId, _outcome) {
      if (inFlightNavigationId !== navigationId) return null;
      inFlightNavigationId = null;
      const nextNavigationId = pendingNavigationId;
      pendingNavigationId = null;
      return nextNavigationId;
    },
  };
}

export function createConversationChatState(conversationId: string): ConversationChatState {
  return {
    conversationId,
    revision: null,
    draft: "",
    retryRequestId: null,
    retryText: null,
    messages: [],
    status: "idle",
    errorCode: null,
  };
}

export function updateConversationDraft(
  state: ConversationChatState,
  draft: string,
): ConversationChatState {
  const canRetrySameRequest = state.retryRequestId !== null && state.retryText === draft;
  return {
    ...state,
    draft,
    retryRequestId: canRetrySameRequest ? state.retryRequestId : null,
    retryText: canRetrySameRequest ? state.retryText : null,
    errorCode: null,
  };
}

export function beginConversationSend(
  state: ConversationChatState,
  requestId: string,
): ConversationChatState {
  return {
    ...state,
    retryRequestId: requestId,
    retryText: state.draft,
    status: "sending",
    errorCode: null,
  };
}

export function applyConversationSnapshot(
  state: ConversationChatState,
  session: ConversationChatSession,
): ConversationChatState {
  const retryEntry = session.draft
    ? [...session.context].reverse().find((entry) => entry.role === "user" && entry.text === session.draft?.text)
    : undefined;
  const retryRequestId = retryEntry ? requestIdForContextEntry(retryEntry) : null;
  return {
    ...state,
    conversationId: session.id,
    revision: session.revision,
    draft: session.draft?.text ?? "",
    retryRequestId,
    retryText: retryRequestId ? session.draft?.text ?? null : null,
    messages: session.context.map((entry) => ({ ...entry })),
    status: session.activeRun ? "sending" : "idle",
    errorCode: null,
  };
}

function requestIdForContextEntry(entry: ConversationChatMessage) {
  if (entry.requestId) return entry.requestId;
  const suffix = ":user";
  return entry.role === "user" && entry.id.endsWith(suffix)
    ? entry.id.slice(0, -suffix.length)
    : null;
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
    retryRequestId: result.status === "completed" ? null : state.retryRequestId,
    retryText: result.status === "completed" ? null : state.retryText,
    messages: result.session.context.map((entry) => ({ ...entry })),
    status: result.status === "completed" ? "idle" : "error",
    errorCode: result.status === "completed" ? null : result.errorCode,
  };
}
