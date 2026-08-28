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
    if (options?.service === "weread") {
      this.wereadEditorSession = 1;
      this.wereadSaveRequestId = undefined;
      this.wereadSaveExpectedRevision = undefined;
      this.setData({ wereadEditorOpen: true });
    }
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
    const generation = (this.wereadConnectionLoadGeneration ?? 0) + 1;
    this.wereadConnectionLoadGeneration = generation;
    const editorSession = this.wereadEditorSession ?? 0;
    const saveGeneration = this.wereadSaveGeneration ?? 0;
    const expectedConnectionId = this.data.wereadConnection?.connectionId ?? null;
    const expectedAccountExternalId = this.data.wereadConnection?.accountExternalId ?? null;
    const loadTargetStillCurrent = () => {
      const current = this.data.wereadConnection;
      return (current?.connectionId ?? null) === expectedConnectionId
        && (current?.accountExternalId ?? null) === expectedAccountExternalId;
    };
    try {
      const response = await this.resolveWeReadClient().getConnection();
      if (
        this.isUnloaded
        || generation !== this.wereadConnectionLoadGeneration
        || editorSession !== (this.wereadEditorSession ?? 0)
        || saveGeneration !== (this.wereadSaveGeneration ?? 0)
        || this.wereadSaveInFlight
        || !loadTargetStillCurrent()
      ) return;
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
      if (
        this.isUnloaded
        || generation !== this.wereadConnectionLoadGeneration
        || editorSession !== (this.wereadEditorSession ?? 0)
        || saveGeneration !== (this.wereadSaveGeneration ?? 0)
        || this.wereadSaveInFlight
        || !loadTargetStillCurrent()
      ) return;
      this.setData({ wereadError: weReadErrorMessage(error) });
    }
  },
  showWeReadSettings() {
    this.wereadEditorSession = (this.wereadEditorSession ?? 0) + 1;
    this.wereadSaveRequestId = undefined;
    this.wereadSaveExpectedRevision = undefined;
    this.wereadSaveInFlight = undefined;
    this.setData({ wereadEditorOpen: true, wereadApiKey: "", wereadError: "" });
  },
  closeWeReadSettings() {
    this.wereadEditorSession = (this.wereadEditorSession ?? 0) + 1;
    this.wereadSaveRequestId = undefined;
    this.wereadSaveExpectedRevision = undefined;
    this.wereadSaveInFlight = undefined;
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
    if (this.wereadSaveInFlight) return;
    const editorSession = this.wereadEditorSession ?? 0;
    const expectedConnectionId = this.data.wereadConnection?.connectionId ?? null;
    const expectedAccountExternalId = this.data.wereadConnection?.accountExternalId ?? null;
    const expectedRevisionAtStart = this.data.wereadConnection?.revision ?? null;
    if (!this.wereadSaveRequestId) {
      this.wereadSaveRequestId = nextWeReadRequestId();
      this.wereadSaveExpectedRevision = this.data.wereadConnection?.revision ?? null;
    }
    const requestId = this.wereadSaveRequestId;
    const expectedRevision = this.wereadSaveExpectedRevision ?? null;
    const saveGeneration = (this.wereadSaveGeneration ?? 0) + 1;
    this.wereadSaveGeneration = saveGeneration;
    this.wereadSaveInFlight = saveGeneration;
    const client = this.resolveWeReadClient();
    const saveTargetStillCurrent = () => {
      const current = this.data.wereadConnection;
      return (current?.connectionId ?? null) === expectedConnectionId
        && (current?.accountExternalId ?? null) === expectedAccountExternalId
        && (current?.revision ?? null) === expectedRevisionAtStart;
    };
    const discardStaleSave = () => {
      if (this.wereadSaveInFlight !== saveGeneration) return;
      this.wereadSaveInFlight = undefined;
      this.wereadSaveRequestId = undefined;
      this.wereadSaveExpectedRevision = undefined;
    };
    try {
      const response = await client.putConnection({
        apiKey,
        requestId,
        expectedRevision,
      });
      if (
        this.isUnloaded
        || editorSession !== (this.wereadEditorSession ?? 0)
        || this.wereadSaveRequestId !== requestId
        || this.wereadSaveInFlight !== saveGeneration
        || !saveTargetStillCurrent()
        || (expectedAccountExternalId !== null
          && response.connection.accountExternalId !== expectedAccountExternalId)
      ) {
        discardStaleSave();
        return;
      }
      const sync = presentWeReadSync(response.sync);
      this.wereadSaveInFlight = undefined;
      this.wereadSaveRequestId = undefined;
      this.wereadSaveExpectedRevision = undefined;
      this.setData({
        wereadConnection: response.connection,
        wereadSyncStatus: sync.status,
        wereadSyncLabel: sync.label,
        wereadApiKey: "",
        wereadEditorOpen: false,
        wereadError: sync.message,
      });
    } catch (error) {
      if (
        this.isUnloaded
        || editorSession !== (this.wereadEditorSession ?? 0)
        || this.wereadSaveRequestId !== requestId
        || this.wereadSaveInFlight !== saveGeneration
        || !saveTargetStillCurrent()
      ) {
        discardStaleSave();
        return;
      }
      this.wereadSaveInFlight = undefined;
      this.setData({ wereadError: weReadErrorMessage(error) });
    }
  },
  async deleteWeReadConnection() {
    const editorSession = (this.wereadEditorSession ?? 0) + 1;
    this.wereadEditorSession = editorSession;
    this.wereadSaveRequestId = undefined;
    this.wereadSaveExpectedRevision = undefined;
    this.wereadSaveInFlight = undefined;
    const target = this.data.wereadConnection;
    const expectedRevision = target?.revision;
    if (!expectedRevision) {
      this.setData({
        wereadConnection: null,
        wereadSyncStatus: "idle",
        wereadSyncLabel: "未连接",
        wereadEditorOpen: false,
        wereadApiKey: "",
        wereadError: "",
      });
      return;
    }
    const deleteTargetStillCurrent = () => {
      const current = this.data.wereadConnection;
      return !!current
        && current.connectionId === target?.connectionId
        && current.accountExternalId === target?.accountExternalId
        && current.revision === target?.revision;
    };
    try {
      const response = await this.resolveWeReadClient().deleteConnection({ expectedRevision });
      if (this.isUnloaded || editorSession !== (this.wereadEditorSession ?? 0)) return;
      if (!deleteTargetStillCurrent()) return;
      if (response.status !== "disconnected") return;
      this.setData({
        wereadConnection: null,
        wereadSyncStatus: "idle",
        wereadSyncLabel: "未连接",
        wereadEditorOpen: false,
        wereadApiKey: "",
        wereadError: "",
      });
    } catch (error) {
      if (
        this.isUnloaded
        || editorSession !== (this.wereadEditorSession ?? 0)
        || !deleteTargetStillCurrent()
      ) return;
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
