/**
 * Server-side adapter for the domain conversation state machine.
 *
 * The server owns storage and transport concerns; it deliberately does not
 * reimplement the transition rules from packages/domain. A domain machine is
 * injected at the composition seam so this private slice can be tested before
 * the shared server entry point is released.
 */

export type ConversationRuntimeDraft = {
  text: string;
  attachments: readonly string[];
};

export type ConversationRuntimeContextEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  requestId?: string;
};

export type ConversationRuntimeTaskStatus = "running" | "stopped" | "failed" | "completed";

export type ConversationRuntimeSession = {
  id: string;
  revision: number;
  draft: ConversationRuntimeDraft | null;
  context: readonly ConversationRuntimeContextEntry[];
  activeRun: {
    requestId: string;
    kind: "response" | "task";
    status: "running";
    startedRevision: number;
    taskId?: string;
  } | null;
  tasks: readonly {
    id: string;
    requestId: string;
    status: ConversationRuntimeTaskStatus;
  }[];
  works: readonly {
    id: string;
    taskId: string;
    kind: string;
    metadata?: Readonly<Record<string, unknown>>;
  }[];
  deleted: boolean;
};

export type ConversationStateMachine = {
  createSession(
    id: string,
    initial?: Pick<ConversationRuntimeSession, "draft" | "context">,
  ): ConversationRuntimeSession;
  updateDraft(
    session: ConversationRuntimeSession,
    expectedRevision: number,
    draft: ConversationRuntimeDraft | null,
  ): ConversationRuntimeSession;
  appendContext(
    session: ConversationRuntimeSession,
    expectedRevision: number,
    entry: ConversationRuntimeContextEntry,
  ): ConversationRuntimeSession;
  startRun(
    session: ConversationRuntimeSession,
    input: {
      expectedRevision: number;
      requestId: string;
      kind: "response" | "task";
      taskId?: string;
    },
  ): ConversationRuntimeSession;
  recordWork(
    session: ConversationRuntimeSession,
    input: {
      taskId: string;
      requestId: string;
      work: {
        id: string;
        kind: string;
        metadata?: Readonly<Record<string, unknown>>;
      };
    },
  ): ConversationRuntimeSession;
  settleRun(
    session: ConversationRuntimeSession,
    input: {
      requestId: string;
      status: Exclude<ConversationRuntimeTaskStatus, "running">;
      contextEntry?: ConversationRuntimeContextEntry;
    },
  ): ConversationRuntimeSession;
  deleteSession(
    session: ConversationRuntimeSession,
    expectedRevision: number,
  ): ConversationRuntimeSession;
  isSendLocked(session: ConversationRuntimeSession): boolean;
};

export type ConversationRuntimeErrorCode =
  | "CONVERSATION_BUSY"
  | "INVALID_TASK_ID"
  | "SESSION_DELETED"
  | "SESSION_NOT_FOUND"
  | "STALE_REQUEST"
  | "STALE_REVISION"
  | "TASK_ALREADY_STARTED"
  | "TASK_NOT_FOUND"
  | "WORK_ALREADY_RECORDED";

export class ConversationRuntimeError extends Error {
  readonly code: ConversationRuntimeErrorCode;

  constructor(code: ConversationRuntimeErrorCode) {
    super(code);
    this.name = "ConversationRuntimeError";
    this.code = code;
  }
}

export class ConversationRuntime {
  readonly #sessions = new Map<string, ConversationRuntimeSession>();

  constructor(private readonly domain: ConversationStateMachine) {}

  createSession(id: string): ConversationRuntimeSession {
    const existing = this.#sessions.get(id);
    if (existing) return cloneSession(existing);
    const created = this.domain.createSession(id);
    this.#sessions.set(id, cloneSession(created));
    return cloneSession(created);
  }

  getSession(id: string): ConversationRuntimeSession | undefined {
    const session = this.#sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  listSessions(query = ""): ConversationRuntimeSession[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...this.#sessions.values()]
      .filter((session) => {
        if (session.deleted) return false;
        if (!normalizedQuery) return true;
        return JSON.stringify(session).toLocaleLowerCase().includes(normalizedQuery);
      })
      .map(cloneSession);
  }

  canSend(sessionId: string): boolean {
    const session = this.#sessions.get(sessionId);
    return session ? !this.domain.isSendLocked(session) : false;
  }

  updateDraft(input: {
    sessionId: string;
    expectedRevision: number;
    draft: ConversationRuntimeDraft | null;
  }): ConversationRuntimeSession {
    const session = this.#writableSession(input.sessionId);
    return this.#save(() => this.domain.updateDraft(session, input.expectedRevision, input.draft));
  }

  appendContext(input: {
    sessionId: string;
    expectedRevision: number;
    entry: ConversationRuntimeContextEntry;
  }): ConversationRuntimeSession {
    const session = this.#writableSession(input.sessionId);
    return this.#save(() => this.domain.appendContext(session, input.expectedRevision, input.entry));
  }

  startResponse(input: {
    sessionId: string;
    expectedRevision: number;
    requestId: string;
  }): ConversationRuntimeSession {
    return this.#startRun({ ...input, kind: "response" });
  }

  startTask(input: {
    sessionId: string;
    expectedRevision: number;
    requestId: string;
    taskId: string;
  }): ConversationRuntimeSession {
    return this.#startRun({ ...input, kind: "task" });
  }

  recordWork(input: {
    sessionId: string;
    taskId: string;
    requestId: string;
    work: {
      id: string;
      kind: string;
      metadata?: Readonly<Record<string, unknown>>;
    };
  }): ConversationRuntimeSession {
    const session = this.#session(input.sessionId);
    return this.#save(() => this.domain.recordWork(session, {
      taskId: input.taskId,
      requestId: input.requestId,
      work: input.work,
    }));
  }

  finishRun(input: {
    sessionId: string;
    requestId: string;
    status: Exclude<ConversationRuntimeTaskStatus, "running">;
    contextEntry?: ConversationRuntimeContextEntry;
  }): ConversationRuntimeSession {
    const session = this.#session(input.sessionId);
    return this.#save(() => this.domain.settleRun(session, {
      requestId: input.requestId,
      status: input.status,
      ...(input.contextEntry ? { contextEntry: input.contextEntry } : {}),
    }));
  }

  deleteSession(input: {
    sessionId: string;
    expectedRevision: number;
  }): ConversationRuntimeSession {
    const session = this.#writableSession(input.sessionId);
    return this.#save(() => this.domain.deleteSession(session, input.expectedRevision));
  }

  #startRun(input: {
    sessionId: string;
    expectedRevision: number;
    requestId: string;
    kind: "response" | "task";
    taskId?: string;
  }): ConversationRuntimeSession {
    const session = this.#writableSession(input.sessionId);
    return this.#save(() => this.domain.startRun(session, {
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
      kind: input.kind,
      ...(input.taskId ? { taskId: input.taskId } : {}),
    }));
  }

  #session(id: string): ConversationRuntimeSession {
    const session = this.#sessions.get(id);
    if (!session) throw new ConversationRuntimeError("SESSION_NOT_FOUND");
    return session;
  }

  #writableSession(id: string): ConversationRuntimeSession {
    const session = this.#session(id);
    if (session.deleted) throw new ConversationRuntimeError("SESSION_DELETED");
    return session;
  }

  #save(operation: () => ConversationRuntimeSession): ConversationRuntimeSession {
    try {
      const next = operation();
      this.#sessions.set(next.id, cloneSession(next));
      return cloneSession(next);
    } catch (error) {
      throw mapDomainError(error);
    }
  }
}

function mapDomainError(error: unknown): ConversationRuntimeError | unknown {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return new ConversationRuntimeError(code as ConversationRuntimeErrorCode);
  }
  return error;
}

export function cloneConversationSession(session: ConversationRuntimeSession): ConversationRuntimeSession {
  return cloneSession(session);
}

function cloneSession(session: ConversationRuntimeSession): ConversationRuntimeSession {
  return {
    ...session,
    draft: cloneDraft(session.draft),
    context: session.context.map((entry) => ({ ...entry })),
    tasks: session.tasks.map((task) => ({ ...task })),
    works: session.works.map(cloneWork),
    activeRun: session.activeRun ? { ...session.activeRun } : null,
  };
}

function cloneDraft(draft: ConversationRuntimeDraft | null): ConversationRuntimeDraft | null {
  return draft ? { ...draft, attachments: [...draft.attachments] } : null;
}

function cloneWork(
  work: ConversationRuntimeSession["works"][number],
): ConversationRuntimeSession["works"][number] {
  return work.metadata ? { ...work, metadata: { ...work.metadata } } : { ...work };
}
