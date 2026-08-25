/** Resolve the session-bound account owner used by every user-data route. */
export function resolveAccountOwner(headers: Record<string, unknown>) {
  const value = headers["x-selfalone-account"];
  if (typeof value !== "string" || !value.trim()) throw new Error("ACCOUNT_REQUIRED");
  return value.trim();
}
