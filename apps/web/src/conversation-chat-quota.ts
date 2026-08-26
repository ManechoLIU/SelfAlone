import type { TrialQuotaStatus } from "@selfalone/contracts";
import type { ConversationChatQuotaViewState } from "./conversation-chat-directory";

export type ConversationChatQuotaFlowState = {
  status: TrialQuotaStatus | null;
  viewState: ConversationChatQuotaViewState;
};

export type ConversationChatQuotaFlowContext = {
  routeGeneration: number;
  accountId: string | null;
  isConversationRoute: boolean;
};

export type ConversationChatQuotaFocusTarget = "status" | "claim" | "input";

type TimerHandle = number;

type ConversationChatQuotaFlowOptions = {
  claim: () => Promise<TrialQuotaStatus>;
  getContext: () => ConversationChatQuotaFlowContext;
  getState: () => ConversationChatQuotaFlowState;
  apply: (state: ConversationChatQuotaFlowState, focusTarget?: ConversationChatQuotaFocusTarget) => void;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  clear: (timer: TimerHandle) => void;
};

export function createConversationChatQuotaFlow(options: ConversationChatQuotaFlowOptions) {
  let claimRequestId = 0;
  let dismissTimer: TimerHandle | undefined;

  const clearDismissTimer = () => {
    if (dismissTimer === undefined) return;
    options.clear(dismissTimer);
    dismissTimer = undefined;
  };

  const isCurrent = (
    requestId: number,
    requestContext: ConversationChatQuotaFlowContext,
  ) => {
    const currentContext = options.getContext();
    return requestId === claimRequestId
      && currentContext.routeGeneration === requestContext.routeGeneration
      && currentContext.accountId === requestContext.accountId
      && currentContext.isConversationRoute;
  };

  const claim = async () => {
    const requestId = ++claimRequestId;
    clearDismissTimer();
    const requestContext = options.getContext();
    const currentState = options.getState();
    options.apply({
      status: currentState.status,
      viewState: { phase: "claiming" },
    }, "status");

    try {
      const status = await options.claim();
      if (!isCurrent(requestId, requestContext)) return;

      options.apply({ status, viewState: { phase: "success" } }, "status");
      dismissTimer = options.schedule(() => {
        dismissTimer = undefined;
        if (!isCurrent(requestId, requestContext)) return;
        if (options.getState().viewState.phase !== "success") return;
        options.apply({
          status: options.getState().status,
          viewState: { phase: "claimed" },
        }, "input");
      }, 1200);
    } catch {
      if (!isCurrent(requestId, requestContext)) return;
      options.apply({
        status: options.getState().status,
        viewState: { phase: "error", error: "领取失败，请稍后重试" },
      }, "claim");
    }
  };

  const cancel = () => {
    claimRequestId += 1;
    clearDismissTimer();
  };

  return { claim, cancel };
}
