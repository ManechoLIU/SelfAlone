export type SettingsServiceStatus = {
  connected: boolean;
  label: string;
};

export type SettingsOverview = {
  account: { id: string; email: string };
  loginMethods: {
    email: { connected: boolean; label: string | null };
    wechat: { connected: boolean; label: string | null };
  };
  services?: {
    textModel?: SettingsServiceStatus;
    imageModel?: SettingsServiceStatus;
    weread?: SettingsServiceStatus;
  };
};

export type SettingsDraft = {
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type SettingsMutationKind = "idle" | "change-email" | "change-password" | "logout";
export type SettingsMutationPhase = "idle" | "submitting" | "success" | "failed";

export type SettingsMutation = {
  kind: SettingsMutationKind;
  phase: SettingsMutationPhase;
  error: string;
};

export type SettingsView = "overview" | "account";
export type SettingsPhase = "loading" | "ready" | "failed";

export type SettingsState = {
  phase: SettingsPhase;
  overview: SettingsOverview | null;
  error: string;
  accountError: string;
  view: SettingsView;
  logoutConfirmation: boolean;
  draft: SettingsDraft;
  mutation: SettingsMutation;
};

const blankDraft: SettingsDraft = {
  email: "",
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function createSettingsState(overview: SettingsOverview | null = null): SettingsState {
  return {
    phase: overview ? "ready" : "loading",
    overview,
    error: "",
    accountError: "",
    view: "overview",
    logoutConfirmation: false,
    draft: overview
      ? { ...blankDraft, email: overview.account.email }
      : { ...blankDraft },
    mutation: { kind: "idle", phase: "idle", error: "" },
  };
}

function settingsFailure(state: SettingsState, error: unknown): SettingsState {
  const message = settingsErrorMessage(error instanceof Error ? error.message : undefined);
  return {
    ...state,
    phase: state.overview ? "ready" : "failed",
    error: message,
    mutation: state.mutation.kind === "idle"
      ? state.mutation
      : { ...state.mutation, phase: "failed", error: message },
  };
}

export function resolveSettingsOverview(
  state: SettingsState,
  result: SettingsOverview | Error,
): SettingsState {
  if (result instanceof Error) return settingsFailure(state, result);
  return {
    ...state,
    phase: "ready",
    overview: result,
    error: "",
    draft: { ...state.draft, email: state.draft.email || result.account.email },
  };
}

export function settingsDraftStorageKey(accountId: string) {
  return `selfalone:m1:settings-draft:${accountId}`;
}

export function serializeSettingsDraft(draft: SettingsDraft) {
  return JSON.stringify({ version: 1, ...draft });
}

export function parseSettingsDraft(value: string | null): SettingsDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.email !== "string"
      || typeof record.currentPassword !== "string"
      || typeof record.newPassword !== "string"
      || typeof record.confirmPassword !== "string"
    ) {
      return null;
    }
    return {
      email: record.email,
      currentPassword: record.currentPassword,
      newPassword: record.newPassword,
      confirmPassword: record.confirmPassword,
    };
  } catch {
    return null;
  }
}

export function settingsHash() {
  return "#/settings";
}

export function settingsErrorMessage(code: string | undefined) {
  if (code === "SETTINGS_LOAD_FAILED") return "暂时无法加载设置，请稍后重试。";
  if (code === "EMAIL_DELIVERY_UNAVAILABLE") return "暂时无法发送验证邮件，请稍后重试。";
  if (code === "INVALID_EMAIL_TOKEN") return "验证链接已失效，请重新申请。";
  if (code === "REAUTHENTICATION_REQUIRED") return "请先验证当前账户身份，再保存修改。";
  if (code === "EMAIL_ALREADY_REGISTERED") return "这个邮箱已被其他账户使用。";
  if (code === "INVALID_EMAIL") return "请输入有效的邮箱地址。";
  if (code === "INVALID_PASSWORD") return "密码至少需要 8 位。";
  return "暂时无法保存设置，请稍后重试。";
}
