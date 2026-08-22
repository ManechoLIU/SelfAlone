export function assertDevelopmentAdapterAllowed(environment: string | undefined) {
  if (environment !== "development") {
    throw new Error("DEVELOPMENT_ADAPTER_DISABLED");
  }
}
