import { describe, expect, it } from "vitest";
import template from "./index.wxml?raw";

describe("settings page product copy", () => {
  it("does not expose development-only labels in the normal page", () => {
    expect(template).not.toMatch(/开发适配器|等待 F[123]/);
    expect(template).not.toContain("development-boundary");
  });

  it("uses user-understandable unavailable service states", () => {
    expect(template).toContain("暂不可用");
    expect(template).toContain("未配置");
    expect(template).toContain("未连接");
  });
});
