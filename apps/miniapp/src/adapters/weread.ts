import {
  type WeReadAnnotationsSnapshotRequest,
  type WeReadAnnotationsSnapshotResponse,
  type WeReadAnnotationsSyncRequest,
  type WeReadAnnotationsSyncResponse,
  type WeReadBooksSnapshotRequest,
  type WeReadBooksSnapshotResponse,
  type WeReadBooksSyncRequest,
  type WeReadBooksSyncResponse,
  type WeReadConnectionDeleteRequest,
  type WeReadConnectionDeleteResponse,
  type WeReadConnectionGetResponse,
  type WeReadConnectionPutRequest,
  type WeReadConnectionPutResponse,
  type WeReadSyncStatusResponse,
} from "../core/weread-state";

export type {
  WeReadAnnotation,
  WeReadAnnotationView,
  WeReadApiError,
  WeReadApiErrorCode,
  WeReadAnnotationsSnapshotRequest,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncRequest,
  WeReadAnnotationsSyncResponse,
  WeReadBook,
  WeReadBooksSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadBooksSyncRequest,
  WeReadBooksSyncResponse,
  WeReadConnectionDeleteRequest,
  WeReadConnectionDeleteResponse,
  WeReadConnectionGetResponse,
  WeReadConnectionProjection,
  WeReadConnectionPutRequest,
  WeReadConnectionPutResponse,
  WeReadSyncStatusResponse,
  WeReadSyncRunProjection,
} from "../core/weread-state";

/** Route-agnostic consumer port for the frozen WeRead JSON boundary. */
export type WeReadPort = {
  getConnection(): Promise<WeReadConnectionGetResponse>;
  putConnection(input: WeReadConnectionPutRequest): Promise<WeReadConnectionPutResponse>;
  deleteConnection(input: WeReadConnectionDeleteRequest): Promise<WeReadConnectionDeleteResponse>;
  getBooks(input?: WeReadBooksSnapshotRequest): Promise<WeReadBooksSnapshotResponse>;
  syncBooks(input: WeReadBooksSyncRequest): Promise<WeReadBooksSyncResponse>;
  getAnnotations(input: WeReadAnnotationsSnapshotRequest): Promise<WeReadAnnotationsSnapshotResponse>;
  syncAnnotations(input: WeReadAnnotationsSyncRequest): Promise<WeReadAnnotationsSyncResponse>;
  getSyncStatus(runId: string): Promise<WeReadSyncStatusResponse>;
};

export type WeReadPortCandidate = Partial<WeReadPort> | null | undefined;

export class WeReadAdapterError extends Error {
  constructor(readonly code: "WEREAD_NO_CALL", message = "微信读书连接尚未配置") {
    super(message);
    this.name = "WeReadAdapterError";
  }
}

export function createNoCallWeReadPort(): WeReadPort {
  const unavailable = <T>(): Promise<T> => Promise.reject(new WeReadAdapterError("WEREAD_NO_CALL"));
  return {
    getConnection: async () => ({ connection: null }),
    putConnection: () => unavailable(),
    deleteConnection: () => unavailable(),
    getBooks: () => unavailable(),
    syncBooks: () => unavailable(),
    getAnnotations: () => unavailable(),
    syncAnnotations: () => unavailable(),
    getSyncStatus: () => unavailable(),
  };
}

const defaultNoCallPort = createNoCallWeReadPort();

/**
 * Wrap an injected port without adding a transport or an endpoint policy.
 * Missing capabilities stay fail-closed through the no-call implementation.
 */
export function createWeReadAdapter(candidate: WeReadPortCandidate = {}): WeReadPort {
  const port = candidate && typeof candidate === "object" ? candidate : {};
  return {
    getConnection: port.getConnection?.bind(port) ?? defaultNoCallPort.getConnection,
    putConnection: port.putConnection?.bind(port) ?? defaultNoCallPort.putConnection,
    deleteConnection: port.deleteConnection?.bind(port) ?? defaultNoCallPort.deleteConnection,
    getBooks: port.getBooks?.bind(port) ?? defaultNoCallPort.getBooks,
    syncBooks: port.syncBooks?.bind(port) ?? defaultNoCallPort.syncBooks,
    getAnnotations: port.getAnnotations?.bind(port) ?? defaultNoCallPort.getAnnotations,
    syncAnnotations: port.syncAnnotations?.bind(port) ?? defaultNoCallPort.syncAnnotations,
    getSyncStatus: port.getSyncStatus?.bind(port) ?? defaultNoCallPort.getSyncStatus,
  };
}

export type WeReadClient = WeReadPort;

export function resolveWeReadClient(candidate: unknown): WeReadClient {
  return createWeReadAdapter(candidate as WeReadPortCandidate);
}
