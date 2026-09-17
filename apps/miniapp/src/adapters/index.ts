import type { MiniappClient, BookListOptions, LocalBookFile } from "./client";
import { ClientBoundaryError } from "./client";
import { DevelopmentClient } from "./development";
import {
  createLibraryHttpClient,
  createWxLibraryTransport,
  type LibraryAuthProvider,
  type LibraryHttpTransport,
} from "./library-http";

class UnavailableClient implements MiniappClient {
  readonly kind = "unavailable" as const;
  readonly development = false;
  private unavailable(): Promise<never> {
    return Promise.reject(new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE"));
  }
  listBooks(_options?: BookListOptions | string): Promise<never> { return this.unavailable(); }
  importBook(_file: LocalBookFile): Promise<never> { return this.unavailable(); }
  getBook(): Promise<never> { return this.unavailable(); }
  savePosition(): Promise<never> { return this.unavailable(); }
  getPptWorkspace(): Promise<never> { return this.unavailable(); }
  savePptWorkspace(): Promise<never> { return this.unavailable(); }
  createPptDraft(): Promise<never> { return this.unavailable(); }
  getPptDraftWorkspace(): Promise<never> { return this.unavailable(); }
  savePptRequirements(): Promise<never> { return this.unavailable(); }
  getPptOutline(): Promise<never> { return this.unavailable(); }
  savePptOutline(): Promise<never> { return this.unavailable(); }
  generatePptOutline(): Promise<never> { return this.unavailable(); }
}

export type ProductionClientOptions = {
  baseUrl?: string;
  authProvider?: LibraryAuthProvider;
  onUnauthorized?: (status: number) => void;
  transport?: LibraryHttpTransport;
  /** Develop-only QA switch. Default off; on + baseUrl uses the production HTTP client. */
  qaRealHttp?: boolean;
};

export function createClientAdapter(
  envVersion: string | undefined,
  productionOptions: ProductionClientOptions = {},
): MiniappClient {
  if (envVersion === "develop") {
    const useQaHttp = productionOptions.qaRealHttp === true && Boolean(productionOptions.baseUrl?.trim());
    if (!useQaHttp) return new DevelopmentClient();
  }
  if (productionOptions.baseUrl?.trim() && productionOptions.authProvider) {
    return createLibraryHttpClient({
      baseUrl: productionOptions.baseUrl,
      authProvider: productionOptions.authProvider,
      onUnauthorized: productionOptions.onUnauthorized,
      transport: productionOptions.transport ?? createWxLibraryTransport(),
    });
  }
  return new UnavailableClient();
}
