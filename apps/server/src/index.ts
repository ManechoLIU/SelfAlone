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
} from "./deepseek-text-model-adapter";
import { createModelConfigRuntime } from "./model-config-runtime";
import { migrateOwnerContractSchema } from "./owner-migration";
import { migrateConversationSchema } from "./conversation-migration";
import { createConversationResponderForMode } from "./conversation-responder";
import { ConversationStore } from "./conversation-store";
import { migrateConversationSelectionSchema } from "./conversation-selection-migration";
import { ConversationSelectionStore } from "./conversation-selection-store";
import { migrateTrialQuotaSchema } from "./trial-quota-migration";
import { TrialQuotaStore } from "./trial-quota-store";
import { extractTextBook } from "@selfalone/domain";
import {
  appendConversationContext,
  createConversationSession,
  deleteConversationSession,
  isConversationSendLocked,
  recordConversationWork,
  settleConversationRun,
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
  : process.env.DEEPSEEK_VALIDATION_ENDPOINT && process.env.DEEPSEEK_VALIDATION_MODEL
    ? createDeepSeekTextModelAdapter({
      catalog: {
        endpoint: process.env.DEEPSEEK_VALIDATION_ENDPOINT,
        model: process.env.DEEPSEEK_VALIDATION_MODEL,
      },
    })
    : undefined;
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
const conversationResponder = createConversationResponderForMode(
  process.env.CONVERSATION_RESPONDER_MODE,
  process.env.APP_ENV,
);
const conversation = new ConversationStore(
  conversationSql,
  {
    createSession: createConversationSession,
    updateDraft: updateConversationDraft,
    appendContext: appendConversationContext,
    startRun: startConversationRun,
    recordWork: recordConversationWork,
    settleRun: settleConversationRun,
    deleteSession: deleteConversationSession,
    isSendLocked: isConversationSendLocked,
  },
  conversationResponder ? { responder: conversationResponder } : {},
);
const conversationSelectionMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateConversationSelectionSchema(conversationSelectionMigrationDatabase);
} finally {
  await conversationSelectionMigrationDatabase.end();
}
const conversationSelectionSql = postgres(databaseUrl, { max: 2 });
const selection = new ConversationSelectionStore(conversationSelectionSql);
const trialQuotaMigrationDatabase = postgres(databaseUrl, { max: 1 });
try {
  await migrateTrialQuotaSchema(trialQuotaMigrationDatabase);
} finally {
  await trialQuotaMigrationDatabase.end();
}
const trialQuotaSql = postgres(databaseUrl, { max: 2 });
const trialQuota = new TrialQuotaStore(trialQuotaSql);
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
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: "127.0.0.1", port });
