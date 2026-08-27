import type { MiniappApp } from "../../app";
import { MiniAuthError } from "../../adapters/auth";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";
import { readableError } from "../../platform";

type LoginData = {
  mode: "main" | "email";
  email: string;
  message: string;
  developmentAdapter: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
  wechatPending: boolean;
};

Page<LoginData>({
  data: {
    mode: "main",
    email: "",
    message: "",
    developmentAdapter: false,
    keyboardOpen: false,
    viewportStyle: "",
    viewportMetrics: "",
    wechatPending: false,
  },
  onLoad() {
    this.isUnloaded = false;
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (!this.isUnloaded) this.setData(viewportPresentation(geometry));
    });
    const app = getApp<MiniappApp>();
    app.globalData.session = app.globalData.sessionStore.restore();
    if (app.globalData.session.kind !== "signed-out") {
      wx.reLaunch({ url: "/pages/conversation/index" });
      return;
    }
    this.setData({
      email: app.globalData.sessionStore.restoreEmailDraft(),
      developmentAdapter: app.globalData.developmentAdapter,
    });
  },
  onUnload() {
    this.isUnloaded = true;
    this.releaseViewport?.();
  },
  showWechatBoundary() {
    wx.showModal({
      title: "微信身份尚未接入",
      content: "真实 wx.login()、AppID 与服务端会话等待 M2-F1。本页不会伪造登录成功。",
      showCancel: false,
    });
  },
  async loginWechat() {
    if (this.data.wechatPending) return;
    this.setData({ wechatPending: true, message: "" });
    try {
      const app = getApp<MiniappApp>();
      const result = await app.globalData.authClient.login();
      app.globalData.session = app.globalData.sessionStore.saveAuthenticatedSession(
        result.sessionToken,
        result.expiresAt,
      );
      wx.reLaunch({ url: "/pages/conversation/index" });
    } catch (error) {
      this.setData({ message: loginFailureMessage(error) });
    } finally {
      this.setData({ wechatPending: false });
    }
  },
  showEmail() {
    this.setData({ mode: "email", message: "" });
  },
  showMain() {
    this.setData({ mode: "main", message: "" });
  },
  onEmailInput(event: MiniappEvent<{ value: string }>) {
    const email = event.detail.value;
    getApp<MiniappApp>().globalData.sessionStore.saveEmailDraft(email);
    this.setData({ email });
  },
  submitEmail() {
    getApp<MiniappApp>().globalData.sessionStore.saveEmailDraft(this.data.email);
    this.setData({ message: "邮箱身份等待 M2-F1；草稿仅保留在本机，未发送。" });
  },
  enterDevelopment() {
    try {
      const app = getApp<MiniappApp>();
      app.globalData.session = app.globalData.sessionStore.startDevelopmentSession();
      wx.reLaunch({ url: "/pages/conversation/index" });
    } catch (error) {
      this.setData({ message: readableError(error) });
    }
  },
});

function loginFailureMessage(error: unknown) {
  if (error instanceof MiniAuthError) {
    if (error.code === "WX_LOGIN_FAILED" || error.code === "WX_LOGIN_CODE_MISSING") {
      return "微信登录未完成，请重试。";
    }
    return "微信登录暂时不可用，请稍后重试。";
  }
  return readableError(error);
}
