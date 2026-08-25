type DrawerStatus = "loading" | "empty" | "filtered-empty" | "failed" | "normal";

type DrawerConversation = {
  id: string;
  title: string;
  preview?: string;
  updatedLabel?: string;
  current?: boolean;
  disabled?: boolean;
  target?: "conversation" | "library" | "settings";
};

const FALLBACK_CONVERSATIONS: DrawerConversation[] = [
  {
    id: "current",
    title: "当前会话",
    preview: "继续你的讨论",
    updatedLabel: "刚刚",
    current: true,
  },
];

const STATUSES: DrawerStatus[] = ["loading", "empty", "filtered-empty", "failed", "normal"];

function normalizeStatus(value: unknown): DrawerStatus {
  return typeof value === "string" && STATUSES.includes(value as DrawerStatus)
    ? value as DrawerStatus
    : "normal";
}

function normalizeConversations(value: unknown): DrawerConversation[] {
  if (!Array.isArray(value) || value.length === 0) return FALLBACK_CONVERSATIONS;
  return value.filter((item): item is DrawerConversation => {
    if (!item || typeof item !== "object") return false;
    const conversation = item as Partial<DrawerConversation>;
    return typeof conversation.id === "string" && typeof conversation.title === "string";
  });
}

Component({
  data: {
    query: "",
    drawerStatus: "normal" as DrawerStatus,
    sourceConversations: FALLBACK_CONVERSATIONS,
    visibleConversations: FALLBACK_CONVERSATIONS,
  },
  properties: {
    open: { type: Boolean, value: false },
    current: { type: String, value: "" },
    viewportStyle: { type: String, value: "" },
    keyboardOpen: { type: Boolean, value: false },
    status: { type: String, value: "normal" },
    conversations: { type: Array, value: [] },
    errorMessage: { type: String, value: "" },
  },
  observers: {
    status(value: unknown) {
      this.updatePresentation(normalizeStatus(value));
    },
    conversations(value: unknown) {
      const source = normalizeConversations(value);
      this.setData({ sourceConversations: source });
      this.updatePresentation(undefined, source);
    },
  },
  methods: {
    updatePresentation(status?: DrawerStatus, sourceOverride?: DrawerConversation[], queryOverride?: string) {
      const nextStatus = status ?? normalizeStatus(this.data.status);
      const source = sourceOverride ?? this.data.sourceConversations as DrawerConversation[];
      const query = String(queryOverride ?? this.data.query ?? "").trim().toLocaleLowerCase();
      const matching = source.filter((item) => {
        if (!query) return true;
        return `${item.title} ${item.preview ?? ""}`.toLocaleLowerCase().includes(query);
      });
      const effectiveStatus = nextStatus === "normal" && query && matching.length === 0
        ? "filtered-empty"
        : nextStatus;
      this.setData({
        drawerStatus: effectiveStatus,
        visibleConversations: effectiveStatus === "normal" || effectiveStatus === "failed" ? matching : [],
      });
    },
    close() {
      this.triggerEvent("close");
    },
    onSearch(event: MiniappEvent<{ value: string }>) {
      const query = String(event.detail.value ?? "");
      this.setData({ query });
      this.updatePresentation(undefined, undefined, query);
    },
    clearSearch() {
      this.setData({ query: "" });
      this.updatePresentation("normal", undefined, "");
    },
    retry() {
      this.setData({ drawerStatus: "loading" });
      this.triggerEvent("retry", { query: this.data.query });
    },
    navigate(event: MiniappEvent) {
      const target = String(event.currentTarget.dataset.target ?? "conversation");
      const routes: Record<string, string> = {
        conversation: "/pages/conversation/index",
        library: "/pages/library/index",
        settings: "/pages/settings/index",
      };
      const url = routes[target];
      if (!url) return;
      this.triggerEvent("select", {
        id: String(event.currentTarget.dataset.id ?? ""),
        target,
      });
      this.triggerEvent("close");
      wx.reLaunch({ url });
    },
  },
});
