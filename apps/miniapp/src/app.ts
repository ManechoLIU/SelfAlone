import { createClientAdapter } from "./adapters/index.js";
import type { MiniappClient } from "./adapters/client";
import { createPptIntentStore } from "./core/ppt-intent";
import { createSessionStore, type Session } from "./core/session";
import { currentEnvironment, wxStorage } from "./platform";

const client = createClientAdapter(currentEnvironment());
const sessionStore = createSessionStore(wxStorage, { developmentAdapter: client.development });
const pptIntentStore = createPptIntentStore(wxStorage, { developmentAdapter: client.development });

export type MiniappGlobalData = {
  client: MiniappClient;
  session: Session;
  sessionStore: ReturnType<typeof createSessionStore>;
  pptIntentStore: ReturnType<typeof createPptIntentStore>;
  developmentAdapter: boolean;
};

const globalData: MiniappGlobalData = {
  client,
  session: sessionStore.restore(),
  sessionStore,
  pptIntentStore,
  developmentAdapter: client.development,
};

App({
  globalData,
  onLaunch() {
    this.globalData.session = this.globalData.sessionStore.restore();
  },
});

export type MiniappApp = { globalData: MiniappGlobalData };
