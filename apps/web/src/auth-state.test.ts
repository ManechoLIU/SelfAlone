import { describe, expect, it } from "vitest";
import {
  authErrorField,
  authErrorMessage,
  authHash,
  createAuthState,
  parseAuthHash,
  resolveSession,
  setAuthMode,
  validateAuthInput,
} from "./auth-state";

describe("desktop auth state", () => {
  it("starts unauthenticated after session recovery and preserves account data", () => {
    const account = { id: "account-1", email: "reader@example.com" };
    expect(resolveSession({ status: 200, account })).toEqual({
      phase: "authenticated",
      account,
    });
    expect(resolveSession({ status: 401, code: "AUTH_REQUIRED" })).toEqual({
      phase: "unauthenticated",
      account: null,
    });
  });

  it("validates login and registration fields without replacing user input", () => {
    const state = createAuthState("login");
    const errors = validateAuthInput("register", {
      email: "not-an-email",
      password: "short",
      confirmPassword: "different",
    });
    expect(errors).toEqual({
      email: "请输入有效的邮箱地址。",
      password: "密码至少需要 8 位。",
      confirmPassword: "两次输入的密码不一致。",
    });
    expect(setAuthMode({ ...state, email: "typed@example.com" }, "register")).toMatchObject({
      mode: "register",
      email: "typed@example.com",
      phase: "unauthenticated",
    });
  });

  it("keeps auth errors generic and maps them to the right field", () => {
    expect(authErrorMessage("INVALID_CREDENTIALS", "login")).toBe("邮箱或密码不正确，请检查后重试。");
    expect(authErrorField("INVALID_EMAIL", "login")).toBe("email");
    expect(authErrorField("INVALID_PASSWORD", "register")).toBe("password");
  });

  it("round-trips the entry, login, and register routes", () => {
    expect(authHash("entry")).toBe("#/auth");
    expect(parseAuthHash("#/auth")).toEqual({ mode: "entry" });
    expect(parseAuthHash(authHash("login"))).toEqual({ mode: "login" });
    expect(parseAuthHash(authHash("register"))).toEqual({ mode: "register" });
  });
});
