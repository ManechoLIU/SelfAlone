import type { DevelopmentState, PptWorkspace } from "../../adapters/client";

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function pptActionClearance(actionHeight: number, gap = 16) {
  return Math.ceil(finiteNonNegative(actionHeight) + finiteNonNegative(gap));
}

export function editorPanelHeight(viewportHeight: number, topReveal = 44) {
  return Math.max(0, Math.floor(finiteNonNegative(viewportHeight) - finiteNonNegative(topReveal)));
}

export function preparePptWorkspaceForState(
  workspace: PptWorkspace,
  state: DevelopmentState,
  hasExplicitStage = false,
): PptWorkspace {
  if (state !== "filtered-empty" || hasExplicitStage) return workspace;
  return { ...workspace, stage: "template", task: null };
}

export function preservePptFailureContext(workspace: PptWorkspace | null, error: string) {
  return {
    phase: "failed" as const,
    error,
    retryingWorkspace: false,
    workspaceVisible: Boolean(workspace),
    workspace,
  };
}

export function pptWorkspaceRetryState(workspace: PptWorkspace | null) {
  return {
    phase: "failed" as const,
    error: "",
    retryingWorkspace: true,
    workspaceVisible: Boolean(workspace),
    workspace,
  };
}

export function needsPptRecoverySnapshot(
  state: DevelopmentState,
  workspace: PptWorkspace | null,
  developmentAdapter: boolean,
) {
  return state === "failed" && !workspace && developmentAdapter;
}
