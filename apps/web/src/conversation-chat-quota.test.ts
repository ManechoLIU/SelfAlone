import { describe, expect, it } from "vitest";
import type { TrialQuotaStatus } from "@selfalone/contracts";
import {
  createConversationChatQuotaFlow,
  type ConversationChatQuotaFlowState,
  type ConversationChatQuotaFocusTarget,
} from "./conversation-chat-quota";

const claimed: TrialQuotaStatus = { status: "claimed" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createHarness(claim: () => Promise<TrialQuotaStatus>) {
  let context = {
    routeGeneration: 1,
    accountId: "account-a",
    isConversationRoute: true,
  };
  let state: ConversationChatQuotaFlowState = {
    status: { status: "unclaimed" },
    viewState: { phase: "unclaimed" },
  };
  const commits: ConversationChatQuotaFlowState[] = [];
  const focusTargets: ConversationChatQuotaFocusTarget[] = [];
  const scheduleDelays: number[] = [];
  let timerCallback: (() => void) | undefined;
  let timerId = 0;
  const flow = createConversationChatQuotaFlow({
    claim,
    getContext: () => context,
    getState: () => state,
    apply: (nextState, focusTarget) => {
      state = nextState;
      commits.push(nextState);
      if (focusTarget) focusTargets.push(focusTarget);
    },
    schedule: (callback, delayMs) => {
      timerCallback = callback;
      scheduleDelays.push(delayMs);
      timerId += 1;
      return timerId;
    },
    clear: () => {
      timerCallback = undefined;
    },
  });
  return {
    flow,
    getState: () => state,
    commits,
    focusTargets,
    scheduleDelays,
    fireDismissTimer: () => timerCallback?.(),
    setContext: (nextContext: Partial<typeof context>) => {
      context = { ...context, ...nextContext };
    },
  };
}

describe("conversation chat quota flow", () => {
  it("ignores a delayed claim response after the route account changes", async () => {
    const claimResult = deferred<TrialQuotaStatus>();
    const harness = createHarness(() => claimResult.promise);

    const pending = harness.flow.claim();
    harness.setContext({ routeGeneration: 2, accountId: "account-b" });
    claimResult.resolve(claimed);
    await pending;

    expect(harness.commits).toHaveLength(1);
    expect(harness.getState().viewState).toEqual({ phase: "claiming" });
    expect(harness.focusTargets).toEqual(["status"]);
    harness.fireDismissTimer();
    expect(harness.getState().viewState).toEqual({ phase: "claiming" });
  });

  it("ignores a delayed claim failure after the route generation changes", async () => {
    const claimResult = deferred<TrialQuotaStatus>();
    const harness = createHarness(() => claimResult.promise);

    const pending = harness.flow.claim();
    harness.setContext({ routeGeneration: 2 });
    claimResult.reject(new Error("offline"));
    await pending;

    expect(harness.commits).toHaveLength(1);
    expect(harness.getState().viewState).toEqual({ phase: "claiming" });
    expect(harness.focusTargets).toEqual(["status"]);
  });

  it("does not dismiss or focus a new account after the old success timer was scheduled", async () => {
    const claimResult = deferred<TrialQuotaStatus>();
    const harness = createHarness(() => claimResult.promise);

    const pending = harness.flow.claim();
    claimResult.resolve(claimed);
    await pending;
    expect(harness.getState().viewState).toEqual({ phase: "success" });
    expect(harness.focusTargets).toEqual(["status", "status"]);
    expect(harness.scheduleDelays).toEqual([1200]);

    harness.setContext({ routeGeneration: 2, accountId: "account-b" });
    harness.fireDismissTimer();

    expect(harness.getState().viewState).toEqual({ phase: "success" });
    expect(harness.focusTargets).toEqual(["status", "status"]);
  });

  it("keeps a stable focus target through claiming, success, error, and dismiss", async () => {
    const successResult = deferred<TrialQuotaStatus>();
    const successHarness = createHarness(() => successResult.promise);
    const successPending = successHarness.flow.claim();
    expect(successHarness.focusTargets).toEqual(["status"]);

    successResult.resolve(claimed);
    await successPending;
    expect(successHarness.getState().viewState).toEqual({ phase: "success" });
    expect(successHarness.focusTargets).toEqual(["status", "status"]);

    successHarness.fireDismissTimer();
    expect(successHarness.getState().viewState).toEqual({ phase: "claimed" });
    expect(successHarness.focusTargets).toEqual(["status", "status", "input"]);

    const errorHarness = createHarness(async () => {
      throw new Error("offline");
    });
    await errorHarness.flow.claim();
    expect(errorHarness.getState().viewState).toEqual({
      phase: "error",
      error: "领取失败，请稍后重试",
    });
    expect(errorHarness.focusTargets).toEqual(["status", "claim"]);
  });
});
