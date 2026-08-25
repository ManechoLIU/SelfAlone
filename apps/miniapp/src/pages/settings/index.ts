import type { MiniappApp } from "../../app";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";

type SettingsData = {
  drawerOpen: boolean;
  developmentAdapter: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
};

Page<SettingsData>({
  data: { drawerOpen: false, developmentAdapter: false, keyboardOpen: false, viewportStyle: "", viewportMetrics: "" },
  onLoad() {
    this.isUnloaded = false;
    this.releaseViewport = createViewportTracker(wx, (geometry) => {
      if (!this.isUnloaded) this.setData(viewportPresentation(geometry));
    });
  },
  onShow() {
    const app = getApp<MiniappApp>();
    app.globalData.session = app.globalData.sessionStore.restore();
    if (app.globalData.session.kind === "signed-out") {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ developmentAdapter: app.globalData.developmentAdapter });
  },
  onUnload() {
    this.isUnloaded = true;
    this.releaseViewport?.();
  },
  toggleDrawer() { this.setData({ drawerOpen: !this.data.drawerOpen }); },
  closeDrawer() { this.setData({ drawerOpen: false }); },
  showBoundary(event: MiniappEvent) {
    const label = String(event.currentTarget.dataset.label ?? "此设置");
    wx.showModal({
      title: `${label}等待接入`,
      content: "当前只交付客户端状态与导航骨架；真实账户、模型或微信读书能力按台账中的上游门逐项接入。",
      showCancel: false,
    });
  },
  signOut() {
    wx.showModal({
      title: "退出本地开发预览？",
      content: "只会清除本机开发会话，不会影响服务端数据。",
      confirmText: "退出",
      success: (result) => {
        if (!result.confirm) return;
        const app = getApp<MiniappApp>();
        app.globalData.sessionStore.clear();
        app.globalData.pptIntentStore.clear();
        app.globalData.session = { kind: "signed-out" };
        wx.reLaunch({ url: "/pages/login/index" });
      },
    });
  },
});
