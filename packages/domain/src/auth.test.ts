import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
  validatePassword,
} from "./auth";

describe("auth domain contract", () => {
  it("normalizes email without changing the password", () => {
    expect(normalizeEmail("  Reader@Example.COM ")).toBe("reader@example.com");
    expect(validatePassword("correct horse battery")).toBe("correct horse battery");
  });

  it("creates opaque session tokens whose stored digest is one-way and stable", () => {
    const token = createOpaqueToken();
    expect(token).toHaveLength(43);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toBe(token);
  });

  it("rejects invalid email and password input", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow("INVALID_EMAIL");
    expect(() => validatePassword("short")).toThrow("INVALID_PASSWORD");
  });
});
