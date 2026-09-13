import { describe, expect, it } from "vitest";
import { resolveMiniappRuntimeConfig } from "./runtime-config";

describe("miniapp runtime config", () => {
  it("accepts a public HTTPS origin and removes its trailing slash", () => {
    expect(resolveMiniappRuntimeConfig("https://api.example.test/")).toEqual({
      apiBaseUrl: "https://api.example.test",
    });
  });

  it.each([
    undefined,
    "",
    "http://api.example.test",
    "https://user:password@api.example.test",
    "https://api.example.test/v1",
    "https://api.example.test?token=secret",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://172.16.1.1",
    "https://192.168.1.1",
    "https://169.254.1.1",
    "https://localhost.example.test",
  ])("omits an invalid or non-origin API configuration: %j", (apiBaseUrl) => {
    expect(resolveMiniappRuntimeConfig(apiBaseUrl)).toEqual({});
  });
});
