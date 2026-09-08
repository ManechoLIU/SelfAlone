import type { PptOutlineParagraph, PptOutlineSnapshot } from "./ppt-outline-workspace-client";
import { PptOutlineClientError } from "./ppt-outline-workspace-client";

export type PptOutlineFocusHint = { id: string; offset: number };

export type PptOutlineSaveStatus = "pending" | "saving" | "saved" | "failed" | "recovering";

export type PptOutlineWorkspaceState =
  | { phase: "hidden" }
  | {
      phase: "ready";
      draftId: string;
      paragraphs: PptOutlineParagraph[];
      version: number;
      publicSources: PptOutlineSnapshot["publicSources"];
      saveStatus: PptOutlineSaveStatus;
      saveBlocked: boolean;
      orphanIds: string[];
      dirty: boolean;
    };

/** Page count only comes from the current level-1 paragraphs (SPEC 5.3). */
export function countOutlinePages(paragraphs: readonly PptOutlineParagraph[]) {
  return paragraphs.reduce((count, paragraph) => (paragraph.level === 1 ? count + 1 : count), 0);
}

/** Mirrors the frozen hierarchy rule in apps/server/src/ppt-outline-runtime.ts. */
export function findOrphanParagraphIds(paragraphs: readonly PptOutlineParagraph[]) {
  let hasPage = false;
  let hasPoint = false;
  const orphans: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.level === 1) {
      hasPage = true;
      hasPoint = false;
    } else if (paragraph.level === 2) {
      if (!hasPage) orphans.push(paragraph.id);
      else hasPoint = true;
    } else if (!hasPage || !hasPoint) {
      orphans.push(paragraph.id);
    }
  }
  return orphans;
}

export function updateParagraphText(
  paragraphs: readonly PptOutlineParagraph[],
  id: string,
  text: string,
) {
  return paragraphs.map((paragraph) => (paragraph.id === id ? { ...paragraph, text } : paragraph));
}

export function splitParagraph(
  paragraphs: readonly PptOutlineParagraph[],
  id: string,
  offset: number,
  newId: string,
): { paragraphs: PptOutlineParagraph[]; focus: PptOutlineFocusHint } | null {
  const index = paragraphs.findIndex((paragraph) => paragraph.id === id);
  if (index < 0) return null;
  const current = paragraphs[index];
  const caret = Math.max(0, Math.min(offset, current.text.length));
  const before = current.text.slice(0, caret);
  const after = current.text.slice(caret);
  const next = [...paragraphs];
  next.splice(
    index,
    1,
    { ...current, text: before },
    { id: newId, level: current.level, text: after },
  );
  return { paragraphs: next, focus: { id: newId, offset: 0 } };
}

/** Indent enters a child level only when the previous paragraph can parent it. */
export function indentParagraph(paragraphs: readonly PptOutlineParagraph[], id: string) {
  const index = paragraphs.findIndex((paragraph) => paragraph.id === id);
  if (index <= 0) return [...paragraphs];
  const current = paragraphs[index];
  if (current.level >= 3) return [...paragraphs];
  const previous = paragraphs[index - 1];
  if (previous.level < current.level) return [...paragraphs];
  const next = [...paragraphs];
  next[index] = { ...current, level: (current.level + 1) as 2 | 3 };
  return next;
}

export function outdentParagraph(paragraphs: readonly PptOutlineParagraph[], id: string) {
  const index = paragraphs.findIndex((paragraph) => paragraph.id === id);
  if (index < 0) return [...paragraphs];
  const current = paragraphs[index];
  if (current.level <= 1) return [...paragraphs];
  const next = [...paragraphs];
  next[index] = { ...current, level: (current.level - 1) as 1 | 2 };
  return next;
}

export function removeEmptyParagraph(
  paragraphs: readonly PptOutlineParagraph[],
  id: string,
): { paragraphs: PptOutlineParagraph[]; focus: PptOutlineFocusHint } | null {
  const index = paragraphs.findIndex((paragraph) => paragraph.id === id);
  if (index <= 0) return null;
  const current = paragraphs[index];
  if (current.text.trim() !== "") return null;
  const previous = paragraphs[index - 1];
  const next = [...paragraphs];
  next.splice(index, 1);
  return { paragraphs: next, focus: { id: previous.id, offset: previous.text.length } };
}

/** Paragraph-start Backspace on a page paragraph folds it into the previous paragraph. */
export function mergeParagraphWithPrevious(
  paragraphs: readonly PptOutlineParagraph[],
  id: string,
): { paragraphs: PptOutlineParagraph[]; focus: PptOutlineFocusHint } | null {
  const index = paragraphs.findIndex((paragraph) => paragraph.id === id);
  if (index <= 0) return null;
  const current = paragraphs[index];
  const previous = paragraphs[index - 1];
  const junction = previous.text.length;
  const next = [...paragraphs];
  next.splice(index - 1, 2, { ...previous, text: previous.text + current.text });
  return { paragraphs: next, focus: { id: previous.id, offset: junction } };
}

/** The frozen PUT trims each paragraph and rejects empty text, so transient empty rows stay local. */
export function serializeOutlineForSave(paragraphs: readonly PptOutlineParagraph[]) {
  return paragraphs
    .map((paragraph) => ({ ...paragraph, text: paragraph.text.trim() }))
    .filter((paragraph) => paragraph.text !== "");
}

export type PptOutlineStoreOptions = {
  save(input: { draftId: string; expectedVersion: number; paragraphs: PptOutlineParagraph[] }): Promise<PptOutlineSnapshot>;
  recover(draftId: string): Promise<PptOutlineSnapshot | null>;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  clearScheduled?: (handle: unknown) => void;
  autosaveDelayMs?: number;
  idFactory?: () => string;
};

export function createPptOutlineWorkspaceStore(options: PptOutlineStoreOptions) {
  const delayMs = options.autosaveDelayMs ?? 400;
  const schedule = options.schedule ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearScheduled = options.clearScheduled ?? ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  let idSequence = 0;
  const idFactory = options.idFactory ?? (() => {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    idSequence += 1;
    return `outline-paragraph-${Date.now()}-${idSequence}`;
  });

  let state: PptOutlineWorkspaceState = { phase: "hidden" };
  let epoch = 0;
  let timer: unknown = null;
  let saving = false;
  const listeners = new Set<(next: PptOutlineWorkspaceState) => void>();

  const publish = (next: PptOutlineWorkspaceState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearScheduled(timer);
    timer = null;
  };

  function applyEdit(nextParagraphs: PptOutlineParagraph[]) {
    if (state.phase !== "ready") return;
    const orphanIds = findOrphanParagraphIds(nextParagraphs);
    const saveBlocked = orphanIds.length > 0;
    cancelTimer();
    publish({
      ...state,
      paragraphs: nextParagraphs,
      dirty: true,
      orphanIds,
      saveBlocked,
      saveStatus: "pending",
    });
    if (!saveBlocked) {
      timer = schedule(() => { void doSave(); }, delayMs);
    }
  }

  async function doSave() {
    if (state.phase !== "ready" || saving) return;
    const orphanIds = findOrphanParagraphIds(state.paragraphs);
    if (orphanIds.length > 0) {
      publish({ ...state, orphanIds, saveBlocked: true });
      return;
    }
    const requestEpoch = epoch;
    const draftId = state.draftId;
    const expectedVersion = state.version;
    const payload = serializeOutlineForSave(state.paragraphs);
    saving = true;
    // The in-flight content counts as persisted unless the save fails below;
    // edits landing during the flight re-mark dirty and trigger a resave.
    publish({ ...state, saveStatus: "saving", dirty: false });
    try {
      const saved = await options.save({ draftId, expectedVersion, paragraphs: payload });
      saving = false;
      if (state.phase !== "ready" || state.draftId !== draftId || requestEpoch !== epoch) return;
      // Adopt only the response version: the PUT response carries no provenance rows
      // and no transient empty paragraphs, so local text and provenance stay authoritative.
      if (state.dirty) {
        publish({ ...state, version: saved.version, saveStatus: "pending" });
        timer = schedule(() => { void doSave(); }, delayMs);
      } else {
        publish({ ...state, version: saved.version, saveStatus: "saved" });
      }
    } catch (error) {
      saving = false;
      if (state.phase !== "ready" || state.draftId !== draftId || requestEpoch !== epoch) return;
      if (error instanceof PptOutlineClientError && error.code === "PPT_WORKSPACE_STALE") {
        publish({ ...state, saveStatus: "recovering", dirty: true });
        try {
          const recovered = await options.recover(draftId);
          if (state.phase !== "ready" || state.draftId !== draftId || requestEpoch !== epoch) return;
          // GET recovery restores the current version; unpersisted local edits stay visible
          // and are never silently replaced by the recovered server paragraphs.
          publish({
            ...state,
            version: recovered?.version ?? state.version,
            publicSources: recovered && recovered.publicSources.length > 0
              ? recovered.publicSources
              : state.publicSources,
            saveStatus: "failed",
            dirty: true,
          });
        } catch {
          if (state.phase !== "ready" || state.draftId !== draftId || requestEpoch !== epoch) return;
          publish({ ...state, saveStatus: "failed", dirty: true });
        }
        return;
      }
      publish({ ...state, saveStatus: "failed", dirty: true });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (next: PptOutlineWorkspaceState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentVersion() {
      return state.phase === "ready" ? state.version : null;
    },
    ready(draftId: string, snapshot: PptOutlineSnapshot) {
      epoch += 1;
      cancelTimer();
      saving = false;
      const paragraphs = snapshot.paragraphs.map((paragraph) => ({ ...paragraph }));
      const orphanIds = findOrphanParagraphIds(paragraphs);
      publish({
        phase: "ready",
        draftId,
        paragraphs,
        version: snapshot.version,
        publicSources: snapshot.publicSources.map((source) => ({ ...source })),
        saveStatus: "saved",
        saveBlocked: orphanIds.length > 0,
        orphanIds,
        dirty: false,
      });
    },
    hide() {
      epoch += 1;
      cancelTimer();
      saving = false;
      publish({ phase: "hidden" });
    },
    editText(id: string, text: string) {
      if (state.phase !== "ready") return;
      applyEdit(updateParagraphText(state.paragraphs, id, text));
    },
    split(id: string, offset: number): PptOutlineFocusHint | null {
      if (state.phase !== "ready") return null;
      const result = splitParagraph(state.paragraphs, id, offset, idFactory());
      if (!result) return null;
      applyEdit(result.paragraphs);
      return result.focus;
    },
    indent(id: string) {
      if (state.phase !== "ready") return false;
      const next = indentParagraph(state.paragraphs, id);
      if (next === state.paragraphs || findLevel(next, id) === findLevel(state.paragraphs, id)) return false;
      applyEdit(next);
      return true;
    },
    outdent(id: string) {
      if (state.phase !== "ready") return false;
      const next = outdentParagraph(state.paragraphs, id);
      if (findLevel(next, id) === findLevel(state.paragraphs, id)) return false;
      applyEdit(next);
      return true;
    },
    backspaceAtStart(id: string): { kind: "removed" | "outdented" | "merged"; focus: PptOutlineFocusHint } | null {
      if (state.phase !== "ready") return null;
      const current = state.paragraphs.find((paragraph) => paragraph.id === id);
      if (!current) return null;
      if (current.text.trim() === "") {
        const removed = removeEmptyParagraph(state.paragraphs, id);
        if (!removed) return null;
        applyEdit(removed.paragraphs);
        return { kind: "removed", focus: removed.focus };
      }
      if (current.level > 1) {
        const next = outdentParagraph(state.paragraphs, id);
        if (findLevel(next, id) === current.level) return null;
        applyEdit(next);
        return { kind: "outdented", focus: { id, offset: 0 } };
      }
      const merged = mergeParagraphWithPrevious(state.paragraphs, id);
      if (!merged) return null;
      applyEdit(merged.paragraphs);
      return { kind: "merged", focus: merged.focus };
    },
    async retrySave() {
      if (state.phase !== "ready") return;
      cancelTimer();
      if (saving) {
        // A save is already in flight: queue a resave so the inline retry has a
        // deterministic visible outcome instead of being swallowed by the flight.
        if (!state.dirty) publish({ ...state, dirty: true, saveStatus: "pending" });
        return;
      }
      await doSave();
    },
  };
}

function findLevel(paragraphs: readonly PptOutlineParagraph[], id: string) {
  return paragraphs.find((paragraph) => paragraph.id === id)?.level;
}
