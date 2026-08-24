import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createLibraryRuntime } from "./library-runtime";
import { createM0Runtime } from "./m0-runtime";
import { assertDevelopmentAdapterAllowed } from "./runtime-policy";

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
const runtime = await createM0Runtime({ databaseUrl, artifactDirectory });
const library = await createLibraryRuntime({
  databaseUrl,
  objectDirectory: bookObjectDirectory,
  parseDelayMs: Number(process.env.BOOK_PARSE_DELAY_MS ?? 20),
});
const app = createApp({
  readiness: async () => (await runtime.ready()) && (await library.ready()),
  library,
  m0: runtime,
});

const shutdown = async () => {
  await app.close();
  await library.close();
  await runtime.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: "127.0.0.1", port });
