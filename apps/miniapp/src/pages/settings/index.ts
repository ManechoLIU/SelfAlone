import type { MiniappApp } from "../../app";
import { resolveWeReadClient, type WeReadClient } from "../../adapters/weread";
import { presentWeReadSync, weReadErrorMessage, type WeReadConnectionProjection, type WeReadSyncViewStatus } from "../../core/weread-state";
import { createViewportTracker, viewportPresentation } from "../../core/viewport-state";

type SettingsData = {
  drawerOpen: boolean;
  keyboardOpen: boolean;
  viewportStyle: string;
  viewportMetrics: string;
  wereadConnection: WeReadConnectionProjection | null;
  wereadSyncStatus: WeReadSyncViewStatus;
  wereadSyncLabel: string;
  wereadApiKey: string;
  wereadEditorOpen: boolean;
  wereadError: string;
};

let wereadRequestSequence = 0;

function nextWeReadRequestId() {
  wereadRequestSequence += 1;
  return `mini-weread-${Date.now()}-${wereadRequestSequence}`;
}

Page<SettingsData>({
  data: {
    drawerOpen: false,
    keyboardOpen: false,
    viewportStyle: "",
    viewportMetrics: "",
    wereadConnection: null,
    wereadSyncStatus: "idle",
    wereadSyncLabel: "未连接",
    wereadApiKey: "",
    wereadEditorOpen: false,
    wereadError: "",
  },
  onLoad(options?: { service?: string }) {
    this.isUnloaded = false;
    if (options?.service === "weread") this.setData({ wereadEditorOpen: true });
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
    void this.loadWeReadConnection();
  },
  onUnload() {
    this.isUnloaded = true;
    this.releaseViewport?.();
  },
  toggleDrawer() { this.setData({ drawerOpen: !this.data.drawerOpen }); },
  closeDrawer() { this.setData({ drawerOpen: false }); },
  resolveWeReadClient(): WeReadClient {
    const globalData = getApp<MiniappApp>().globalData as MiniappApp["globalData"] & {
      wereadClient?: unknown;
      weReadClient?: unknown;
      weread?: unknown;
    };
    return resolveWeReadClient(globalData.wereadClient ?? globalData.weReadClient ?? globalData.weread);
  },
  async loadWeReadConnection() {
    try {
      const response = await this.resolveWeReadClient().getConnection();
      if (this.isUnloaded) return;
      const connection = response.connection?.status === "disconnected" ? null : response.connection;
      const connectionSync = connection?.status === "paused"
        ? { status: "paused" as const, label: "需要更新" }
        : connection
          ? { status: "success" as const, label: "已连接" }
          : { status: "idle" as const, label: "未连接" };
      this.setData({
        wereadConnection: connection,
        wereadSyncStatus: connectionSync.status,
        wereadSyncLabel: connectionSync.label,
        wereadError: "",
      });
    } catch (error) {
      if (this.isUnloaded) return;
      this.setData({ wereadError: weReadErrorMessage(error) });
    }
  },
  showWeReadSettings() {
    this.setData({ wereadEditorOpen: true, wereadApiKey: "", wereadError: "" });
  },
  closeWeReadSettings() {
    this.setData({ wereadEditorOpen: false, wereadApiKey: "", wereadError: "" });
  },
  onWeReadApiKeyInput(event: MiniappEvent<{ value: string }>) {
    this.setData({ wereadApiKey: event.detail.value, wereadError: "" });
  },
  async saveWeReadConnection() {
    const apiKey = this.data.wereadApiKey.trim();
    if (!apiKey) {
      this.setData({ wereadError: "请输入微信读书 API Key" });
      return;
    }
    const expectedRevision = this.data.wereadConnection?.revision ?? null;
    try {
      const response = await this.resolveWeReadClient().putConnection({
        apiKey,
        requestId: nextWeReadRequestId(),
        expectedRevision,
      });
      if (this.isUnloaded) return;
      const sync = presentWeReadSync(response.sync);
      this.setData({
        wereadConnection: response.connection,
        wereadSyncStatus: sync.status,
        wereadSyncLabel: sync.label,
        wereadApiKey: "",
        wereadEditorOpen: false,
        wereadError: sync.message,
      });
    } catch (error) {
      if (this.isUnloaded) return;
      this.setData({ wereadError: weReadErrorMessage(error) });
    }
  },
  retryWeReadConnection() {
    void this.loadWeReadConnection();
  },
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
