import { createHash, randomBytes } from "node:crypto";

/** Password hashing is injected so domain rules never choose a weak fallback. */
export interface PasswordHasher {
  readonly algorithm: "argon2id" | "test";
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string) {
  const normalized = email.trim().toLocaleLowerCase("en-US");
  if (normalized.length === 0 || normalized.length > 254 || !emailPattern.test(normalized)) {
    throw new Error("INVALID_EMAIL");
  }
  return normalized;
}

export function validatePassword(password: string) {
  if (password.length < 8 || password.length > 256) {
    throw new Error("INVALID_PASSWORD");
  }
  return password;
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
