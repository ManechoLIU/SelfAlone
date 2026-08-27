import { createClientAdapter } from "./adapters/index.js";
import type { MiniappClient } from "./adapters/client";
import { createConversationApiClient, type ConversationApiClient } from "./adapters/conversation";
import { createPptIntentStore } from "./core/ppt-intent";
import { createSessionStore, type Session } from "./core/session";
import { currentEnvironment, wxStorage } from "./platform";

const client = createClientAdapter(currentEnvironment());
// M2-F1 supplies the base URL and exact auth headers at its composition seam.
// Keeping the default unconfigured makes production fail closed until then.
const conversationClient = createConversationApiClient();
const sessionStore = createSessionStore(wxStorage, { developmentAdapter: client.development });
const pptIntentStore = createPptIntentStore(wxStorage, { developmentAdapter: client.development });

export type MiniappGlobalData = {
  client: MiniappClient;
  conversationClient: ConversationApiClient;
  session: Session;
  sessionStore: ReturnType<typeof createSessionStore>;
  pptIntentStore: ReturnType<typeof createPptIntentStore>;
  developmentAdapter: boolean;
};

const globalData: MiniappGlobalData = {
  client,
  conversationClient,
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
