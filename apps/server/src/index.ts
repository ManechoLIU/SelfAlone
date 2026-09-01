import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createApp } from "./app";
import { createAccountSettingsRuntime } from "./account-settings";
import { migrateAccountSettingsSchema } from "./account-settings-migration";
import { createAuthRuntime } from "./auth-runtime";
import {
  createBookPresentationService,
  PostgresBookPresentationRepository,
} from "./book-presentation";
import { createLibraryRuntime } from "./library-runtime";
import { createM0Runtime } from "./m0-runtime";
import { assertDevelopmentAdapterAllowed } from "./runtime-policy";
import { createTextReaderRuntime } from "./text-reader";
import { createTextAnnotationRuntime } from "./text-annotation-runtime";
import { migrateTextAnnotationSchema } from "./text-annotation-migration";
import {
  createDeepSeekTextModelAdapter,
  createDevelopmentTextModelValidator,
  DEFAULT_DEEPSEEK_CATALOG,
} from "./deepseek-text-model-adapter";
import { createModelConfigRuntime } from "./model-config-runtime";
import { migrateOwnerContractSchema } from "./owner-migration";
import { migrateConversationSchema } from "./conversation-migration";
import {
  createConversationResponder,
  createConversationResponderForMode,
} from "./conversation-responder";
import { ConversationStore } from "./conversation-store";
import { migrateConversationSelectionSchema } from "./conversation-selection-migration";
import { ConversationSelectionStore } from "./conversation-selection-store";
import { migrateCostLedgerSchema } from "./cost-ledger-migration";
import { CostLedgerStore } from "./cost-ledger-store";
import { migrateTrialQuotaSchema } from "./trial-quota-migration";
import { TrialQuotaStore } from "./trial-quota-store";
import { createPlatformTextCapabilityFromEnvironment } from "./platform-text-capability";
import { extractTextBook } from "@selfalone/domain";
import {
  appendConversationNoteBody,
  appendConversationContext,
  bindConversationNoteIntent,
  completeConversationNoteOperation,
  createConversationSession,
  createConversationNoteOperation,
  deleteConversationSession,
  failConversationNoteOperation,
  isConversationSendLocked,
  recordConversationWork,
  settleConversationRun,
  startConversationNoteOperation,
  startConversationRun,
  updateConversationDraft,
} from "@selfalone/domain";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
const artifactDirectory = resolve(
  repositoryRoot,
  process.env.ARTIFACT_DIR ?? "data/artifacts",
);
const bookObjectDirectory = resolve(
  repositoryRoot,
  process.env.BOOK_OBJECT_DIR ?? "data/artifacts/books",
);
const port = Number(process.env.PORT ?? 4100);

assertDevelopmentAdapterAllowed(process.env.APP_ENV);
const auth = await createAuthRuntime({ databaseUrl, appEnv: process.env.APP_ENV });
const settingsMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateAccountSettingsSchema(settingsMigrationDatabase);
} finally {
  await settingsMigrationDatabase.end();
}
const accountSettings = await createAccountSettingsRuntime({ databaseUrl });
const modelConfigValidatorMode = process.env.MODEL_CONFIG_VALIDATOR_MODE;
if (modelConfigValidatorMode === "fake" && process.env.APP_ENV !== "development") {
  throw new Error("DEVELOPMENT_ADAPTER_DISABLED");
}
const modelConfigValidator = modelConfigValidatorMode === "fake"
  ? createDevelopmentTextModelValidator(process.env.MODEL_CONFIG_FAKE_KEY)
  : createDeepSeekTextModelAdapter({ catalog: DEFAULT_DEEPSEEK_CATALOG });
const modelConfig = await createModelConfigRuntime({
  databaseUrl,
  appEnv: process.env.APP_ENV,
  encryptionKey: process.env.MODEL_CREDENTIALS_ENCRYPTION_KEY,
  validator: modelConfigValidator,
});
const runtime = await createM0Runtime({ databaseUrl, artifactDirectory });
const bookPresentationDatabase = postgres(databaseUrl, { max: 2 });
const bookPresentation = createBookPresentationService(
  new PostgresBookPresentationRepository(bookPresentationDatabase),
);
const textReader = await createTextReaderRuntime({
  databaseUrl,
  objectDirectory: bookObjectDirectory,
  extractTextBook,
});
const library = await createLibraryRuntime({
  databaseUrl,
  objectDirectory: bookObjectDirectory,
  parseDelayMs: Number(process.env.BOOK_PARSE_DELAY_MS ?? 20),
  textPublisher: textReader,
});
const ownerMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateOwnerContractSchema(ownerMigrationDatabase);
} finally {
  await ownerMigrationDatabase.end();
}
const migrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateTextAnnotationSchema(migrationDatabase);
} finally {
  await migrationDatabase.end();
}
const textAnnotations = await createTextAnnotationRuntime({ databaseUrl });
const conversationMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateConversationSchema(conversationMigrationDatabase);
} finally {
  await conversationMigrationDatabase.end();
}
const conversationSql = postgres(databaseUrl, { max: 4 });
const trialQuotaMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateTrialQuotaSchema(trialQuotaMigrationDatabase);
} finally {
  await trialQuotaMigrationDatabase.end();
}
const trialQuotaSql = postgres(databaseUrl, { max: 2 });
const trialQuota = new TrialQuotaStore(trialQuotaSql);
const costLedgerMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateCostLedgerSchema(costLedgerMigrationDatabase);
} finally {
  await costLedgerMigrationDatabase.end();
}
const costLedgerSql = postgres(databaseUrl, { max: 2 });
const costLedger = new CostLedgerStore(costLedgerSql);
const developmentConversationResponder = createConversationResponderForMode(
  process.env.CONVERSATION_RESPONDER_MODE,
  process.env.APP_ENV,
);
const deepSeekChatAdapter = createDeepSeekTextModelAdapter({
  catalog: DEFAULT_DEEPSEEK_CATALOG,
  credentialProvider: modelConfig,
});
const platformTextCapability = createPlatformTextCapabilityFromEnvironment({
  configuredUserModel: deepSeekChatAdapter,
  modelConfiguration: modelConfig,
  trialQuota,
  costLedger,
  reservationAmountMicros: 500_000,
  environment: process.env,
});
const conversationResponder = developmentConversationResponder
  ?? createConversationResponder(platformTextCapability);
const conversation = new ConversationStore(
  conversationSql,
  {
    createSession: createConversationSession,
    updateDraft: updateConversationDraft,
    appendContext: appendConversationContext,
    createNoteOperation: createConversationNoteOperation,
    startNoteOperation: startConversationNoteOperation,
    failNoteOperation: failConversationNoteOperation,
    completeNoteOperation: completeConversationNoteOperation,
    bindNoteIntent: bindConversationNoteIntent,
    appendNoteBody: appendConversationNoteBody,
    startRun: startConversationRun,
    recordWork: recordConversationWork,
    settleRun: settleConversationRun,
    deleteSession: deleteConversationSession,
    isSendLocked: isConversationSendLocked,
  },
  conversationResponder
    ? { responder: conversationResponder, textAnnotations }
    : { textAnnotations },
);
const conversationSelectionMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateConversationSelectionSchema(conversationSelectionMigrationDatabase);
} finally {
  await conversationSelectionMigrationDatabase.end();
}
const conversationSelectionSql = postgres(databaseUrl, { max: 2 });
const selection = new ConversationSelectionStore(conversationSelectionSql);
const app = createApp({
  readiness: async () =>
    (await auth.ready())
    && (await runtime.ready())
    && (await library.ready())
    && (await textReader.ready())
    && (await textAnnotations.ready())
    && (await modelConfig.ready()),
  library,
  bookPresentation,
  auth,
  m0: runtime,
  textReader,
  textAnnotations,
  accountSettings: accountSettings,
  modelConfig,
  conversation,
  selection,
  trialQuota,
});

const shutdown = async () => {
  await app.close();
  await textAnnotations.close();
  await library.close();
  await textReader.close();
  await runtime.close();
  await accountSettings.close();
  await modelConfig.close();
  await auth.close();
  await bookPresentationDatabase.end({ timeout: 2 });
  await conversationSql.end();
  await conversationSelectionSql.end();
  await trialQuotaSql.end();
  await costLedgerSql.end();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: "127.0.0.1", port });
