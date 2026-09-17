import { createClientAdapter } from "./adapters/index.js";
import type { MiniappClient } from "./adapters/client";
import type { LibraryHttpTransport } from "./adapters/library-http";
import { createDevelopmentAnnotationsClient } from "./adapters/development-annotations";
import { createDevelopmentWeReadPort } from "./adapters/development-weread";
import { createNoCallWeReadPort, type WeReadClient } from "./adapters/weread";
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
import {
  readHostMiniappExtConfig,
  readLocalMiniappRuntimeConfig,
  resolveMiniappRuntimeConfig,
  resolveQaRealHttpFlag,
} from "./runtime-config";

export type MiniappGlobalData = {
  client: MiniappClient;
  authClient: MiniAuthClient;
  conversationClient: ConversationApiClient;
  annotationsClient: AnnotationsApiClient;
  wereadClient: WeReadClient;
  session: Session;
  sessionStore: ReturnType<typeof createSessionStore>;
  pptIntentStore: ReturnType<typeof createPptIntentStore>;
  developmentAdapter: boolean;
};

export type MiniappRuntimeOptions = SessionStoreOptions & {
  /** Explicit host-provided API origin; omitted means fail closed. */
  apiBaseUrl?: string;
  /** Develop-only QA switch. Default off; not a production default. */
  qaRealHttp?: boolean;
  storage?: KeyValueStorage;
  authTransport?: MiniAuthTransport;
  conversationTransport?: ConversationTransport;
  annotationsTransport?: AnnotationTransport;
  libraryTransport?: LibraryHttpTransport;
  wxLogin?: MiniWxLogin;
  environment?: string;
};

export function createMiniappGlobalData(options: MiniappRuntimeOptions = {}): MiniappGlobalData {
  const storage = options.storage ?? wxStorage;
  const environment = options.environment ?? currentEnvironment();
  const localConfig = readLocalMiniappRuntimeConfig();
  const extConfig = readHostMiniappExtConfig();
  const qaFlag = environment === "develop" && resolveQaRealHttpFlag({
    optionValue: options.qaRealHttp,
    optionProvided: Object.hasOwn(options, "qaRealHttp"),
    localConfig,
    extConfig,
    storage,
  });
  const apiBaseUrlCandidate = Object.hasOwn(options, "apiBaseUrl")
    ? options.apiBaseUrl
    : (qaFlag && typeof localConfig.apiBaseUrl === "string"
      ? localConfig.apiBaseUrl
      : extConfig.apiBaseUrl);
  const runtimeConfig = resolveMiniappRuntimeConfig(apiBaseUrlCandidate, { allowLoopback: qaFlag });
  const qaRealHttp = qaFlag && Boolean(runtimeConfig.apiBaseUrl);
  const developmentAdapter = environment === "develop" && !qaRealHttp;
  const sessionStore = createSessionStore(
    storage,
    { developmentAdapter },
    { now: options.now },
  );
  const authClient = createMiniAuthClient({
    baseUrl: runtimeConfig.apiBaseUrl,
    transport: options.authTransport,
    wxLogin: options.wxLogin,
  });
  let composedGlobalData: MiniappGlobalData | undefined;
  const onUnauthorized = (status: number) => {
    if (sessionStore.clearOnUnauthorized(status) && composedGlobalData) {
      composedGlobalData.session = { kind: "signed-out" };
    }
  };
  const client = createClientAdapter(environment, {
    baseUrl: runtimeConfig.apiBaseUrl,
    authProvider: () => sessionStore.restore(),
    onUnauthorized,
    transport: options.libraryTransport,
    qaRealHttp,
  });
  const conversationClient = createConversationApiClient({
    baseUrl: runtimeConfig.apiBaseUrl,
    authProvider: () => sessionStore.restore(),
    onUnauthorized,
    transport: options.conversationTransport,
  });
  const annotationsClient = client.development
    ? createDevelopmentAnnotationsClient()
    : createAnnotationsApiClient({
      baseUrl: runtimeConfig.apiBaseUrl,
      authProvider: () => sessionStore.restore(),
      onUnauthorized,
      transport: options.annotationsTransport,
    });
  const pptIntentStore = createPptIntentStore(storage, { developmentAdapter: client.development });
  // WeRead has no runtime override: develop gets the deterministic in-memory
  // port, every other environment stays fail-closed on the no-call port.
  const wereadClient = environment === "develop" ? createDevelopmentWeReadPort() : createNoCallWeReadPort();

  const globalData: MiniappGlobalData = {
    client,
    authClient,
    conversationClient,
    annotationsClient,
    wereadClient,
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
