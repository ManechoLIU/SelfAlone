import type { KeyValueStorage } from "./core/session";

export const wxStorage: KeyValueStorage = {
  get: (key) => wx.getStorageSync(key),
  set: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
};

export function readableError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "暂时无法连接，请稍后重试";
}

export function currentEnvironment() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return undefined;
  }
}
