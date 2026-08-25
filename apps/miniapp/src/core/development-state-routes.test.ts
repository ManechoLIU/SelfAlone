import { describe, expect, it } from "vitest";
import { developmentStateRoutes } from "./development-state-routes";

describe("development state acceptance routes", () => {
  it("exposes every meaningful data state only inside the development adapter", () => {
    expect(developmentStateRoutes(false)).toEqual([]);

    const routes = developmentStateRoutes(true);
    expect(routes).toHaveLength(15);
    expect(new Set(routes.map((route) => route.state))).toEqual(new Set([
      "normal",
      "loading",
      "empty",
      "filtered-empty",
      "failed",
    ]));
    expect(routes.filter((route) => route.page === "library")).toHaveLength(5);
    expect(routes.filter((route) => route.page === "reader")).toHaveLength(5);
    expect(routes.filter((route) => route.page === "ppt")).toHaveLength(5);
    expect(routes.find((route) => route.page === "reader" && route.state === "normal")?.url)
      .toBe("/pages/reader/index?id=dev-local-ink&state=normal");
  });
});
