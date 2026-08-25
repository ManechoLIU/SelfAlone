import type { MiniappClient, BookListOptions, LocalBookFile } from "./client";
import { ClientBoundaryError } from "./client";
import { DevelopmentClient } from "./development";

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
}

export function createClientAdapter(envVersion: string | undefined): MiniappClient {
  return envVersion === "develop" ? new DevelopmentClient() : new UnavailableClient();
}
