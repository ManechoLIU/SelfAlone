import { describe, expect, it } from "vitest";
import {
  QA_REAL_HTTP_STORAGE_KEY,
  parseQaRealHttpFlag,
  resolveMiniappRuntimeConfig,
  resolveQaRealHttpFlag,
} from "./runtime-config";

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
    "http://127.0.0.1:4100",
    "http://localhost:4100",
    `https://${"a".repeat(64)}.example.test`,
    `https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.test`,
  ])("omits an invalid or non-origin API configuration: %j", (apiBaseUrl) => {
    expect(resolveMiniappRuntimeConfig(apiBaseUrl)).toEqual({});
  });

  it("accepts only the two loopback QA origins when allowLoopback is on", () => {
    expect(resolveMiniappRuntimeConfig("http://127.0.0.1:4100", { allowLoopback: true }))
      .toEqual({ apiBaseUrl: "http://127.0.0.1:4100" });
    expect(resolveMiniappRuntimeConfig("http://localhost:4100/", { allowLoopback: true }))
      .toEqual({ apiBaseUrl: "http://localhost:4100" });
    expect(resolveMiniappRuntimeConfig("https://api.example.test/", { allowLoopback: true }))
      .toEqual({ apiBaseUrl: "https://api.example.test" });
  });

  it.each([
    "http://192.168.1.1:4100",
    "http://10.1.2.3:4100",
    "http://172.16.1.1:4100",
    "http://127.0.0.1:3000",
    "http://127.0.0.1",
    "http://localhost",
    "https://127.0.0.1:4100",
    "https://localhost:4100",
    "http://127.0.0.1:4100/v1",
    "http://[::1]:4100",
  ])("still omits non-loopback or non-origin QA URLs when allowLoopback is on: %j", (apiBaseUrl) => {
    expect(resolveMiniappRuntimeConfig(apiBaseUrl, { allowLoopback: true })).toEqual({});
  });
});

describe("QA real HTTP flag", () => {
  it.each([
    [true, true],
    ["true", true],
    ["1", true],
    [1, true],
    [false, false],
    ["false", false],
    ["0", false],
    [0, false],
  ] as const)("parses %j as %s", (value, expected) => {
    expect(parseQaRealHttpFlag(value)).toBe(expected);
  });

  it.each([undefined, null, "", "yes", 2, "TRUE"])("leaves unrecognized %j unset", (value) => {
    expect(parseQaRealHttpFlag(value)).toBeUndefined();
  });

  it("is off by default", () => {
    expect(resolveQaRealHttpFlag({})).toBe(false);
  });

  it("prefers options over local json, extConfig, and storage", () => {
    const storage = { get: () => true };
    expect(resolveQaRealHttpFlag({
      optionProvided: true,
      optionValue: false,
      localConfig: { sa2QaRealHttp: true },
      extConfig: { sa2QaRealHttp: true },
      storage,
    })).toBe(false);
    expect(resolveQaRealHttpFlag({
      optionProvided: true,
      optionValue: true,
      localConfig: { sa2QaRealHttp: false },
      extConfig: { sa2QaRealHttp: false },
      storage: { get: () => false },
    })).toBe(true);
  });

  it("prefers local json over extConfig and storage", () => {
    expect(resolveQaRealHttpFlag({
      localConfig: { sa2QaRealHttp: true },
      extConfig: { sa2QaRealHttp: false },
      storage: { get: () => false },
    })).toBe(true);
    expect(resolveQaRealHttpFlag({
      localConfig: { sa2QaRealHttp: false },
      extConfig: { sa2QaRealHttp: true },
      storage: { get: () => true },
    })).toBe(false);
  });

  it("prefers extConfig over storage", () => {
    expect(resolveQaRealHttpFlag({
      extConfig: { sa2QaRealHttp: true },
      storage: { get: () => false },
    })).toBe(true);
    expect(resolveQaRealHttpFlag({
      extConfig: { sa2QaRealHttp: false },
      storage: { get: () => true },
    })).toBe(false);
  });

  it("reads the explicit storage key last", () => {
    expect(resolveQaRealHttpFlag({
      storage: {
        get: (key: string) => key === QA_REAL_HTTP_STORAGE_KEY ? true : undefined,
      },
    })).toBe(true);
  });

  it("treats storage \"1\" and numeric 1 as on", () => {
    expect(resolveQaRealHttpFlag({
      storage: {
        get: (key: string) => key === QA_REAL_HTTP_STORAGE_KEY ? "1" : undefined,
      },
    })).toBe(true);
    expect(resolveQaRealHttpFlag({
      storage: {
        get: (key: string) => key === QA_REAL_HTTP_STORAGE_KEY ? 1 : undefined,
      },
    })).toBe(true);
  });

  it("treats storage \"0\" and numeric 0 as off", () => {
    expect(resolveQaRealHttpFlag({
      storage: {
        get: (key: string) => key === QA_REAL_HTTP_STORAGE_KEY ? "0" : undefined,
      },
    })).toBe(false);
    expect(resolveQaRealHttpFlag({
      storage: {
        get: (key: string) => key === QA_REAL_HTTP_STORAGE_KEY ? 0 : undefined,
      },
    })).toBe(false);
  });
});
