import type { DevelopmentState, PptOutlineParagraph, PptWorkspace } from "../../adapters/client";
import { ClientBoundaryError } from "../../adapters/client";

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function pptActionClearance(actionHeight: number, gap = 16) {
  return Math.ceil(finiteNonNegative(actionHeight) + finiteNonNegative(gap));
}

export function editorPanelHeight(viewportHeight: number, topReveal = 44) {
  return Math.max(0, Math.floor(finiteNonNegative(viewportHeight) - finiteNonNegative(topReveal)));
}

export const PPT_PAGE_RANGE_PRESETS = ["6–8 页", "8–10 页", "10–12 页", "自定义"] as const;
export const PPT_CUSTOM_RANGE_LABEL = "自定义";
export const PPT_OUTLINE_AUTOSAVE_DELAY_MS = 400;

export function pptPresetPageRange(label: string): { min: number; max: number } | null {
  if (label === "6–8 页") return { min: 6, max: 8 };
  if (label === "8–10 页") return { min: 8, max: 10 };
  if (label === "10–12 页") return { min: 10, max: 12 };
  return null;
}

export function pptPageRangeLabel(range: { min: number; max: number } | null): string {
  if (!range) return "6–8 页";
  for (const preset of PPT_PAGE_RANGE_PRESETS) {
    const value = pptPresetPageRange(preset);
    if (value && value.min === range.min && value.max === range.max) return preset;
  }
  return PPT_CUSTOM_RANGE_LABEL;
}

export function validatePptRequirementsForm(input: {
  purpose: string;
  audience: string;
  pageRangeLabel: string;
  rangeMin: string;
  rangeMax: string;
}): { pageRange: { min: number; max: number } } | { error: string } {
  if (!input.purpose.trim() || !input.audience.trim()) {
    return { error: "请先填写用途和受众" };
  }
  if (input.pageRangeLabel !== PPT_CUSTOM_RANGE_LABEL) {
    const preset = pptPresetPageRange(input.pageRangeLabel);
    if (preset) return { pageRange: preset };
    return { error: "请选择页数范围" };
  }
  const min = Number.parseInt(input.rangeMin, 10);
  const max = Number.parseInt(input.rangeMax, 10);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
    return { error: "请填写有效的自定义页数范围" };
  }
  return { pageRange: { min, max } };
}

export function outlineParagraphsToText(paragraphs: readonly PptOutlineParagraph[]) {
  return paragraphs.map((node) => `${"  ".repeat(node.level - 1)}${node.text}`).join("\n");
}

/** Indentation maps to levels; ids follow the previous snapshot by position when possible. */
export function outlineTextToParagraphs(
  value: string,
  previous: readonly PptOutlineParagraph[] = [],
): PptOutlineParagraph[] {
  return value.split("\n").map((line, index) => {
    const leading = line.match(/^\s*/)?.[0].length ?? 0;
    const level = Math.min(3, Math.floor(leading / 2) + 1) as 1 | 2 | 3;
    return { level, text: line.trim(), index };
  }).filter((node) => node.text)
    .map((node, index) => ({
      id: previous[index]?.id ?? `local-${index}`,
      level: node.level,
      text: node.text,
    }));
}

export function countOutlinePages(nodes: ReadonlyArray<{ level: 1 | 2 | 3 }>) {
  return nodes.reduce((count, node) => (node.level === 1 ? count + 1 : count), 0);
}

/** Level-one paragraphs are pages; labels follow level-one order, not the flat index. */
export function outlinePageLabels(nodes: ReadonlyArray<{ level: 1 | 2 | 3 }>): string[] {
  let page = 0;
  return nodes.map((node) => (node.level === 1 ? String(++page).padStart(2, "0") : ""));
}

export function isPptStaleError(error: unknown) {
  return error instanceof ClientBoundaryError && error.code === "PPT_WORKSPACE_STALE";
}

export function isPptOutlineUnavailableError(error: unknown) {
  return error instanceof ClientBoundaryError && error.code === "PPT_OUTLINE_UNAVAILABLE";
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
