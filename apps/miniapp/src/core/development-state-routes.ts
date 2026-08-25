import type { DevelopmentState } from "../adapters/client";

export type DevelopmentStateRoute = {
  page: "library" | "reader" | "ppt";
  state: DevelopmentState;
  label: string;
  url: string;
};

const states: Array<{ state: DevelopmentState; label: string }> = [
  { state: "normal", label: "正常" },
  { state: "loading", label: "加载" },
  { state: "empty", label: "真实空" },
  { state: "filtered-empty", label: "筛选空" },
  { state: "failed", label: "失败" },
];

const pages = [
  { page: "library" as const, label: "书架", path: "/pages/library/index" },
  { page: "reader" as const, label: "阅读", path: "/pages/reader/index?id=dev-local-ink" },
  { page: "ppt" as const, label: "PPT", path: "/pages/ppt/index?bookId=dev-local-ink" },
];

export function developmentStateRoutes(enabled: boolean): DevelopmentStateRoute[] {
  if (!enabled) return [];
  return pages.flatMap(({ page, label: pageLabel, path }) => states.map(({ state, label: stateLabel }) => ({
    page,
    state,
    label: `${pageLabel} · ${stateLabel}`,
    url: `${path}${path.includes("?") ? "&" : "?"}state=${state}`,
  })));
}
