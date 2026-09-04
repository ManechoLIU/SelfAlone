import type { PptWorkspaceSnapshot } from "@selfalone/contracts";
import type { PptWorkspaceCreateResult } from "./ppt-workspace-client";
import type { PptWorkspaceContext } from "./conversation-chat-controller";

export type PptRequirementsWorkspaceState =
  | { phase: "hidden" }
  | { phase: "pending"; context: PptWorkspaceContext }
  | { phase: "error"; context: PptWorkspaceContext; error: unknown }
  | {
      phase: "ready";
      context: PptWorkspaceContext;
      workspace: PptWorkspaceCreateResult["workspace"];
    };

function isMatchingWorkspace(context: PptWorkspaceContext, workspace: PptWorkspaceSnapshot) {
  const source = workspace.sources[0];
  return workspace.sources.length === 1
    && workspace.draft.stage === "requirements"
    && workspace.draft.conversationId === context.conversationId
    && source?.bookId === context.bookId;
}

export function createPptRequirementsWorkspaceStore() {
  let state: PptRequirementsWorkspaceState = { phase: "hidden" };
  const listeners = new Set<(next: PptRequirementsWorkspaceState) => void>();
  const publish = (next: PptRequirementsWorkspaceState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    subscribe(listener: (next: PptRequirementsWorkspaceState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin(context: PptWorkspaceContext) { publish({ phase: "pending", context }); },
    ready(context: PptWorkspaceContext, result: PptWorkspaceCreateResult) {
      const workspace = result.workspace;
      if (!isMatchingWorkspace(context, workspace)) {
        publish({ phase: "error", context, error: new Error("PPT_WORKSPACE_RESPONSE_INVALID") });
        return false;
      }
      publish({ phase: "ready", context, workspace });
      return true;
    },
    fail(context: PptWorkspaceContext, error: unknown) { publish({ phase: "error", context, error }); },
    retryContext() { return state.phase === "error" ? state.context : null; },
  };
}
