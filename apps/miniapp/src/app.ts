import { createClientAdapter } from "./adapters/index.js";
import type { MiniappClient } from "./adapters/client";
import { createDevelopmentAnnotationsClient } from "./adapters/development-annotations";
import {
  createConversationApiClient,
  type ConversationApiClient,
  type ConversationTransport,
} from "./adapters/conversation";
import {
  createAnnotationsApiClient,
  type AnnotationTransport,
  type AnnotationsApiClient,
} from "./core/annotations-api";
import {
  createMiniAuthClient,
  type MiniAuthClient,
  type MiniAuthTransport,
  type MiniWxLogin,
} from "./adapters/auth";
import { createPptIntentStore } from "./core/ppt-intent";
import { createSessionStore, type KeyValueStorage, type Session, type SessionStoreOptions } from "./core/session";
import { currentEnvironment, wxStorage } from "./platform";

export type MiniappGlobalData = {
  client: MiniappClient;
  authClient: MiniAuthClient;
  conversationClient: ConversationApiClient;
  annotationsClient: AnnotationsApiClient;
  session: Session;
  sessionStore: ReturnType<typeof createSessionStore>;
  pptIntentStore: ReturnType<typeof createPptIntentStore>;
  developmentAdapter: boolean;
};

export type MiniappRuntimeOptions = SessionStoreOptions & {
  /** Explicit host-provided API origin; omitted means fail closed. */
  apiBaseUrl?: string;
  storage?: KeyValueStorage;
  authTransport?: MiniAuthTransport;
  conversationTransport?: ConversationTransport;
  annotationsTransport?: AnnotationTransport;
  wxLogin?: MiniWxLogin;
  environment?: string;
};

export function createMiniappGlobalData(options: MiniappRuntimeOptions = {}): MiniappGlobalData {
  const storage = options.storage ?? wxStorage;
  const client = createClientAdapter(options.environment ?? currentEnvironment());
  const sessionStore = createSessionStore(
    storage,
    { developmentAdapter: client.development },
    { now: options.now },
  );
  const authClient = createMiniAuthClient({
    baseUrl: options.apiBaseUrl,
    transport: options.authTransport,
    wxLogin: options.wxLogin,
  });
  let composedGlobalData: MiniappGlobalData | undefined;
  const conversationClient = createConversationApiClient({
    baseUrl: options.apiBaseUrl,
    authProvider: () => sessionStore.restore(),
    onUnauthorized: (status) => {
      if (sessionStore.clearOnUnauthorized(status) && composedGlobalData) {
        composedGlobalData.session = { kind: "signed-out" };
      }
    },
    transport: options.conversationTransport,
  });
  const annotationsClient = client.development
    ? createDevelopmentAnnotationsClient()
    : createAnnotationsApiClient({
      baseUrl: options.apiBaseUrl,
      authProvider: () => sessionStore.restore(),
      onUnauthorized: (status) => {
        if (sessionStore.clearOnUnauthorized(status) && composedGlobalData) {
          composedGlobalData.session = { kind: "signed-out" };
        }
      },
      transport: options.annotationsTransport,
    });
  const pptIntentStore = createPptIntentStore(storage, { developmentAdapter: client.development });

  const globalData: MiniappGlobalData = {
    client,
    authClient,
    conversationClient,
    annotationsClient,
    session: sessionStore.restore(),
    sessionStore,
    pptIntentStore,
    developmentAdapter: client.development,
  };
  composedGlobalData = globalData;
  return globalData;
}

const globalData = createMiniappGlobalData();

App({
  globalData,
  onLaunch() {
    this.globalData.session = this.globalData.sessionStore.restore();
  },
});

export type MiniappApp = { globalData: MiniappGlobalData };
