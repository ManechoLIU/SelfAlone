import { describe, expect, it } from "vitest";
import { assertDevelopmentAdapterAllowed } from "./runtime-policy";

describe("development presentation adapter policy", () => {
  it("requires an explicit development environment", () => {
    expect(() => assertDevelopmentAdapterAllowed("development")).not.toThrow();
    expect(() => assertDevelopmentAdapterAllowed(undefined)).toThrow(
      "DEVELOPMENT_ADAPTER_DISABLED",
    );
    expect(() => assertDevelopmentAdapterAllowed("production")).toThrow(
      "DEVELOPMENT_ADAPTER_DISABLED",
    );
  });
});
