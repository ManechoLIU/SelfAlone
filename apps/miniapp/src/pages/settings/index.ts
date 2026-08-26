import type { MiniappApp } from "../../app";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";

type SettingsData = {
  drawerOpen: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
};

Page<SettingsData>({
  data: { drawerOpen: false, keyboardOpen: false, viewportStyle: "", viewportMetrics: "" },
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
      title: `${label}暂不可用`,
      content: "这项设置目前还不能使用，当前不会修改任何账户或服务信息。",
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
