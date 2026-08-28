import type {
  ConversationNoteIntent,
  ConversationNoteOperation,
  TextAnnotationSource,
} from "@selfalone/contracts";
import { createTextNoteDraft, TEXT_ANNOTATION_LIMITS } from "./text-annotation";

export type ConversationRunKind = "response" | "task";
export type ConversationRunStatus = "running" | "stopped" | "failed" | "completed";
export type ConversationTaskStatus = ConversationRunStatus;

export type ConversationDraft = {
  text: string;
  attachments: readonly string[];
};

export type ConversationContextEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  requestId?: string;
};

export type ConversationWork = {
  id: string;
  taskId: string;
  kind: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ConversationRun = {
  requestId: string;
  kind: ConversationRunKind;
  status: "running";
  startedRevision: number;
  taskId?: string;
};

export type ConversationTask = {
  id: string;
  requestId: string;
  status: ConversationTaskStatus;
};

export type ConversationSessionState = {
  id: string;
  revision: number;
  draft: ConversationDraft | null;
  context: readonly ConversationContextEntry[];
  activeRun: ConversationRun | null;
  tasks: readonly ConversationTask[];
  works: readonly ConversationWork[];
  /** Optional to keep persisted sessions from before note operations were introduced readable. */
  noteOperations?: readonly ConversationNoteOperation[];
  deleted: boolean;
};

export type ConversationNoteOperationInput = {
  requestId: string;
  body: string;
  intent: ConversationNoteIntent;
};

export type ConversationStateErrorCode =
  | "CONVERSATION_BUSY"
  | "INVALID_TASK_ID"
  | "SESSION_DELETED"
  | "STALE_REQUEST"
  | "STALE_REVISION"
  | "TASK_ALREADY_STARTED"
  | "TASK_NOT_FOUND"
  | "WORK_ALREADY_RECORDED"
  | "REQUEST_ID_REQUIRED"
  | "NOTE_INTENT_REQUIRED"
  | "NOTE_BODY_REQUIRED"
  | "NOTE_BOOK_REQUIRED"
  | "NOTE_ID_REQUIRED"
  | "NOTE_VERSION_INVALID"
  | "NOTE_OPERATION_NOT_FOUND"
  | "REQUEST_ID_CONFLICT"
  | "NOTE_OPERATION_NOT_RETRYABLE";

export class ConversationStateError extends Error {
  readonly code: ConversationStateErrorCode;

  constructor(code: ConversationStateErrorCode) {
    super(code);
    this.name = "ConversationStateError";
    this.code = code;
  }
}

export function createConversationSession(
  id: string,
  initial: Pick<ConversationSessionState, "draft" | "context"> = {
    draft: null,
    context: [],
  },
): ConversationSessionState {
  return {
    id,
    revision: 0,
    draft: cloneDraft(initial.draft),
    context: initial.context.map(cloneContextEntry),
    activeRun: null,
    tasks: [],
    works: [],
    noteOperations: [],
    deleted: false,
  };
}

export function createConversationNoteOperation(
  input: ConversationNoteOperationInput,
): ConversationNoteOperation {
  return normalizeConversationNoteOperation(input);
}

export function startConversationNoteOperation(
  session: ConversationSessionState,
  expectedRevision: number,
  operation: ConversationNoteOperation,
): ConversationSessionState {
  assertWritable(session);
  const normalizedOperation = normalizeConversationNoteOperation(operation);

  const noteOperations = session.noteOperations ?? [];
  const existing = noteOperations.find((candidate) => candidate.requestId === normalizedOperation.requestId);
  if (existing) {
    if (!sameNoteOperation(existing, normalizedOperation)) {
      throw new ConversationStateError("REQUEST_ID_CONFLICT");
    }

    if (existing.status === "completed" || existing.status === "pending") {
      return cloneSession(session);
    }

    assertRevision(session, expectedRevision);
    return nextState(session, {
      noteOperations: noteOperations.map((candidate) =>
        candidate.requestId === normalizedOperation.requestId
          ? { ...cloneNoteOperation(normalizedOperation), status: "pending", errorCode: null }
          : candidate,
      ),
    });
  }

  assertRevision(session, expectedRevision);
  return nextState(session, {
    noteOperations: [...noteOperations, cloneNoteOperation(normalizedOperation)],
  });
}

export function failConversationNoteOperation(
  session: ConversationSessionState,
  expectedRevision: number,
  requestId: string,
  errorCode: string,
): ConversationSessionState {
  assertWritable(session);
  assertRevision(session, expectedRevision);
  const noteOperations = session.noteOperations ?? [];
  const existing = noteOperations.find((operation) => operation.requestId === requestId);
  if (!existing) throw new ConversationStateError("NOTE_OPERATION_NOT_FOUND");
  if (existing.status === "completed") return cloneSession(session);
  if (existing.status === "failed" && existing.errorCode === errorCode) {
    return cloneSession(session);
  }

  return nextState(session, {
    noteOperations: noteOperations.map((operation) =>
      operation.requestId === requestId
        ? { ...cloneNoteOperation(operation), status: "failed", errorCode: requiredNoteText(errorCode, "NOTE_OPERATION_NOT_RETRYABLE") }
        : operation,
    ),
  });
}

export function completeConversationNoteOperation(
  session: ConversationSessionState,
  expectedRevision: number,
  requestId: string,
): ConversationSessionState {
  assertWritable(session);
  const noteOperations = session.noteOperations ?? [];
  const existing = noteOperations.find((operation) => operation.requestId === requestId);
  if (!existing) throw new ConversationStateError("NOTE_OPERATION_NOT_FOUND");
  if (existing.status === "completed") return cloneSession(session);
  assertRevision(session, expectedRevision);
  if (existing.status === "failed") throw new ConversationStateError("NOTE_OPERATION_NOT_RETRYABLE");

  return nextState(session, {
    noteOperations: noteOperations.map((operation) =>
      operation.requestId === requestId
        ? { ...cloneNoteOperation(operation), status: "completed", errorCode: null }
        : operation,
    ),
  });
}

export function updateConversationDraft(
  session: ConversationSessionState,
  expectedRevision: number,
  draft: ConversationDraft | null,
): ConversationSessionState {
  assertWritable(session);
  assertRevision(session, expectedRevision);
  return nextState(session, { draft: cloneDraft(draft) });
}

export function appendConversationContext(
  session: ConversationSessionState,
  expectedRevision: number,
  entry: ConversationContextEntry,
): ConversationSessionState {
  assertWritable(session);
  assertRevision(session, expectedRevision);
  return nextState(session, { context: [...session.context, cloneContextEntry(entry)] });
}

export function startConversationRun(
  session: ConversationSessionState,
  input: {
    expectedRevision: number;
    requestId: string;
    kind: ConversationRunKind;
    taskId?: string;
  },
): ConversationSessionState {
  assertWritable(session);
  assertRevision(session, input.expectedRevision);
  if (session.activeRun) throw new ConversationStateError("CONVERSATION_BUSY");

  const taskId = input.kind === "task" ? input.taskId : undefined;
  if (input.kind === "task" && !taskId) {
    throw new ConversationStateError("INVALID_TASK_ID");
  }
  if (taskId && session.tasks.some((task) => task.id === taskId)) {
    throw new ConversationStateError("TASK_ALREADY_STARTED");
  }

  const activeRun: ConversationRun = {
    requestId: input.requestId,
    kind: input.kind,
    status: "running",
    startedRevision: session.revision + 1,
    ...(taskId ? { taskId } : {}),
  };
  const tasks = taskId
    ? [...session.tasks, { id: taskId, requestId: input.requestId, status: "running" as const }]
    : session.tasks;
  return nextState(session, { activeRun, tasks });
}

export function recordConversationWork(
  session: ConversationSessionState,
  input: {
    taskId: string;
    requestId: string;
    work: Omit<ConversationWork, "taskId">;
  },
): ConversationSessionState {
  const activeRun = session.activeRun;
  if (
    !activeRun
    || activeRun.kind !== "task"
    || activeRun.taskId !== input.taskId
    || activeRun.requestId !== input.requestId
  ) {
    throw new ConversationStateError("STALE_REQUEST");
  }
  if (!session.tasks.some((task) => task.id === input.taskId)) {
    throw new ConversationStateError("TASK_NOT_FOUND");
  }
  if (session.works.some((work) => work.id === input.work.id)) {
    throw new ConversationStateError("WORK_ALREADY_RECORDED");
  }

  return nextState(session, {
    works: [
      ...session.works,
      {
        ...input.work,
        ...(input.work.metadata ? { metadata: { ...input.work.metadata } } : {}),
        taskId: input.taskId,
      },
    ],
  });
}

export function settleConversationRun(
  session: ConversationSessionState,
  input: {
    requestId: string;
    status: Exclude<ConversationRunStatus, "running">;
    contextEntry?: ConversationContextEntry;
  },
): ConversationSessionState {
  const activeRun = session.activeRun;
  if (!activeRun || activeRun.requestId !== input.requestId) {
    throw new ConversationStateError("STALE_REQUEST");
  }

  const tasks = activeRun.taskId
    ? session.tasks.map((task) =>
      task.id === activeRun.taskId ? { ...task, status: input.status } : task,
    )
    : session.tasks;
  const context = input.contextEntry
    ? [...session.context, cloneContextEntry({ ...input.contextEntry, requestId: input.requestId })]
    : session.context;
  return nextState(session, { activeRun: null, tasks, context });
}

export function deleteConversationSession(
  session: ConversationSessionState,
  expectedRevision: number,
): ConversationSessionState {
  assertWritable(session);
  assertRevision(session, expectedRevision);
  return nextState(session, { draft: null, deleted: true });
}

export function isConversationSendLocked(session: ConversationSessionState): boolean {
  return session.activeRun?.status === "running";
}

function assertWritable(session: ConversationSessionState) {
  if (session.deleted) throw new ConversationStateError("SESSION_DELETED");
}

function assertRevision(session: ConversationSessionState, expectedRevision: number) {
  if (session.revision !== expectedRevision) {
    throw new ConversationStateError("STALE_REVISION");
  }
}

function nextState(
  session: ConversationSessionState,
  patch: Partial<ConversationSessionState>,
): ConversationSessionState {
  return {
    ...session,
    ...patch,
    revision: session.revision + 1,
    draft: cloneDraft(patch.draft !== undefined ? patch.draft : session.draft),
    context: patch.context ? patch.context.map(cloneContextEntry) : session.context.map(cloneContextEntry),
    tasks: patch.tasks ? patch.tasks.map((task) => ({ ...task })) : session.tasks.map((task) => ({ ...task })),
    works: patch.works ? patch.works.map(cloneWork) : session.works.map(cloneWork),
    noteOperations: patch.noteOperations
      ? patch.noteOperations.map(cloneNoteOperation)
      : (session.noteOperations ?? []).map(cloneNoteOperation),
    activeRun: patch.activeRun ? { ...patch.activeRun } : patch.activeRun === null ? null : session.activeRun
      ? { ...session.activeRun }
      : null,
  };
}

function cloneDraft(draft: ConversationDraft | null): ConversationDraft | null {
  return draft ? { ...draft, attachments: [...draft.attachments] } : null;
}

function cloneContextEntry(entry: ConversationContextEntry): ConversationContextEntry {
  return { ...entry };
}

function cloneWork(work: ConversationWork): ConversationWork {
  return work.metadata ? { ...work, metadata: { ...work.metadata } } : { ...work };
}

function requiredNoteText(value: unknown, errorCode: ConversationStateErrorCode): string {
  if (typeof value !== "string") throw new ConversationStateError(errorCode);
  const normalized = value.trim();
  if (!normalized) throw new ConversationStateError(errorCode);
  return normalized;
}

function normalizeConversationNoteOperation(
  input: ConversationNoteOperationInput | ConversationNoteOperation,
): ConversationNoteOperation {
  if (!isRecord(input)) throw new ConversationStateError("NOTE_INTENT_REQUIRED");
  const candidate = input;
  const requestId = requiredNoteText(candidate.requestId, "REQUEST_ID_REQUIRED");
  const body = requiredNoteText(candidate.body, "NOTE_BODY_REQUIRED");
  const intent = normalizeNoteIntent(candidate.intent);
  createTextNoteDraft({
    body,
    source: intent.kind === "create" ? intent.source : null,
  });

  return { requestId, body, intent, status: "pending", errorCode: null };
}

function normalizeNoteIntent(input: unknown): ConversationNoteIntent {
  if (!isRecord(input)) {
    throw new ConversationStateError("NOTE_INTENT_REQUIRED");
  }

  const bookId = requiredNoteText(input.bookId, "NOTE_BOOK_REQUIRED");
  if (input.kind === "create") {
    return {
      kind: "create",
      bookId,
      source: input.source === undefined || input.source === null
        ? null
        : normalizeSource(input.source),
    };
  }

  if (input.kind !== "update") throw new ConversationStateError("NOTE_INTENT_REQUIRED");
  const noteId = requiredNoteText(input.noteId, "NOTE_ID_REQUIRED");
  const expectedVersion = input.expectedVersion;
  if (
    typeof expectedVersion !== "number"
    || !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 1
  ) {
    throw new ConversationStateError("NOTE_VERSION_INVALID");
  }
  return { kind: "update", bookId, noteId, expectedVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSource(input: unknown): TextAnnotationSource {
  if (!isRecord(input) || !isRecord(input.locator)) throw new Error("INVALID_LOCATOR");

  const locator = input.locator;
  if (locator.kind !== "text") throw new Error("INVALID_LOCATOR");
  const fileVersion = locator.fileVersion;
  if (typeof fileVersion !== "number" || !Number.isSafeInteger(fileVersion) || fileVersion < 1) {
    throw new Error("INVALID_FILE_VERSION");
  }
  if (
    typeof locator.sectionId !== "string"
    || !locator.sectionId.trim()
    || locator.sectionId.length > TEXT_ANNOTATION_LIMITS.maxSectionIdLength
  ) {
    throw new Error("INVALID_LOCATOR");
  }
  const offset = locator.offset;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
  const endOffset = input.endOffset;
  if (typeof endOffset !== "number" || !Number.isSafeInteger(endOffset) || endOffset <= offset) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
  const quote = input.quote;
  if (typeof quote !== "string" || !quote.trim()) {
    throw new Error("INVALID_HIGHLIGHT_QUOTE");
  }

  return {
    locator: {
      kind: "text",
      fileVersion,
      sectionId: locator.sectionId,
      offset,
    },
    endOffset,
    quote,
  };
}

function cloneSession(session: ConversationSessionState): ConversationSessionState {
  return {
    ...session,
    draft: cloneDraft(session.draft),
    context: session.context.map(cloneContextEntry),
    tasks: session.tasks.map((task) => ({ ...task })),
    works: session.works.map(cloneWork),
    noteOperations: (session.noteOperations ?? []).map(cloneNoteOperation),
    activeRun: session.activeRun ? { ...session.activeRun } : null,
  };
}

function cloneNoteOperation(operation: ConversationNoteOperation): ConversationNoteOperation {
  return {
    ...operation,
    intent: operation.intent.kind === "create"
      ? {
          ...operation.intent,
          source: operation.intent.source ? cloneSource(operation.intent.source) : null,
        }
      : { ...operation.intent },
  };
}

function cloneSource(source: TextAnnotationSource): TextAnnotationSource {
  return {
    locator: { ...source.locator },
    endOffset: source.endOffset,
    quote: source.quote,
  };
}

function sameNoteOperation(
  left: ConversationNoteOperation,
  right: ConversationNoteOperation,
): boolean {
  if (left.requestId !== right.requestId || left.body !== right.body) return false;
  if (left.intent.kind !== right.intent.kind || left.intent.bookId !== right.intent.bookId) return false;
  if (left.intent.kind === "update" && right.intent.kind === "update") {
    return left.intent.noteId === right.intent.noteId
      && left.intent.expectedVersion === right.intent.expectedVersion;
  }
  if (left.intent.kind !== "create" || right.intent.kind !== "create") return false;
  return sameSource(left.intent.source ?? null, right.intent.source ?? null);
}

function sameSource(left: TextAnnotationSource | null, right: TextAnnotationSource | null): boolean {
  if (!left || !right) return left === right;
  return left.endOffset === right.endOffset
    && left.quote === right.quote
    && left.locator.kind === right.locator.kind
    && left.locator.fileVersion === right.locator.fileVersion
    && left.locator.sectionId === right.locator.sectionId
    && left.locator.offset === right.locator.offset;
}
