import type { AuthAccount, AuthErrorCode } from "@selfalone/contracts";

export type AuthMode = "entry" | "login" | "register";
export type AuthPhase = "recovering" | "unauthenticated" | "submitting" | "authenticated";
export type AuthField = "email" | "password" | "confirmPassword";

export type AuthState = {
  mode: AuthMode;
  phase: AuthPhase;
  account: AuthAccount | null;
  email: string;
  password: string;
  confirmPassword: string;
  fieldErrors: Partial<Record<AuthField, string>>;
  formError: string;
};

export type SessionResponse = {
  status: number;
  account?: AuthAccount;
  code?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthState(mode: AuthMode = "entry"): AuthState {
  return {
    mode,
    phase: "unauthenticated",
    account: null,
    email: "",
    password: "",
    confirmPassword: "",
    fieldErrors: {},
    formError: "",
  };
}

export function resolveSession(response: SessionResponse) {
  if (response.status === 200 && response.account) {
    return { phase: "authenticated" as const, account: response.account };
  }
  return { phase: "unauthenticated" as const, account: null };
}

export function setAuthMode(state: AuthState, mode: Exclude<AuthMode, "entry"> | AuthMode): AuthState {
  return {
    ...state,
    mode,
    phase: "unauthenticated",
    account: null,
    password: "",
    confirmPassword: "",
    fieldErrors: {},
    formError: "",
  };
}

export function validateAuthInput(
  mode: Exclude<AuthMode, "entry">,
  input: Pick<AuthState, "email" | "password" | "confirmPassword">,
) {
  const errors: Partial<Record<AuthField, string>> = {};
  if (!emailPattern.test(input.email.trim())) errors.email = "请输入有效的邮箱地址。";
  if (input.password.length < 8) errors.password = "密码至少需要 8 位。";
  if (mode === "register" && input.confirmPassword !== input.password) {
    errors.confirmPassword = "两次输入的密码不一致。";
  }
  return errors;
}

export function authErrorMessage(code: string | undefined, mode: Exclude<AuthMode, "entry">) {
  if (code === "INVALID_CREDENTIALS") return "邮箱或密码不正确，请检查后重试。";
  if (code === "EMAIL_ALREADY_REGISTERED") return "这个邮箱已经注册，请直接登录。";
  if (code === "INVALID_EMAIL") return "请输入有效的邮箱地址。";
  if (code === "INVALID_PASSWORD") return "密码至少需要 8 位。";
  if (code === "AUTH_REQUIRED") return "登录状态已失效，请重新登录。";
  if (mode === "register") return "暂时无法完成注册，请稍后重试。";
  return "暂时无法登录，请稍后重试。";
}

export function authErrorField(code: string | undefined, _mode: Exclude<AuthMode, "entry">): AuthField | null {
  if (code === "INVALID_EMAIL" || code === "EMAIL_ALREADY_REGISTERED") return "email";
  if (code === "INVALID_PASSWORD") return "password";
  return null;
}

export function authHash(mode: AuthMode) {
  return mode === "entry" ? "#/auth" : `#/auth?mode=${mode}`;
}

export function parseAuthHash(hash: string): { mode: AuthMode } {
  if (!hash.startsWith("#/auth")) return { mode: "entry" };
  const query = hash.split("?", 2)[1] ?? "";
  const mode = new URLSearchParams(query).get("mode");
  return mode === "login" || mode === "register" ? { mode } : { mode: "entry" };
}

export function isAuthErrorCode(value: string): value is AuthErrorCode {
  return [
    "AUTH_REQUIRED",
    "INVALID_CREDENTIALS",
    "INVALID_EMAIL",
    "INVALID_PASSWORD",
    "EMAIL_ALREADY_REGISTERED",
    "INVALID_REQUEST",
    "INTERNAL_ERROR",
  ].includes(value);
}
