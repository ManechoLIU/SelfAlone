import "./text-reader.css";
import {
  createTextReaderModel,
  READER_RESTORE_GUARD_MS,
  READER_SCROLL_SAVE_DELAY_MS,
  restoreParagraphOffset,
  shouldPersistReaderScroll,
  type PendingReaderSave,
  type TextLocator,
  type TextReaderApi,
} from "./text-reader-state";
import { renderTextReader } from "./text-reader-view";

export type ReaderBackgroundCacheScope = {
  accountId: string;
  bookId: string;
  fileVersion: number;
};

type ReaderBackgroundStorage = Pick<Storage, "getItem" | "setItem">;

const COPY_SUCCESS_MESSAGE = "已复制所选正文";
export const COPY_SUCCESS_CLEAR_MS = 2_400;

function isCompleteCacheScope(scope: ReaderBackgroundCacheScope | null): scope is ReaderBackgroundCacheScope {
  return Boolean(
    scope
    && scope.accountId.trim()
    && scope.bookId.trim()
    && Number.isInteger(scope.fileVersion)
    && scope.fileVersion > 0,
  );
}

export function readerBackgroundCacheKey(scope: ReaderBackgroundCacheScope) {
  return [
    "selfalone:text-reader-background",
    encodeURIComponent(scope.accountId),
    encodeURIComponent(scope.bookId),
    `v${scope.fileVersion}`,
  ].join(":");
}

export function readCachedReaderBackground(
  storage: ReaderBackgroundStorage | null,
  scope: ReaderBackgroundCacheScope | null,
) {
  if (!storage || !isCompleteCacheScope(scope)) return null;
  try {
    const value = storage.getItem(readerBackgroundCacheKey(scope));
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function writeCachedReaderBackground(
  storage: ReaderBackgroundStorage | null,
  scope: ReaderBackgroundCacheScope | null,
  background: "light" | "dark",
) {
  if (!storage || !isCompleteCacheScope(scope)) return;
  try {
    storage.setItem(readerBackgroundCacheKey(scope), background);
  } catch {
    // Storage is optional. The server position remains authoritative.
  }
}

export async function copyReaderSelection(
  text: string,
  writeText: (value: string) => Promise<void>,
) {
  try {
    await writeText(text);
    return COPY_SUCCESS_MESSAGE;
  } catch {
    return "复制失败，选区已保留，请重试。";
  }
}

export function copyStatusClearDelay(message: string) {
  return message === COPY_SUCCESS_MESSAGE ? COPY_SUCCESS_CLEAR_MS : null;
}

export function applyTextReaderMode(
  root: HTMLElement,
  mode: { background: "light" | "dark"; focusMode: boolean },
) {
  const shell = root.querySelector<HTMLElement>(".text-reader-shell");
  if (!shell) return;
  shell.classList.toggle("is-light", mode.background === "light");
  shell.classList.toggle("is-dark", mode.background === "dark");
  shell.classList.toggle("is-focus", mode.focusMode);
  shell.dataset.readerBackground = mode.background;
  root.querySelector<HTMLButtonElement>("button[data-reader-background]")
    ?.setAttribute("aria-pressed", String(mode.background === "dark"));
  const focus = root.querySelector<HTMLButtonElement>("[data-reader-focus]");
  focus?.setAttribute("aria-pressed", String(mode.focusMode));
  focus?.setAttribute("aria-label", mode.focusMode ? "退出专注阅读" : "进入专注阅读");
}

async function requestJson<T>(fetcher: typeof fetch, url: string, options?: RequestInit) {
  const response = await fetcher(url, options);
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code ?? "REQUEST_FAILED");
  return payload;
}

export function createTextReaderApi(bookId: string, fetcher: typeof fetch = fetch): TextReaderApi {
  const root = `/api/v1/books/${encodeURIComponent(bookId)}`;
  return {
    loadReading: () => requestJson(fetcher, `${root}/reading`),
    loadSections: () => requestJson(fetcher, `${root}/content/sections`),
    savePosition: (input) => requestJson(fetcher, `${root}/position`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  };
}

function selectedTextInside(root: HTMLElement) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  return selection && anchor && root.contains(anchor) ? selection.toString().trim() : "";
}

function firstLocator(model: ReturnType<typeof createTextReaderModel>): TextLocator | null {
  const reading = model.snapshot.reading;
  const first = model.snapshot.sections[0];
  if (!reading || !first) return null;
  return { kind: "text", fileVersion: reading.fileVersion, sectionId: first.sectionId, offset: 0 };
}

function activeSave(model: ReturnType<typeof createTextReaderModel>, locator?: TextLocator): PendingReaderSave | null {
  const position = model.snapshot.reading?.position;
  const nextLocator = locator ?? position?.locator ?? firstLocator(model);
  if (!nextLocator) return null;
  return { locator: nextLocator, background: model.snapshot.background };
}

function browserStorage(): ReaderBackgroundStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function mountTextReader(
  root: HTMLElement,
  options: {
    bookId: string;
    api?: TextReaderApi;
    cacheScope?: ReaderBackgroundCacheScope;
    storage?: ReaderBackgroundStorage | null;
    writeClipboard?: (value: string) => Promise<void>;
  },
) {
  const cacheScope = options.cacheScope?.bookId === options.bookId ? options.cacheScope : null;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const model = createTextReaderModel(
    options.bookId,
    options.api ?? createTextReaderApi(options.bookId),
    readCachedReaderBackground(storage, cacheScope) ?? "light",
  );
  let scrollTimer: number | undefined;
  let copyStatusTimer: number | undefined;
  let restoringPosition = false;
  let destroyed = false;

  const updateSelectionActions = () => {
    const hasSelection = Boolean(selectedTextInside(root));
    const button = root.querySelector<HTMLButtonElement>("[data-reader-copy]");
    if (button) button.disabled = !hasSelection;
    const chat = root.querySelector<HTMLAnchorElement>("[data-reader-chat]");
    if (chat) chat.hidden = !hasSelection;
  };

  const onSelectionChange = () => updateSelectionActions();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (model.snapshot.directoryOpen) {
      event.preventDefault();
      model.snapshot = { ...model.snapshot, directoryOpen: false, query: "" };
      render();
      root.querySelector<HTMLButtonElement>("[data-reader-directory]")?.focus({ preventScroll: true });
    } else if (model.snapshot.focusMode) {
      event.preventDefault();
      model.snapshot = { ...model.snapshot, focusMode: false };
      applyTextReaderMode(root, model.snapshot);
      root.querySelector<HTMLButtonElement>("[data-reader-focus]")?.focus({ preventScroll: true });
    }
  };
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", onKeyDown);

  function restorePosition() {
    const locator = model.snapshot.reading?.position?.locator ?? firstLocator(model);
    if (!locator) return;
    const section = root.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(locator.sectionId)}"]`);
    const paragraphs = [...(section?.querySelectorAll<HTMLElement>("[data-reader-paragraph]") ?? [])];
    const paragraphOffset = restoreParagraphOffset(
      paragraphs.map((paragraph) => ({ offset: Number(paragraph.dataset.offset) })),
      locator.offset,
    );
    const target = paragraphOffset === null
      ? section
      : paragraphs.find((paragraph) => Number(paragraph.dataset.offset) === paragraphOffset) ?? section;
    target?.scrollIntoView({ block: "start" });
  }

  function updateSaveStatus() {
    const status = root.querySelector<HTMLElement>(".text-reader-save-status");
    if (!status) return;
    status.classList.toggle("is-error", Boolean(model.snapshot.saveError));
    status.innerHTML = model.snapshot.saveError
      ? `${model.snapshot.saveError} <button type="button" data-reader-retry-save>重试保存</button>`
      : "阅读位置已保存";
    status.querySelector<HTMLButtonElement>("[data-reader-retry-save]")?.addEventListener("click", () => {
      void model.retrySave().then(updateSaveStatus).catch(updateSaveStatus);
    });
  }

  function save(input: PendingReaderSave) {
    void model.save(input).then(() => {
      const trustedScope = cacheScope?.fileVersion === input.locator.fileVersion ? cacheScope : null;
      writeCachedReaderBackground(storage, trustedScope, input.background);
      updateSaveStatus();
    }).catch(updateSaveStatus);
  }

  function setCopyStatus(message: string) {
    if (destroyed) return;
    if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
    copyStatusTimer = undefined;
    const status = root.querySelector<HTMLElement>(".text-reader-copy-status");
    if (status) status.textContent = message;
    const clearDelay = copyStatusClearDelay(message);
    if (clearDelay !== null) {
      copyStatusTimer = window.setTimeout(() => {
        const current = root.querySelector<HTMLElement>(".text-reader-copy-status");
        if (current?.textContent === message) current.textContent = "";
        copyStatusTimer = undefined;
      }, clearDelay);
    }
  }

  function visibleLocator() {
    const reading = model.snapshot.reading;
    const paragraphs = [...root.querySelectorAll<HTMLElement>("[data-reader-paragraph]")];
    const paragraph = paragraphs.find((candidate) => candidate.getBoundingClientRect().bottom > 116);
    const sectionId = paragraph?.dataset.sectionId;
    const offset = Number(paragraph?.dataset.offset ?? 0);
    if (!reading || !sectionId || !Number.isInteger(offset)) return null;
    return { kind: "text" as const, fileVersion: reading.fileVersion, sectionId, offset };
  }

  function bindInteractions() {
    root.querySelector<HTMLButtonElement>("[data-reader-directory]")?.addEventListener("click", () => {
      model.snapshot = { ...model.snapshot, directoryOpen: true, query: "" };
      render();
      requestAnimationFrame(() => {
        root.querySelector<HTMLInputElement>("#text-reader-directory-query")?.focus({ preventScroll: true });
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-reader-directory-close]").forEach((button) => {
      button.addEventListener("click", () => {
        model.snapshot = { ...model.snapshot, directoryOpen: false, query: "" };
        render();
        requestAnimationFrame(() => {
          root.querySelector<HTMLButtonElement>("[data-reader-directory]")?.focus({ preventScroll: true });
        });
      });
    });
    root.querySelector<HTMLInputElement>("#text-reader-directory-query")?.addEventListener("input", (event) => {
      model.snapshot = { ...model.snapshot, query: (event.currentTarget as HTMLInputElement).value };
      render();
      const query = root.querySelector<HTMLInputElement>("#text-reader-directory-query");
      query?.focus();
      query?.setSelectionRange(query.value.length, query.value.length);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-reader-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        const reading = model.snapshot.reading;
        const sectionId = button.dataset.readerJump;
        if (!reading || !sectionId) return;
        const locator = { kind: "text" as const, fileVersion: reading.fileVersion, sectionId, offset: 0 };
        const pending = activeSave(model, locator);
        model.snapshot = { ...model.snapshot, directoryOpen: false, query: "" };
        if (pending) save(pending);
        render();
        requestAnimationFrame(() => {
          root.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"]`)?.scrollIntoView({ block: "start" });
          root.querySelector<HTMLButtonElement>("[data-reader-directory]")?.focus({ preventScroll: true });
        });
      });
    });
    root.querySelector<HTMLButtonElement>("button[data-reader-background]")?.addEventListener("click", () => {
      const pending = activeSave(model);
      if (!pending) return;
      pending.background = pending.background === "dark" ? "light" : "dark";
      save(pending);
      applyTextReaderMode(root, model.snapshot);
    });
    root.querySelector<HTMLButtonElement>("[data-reader-focus]")?.addEventListener("click", () => {
      model.snapshot = { ...model.snapshot, focusMode: !model.snapshot.focusMode };
      applyTextReaderMode(root, model.snapshot);
    });
    root.querySelector<HTMLButtonElement>("[data-reader-copy]")?.addEventListener("click", () => {
      const text = selectedTextInside(root);
      if (!text) return;
      const writeClipboard = options.writeClipboard ?? ((value: string) => navigator.clipboard.writeText(value));
      void copyReaderSelection(text, writeClipboard).then(setCopyStatus);
    });
    root.querySelector<HTMLButtonElement>("[data-reader-reload]")?.addEventListener("click", () => {
      void load();
    });
    root.querySelector<HTMLButtonElement>("[data-reader-retry-save]")?.addEventListener("click", () => {
      void model.retrySave().then(updateSaveStatus).catch(updateSaveStatus);
    });
    root.querySelector<HTMLElement>(".text-reader-main")?.addEventListener("scroll", () => {
      if (scrollTimer) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        const locator = visibleLocator();
        if (!shouldPersistReaderScroll({ restoringPosition, hasVisibleLocator: Boolean(locator) })) return;
        const pending = locator ? activeSave(model, locator) : null;
        if (pending) save(pending);
      }, READER_SCROLL_SAVE_DELAY_MS);
    }, { passive: true });
  }

  function render(options: { restore?: boolean } = {}) {
    if (destroyed) return;
    const previousMain = root.querySelector<HTMLElement>(".text-reader-main");
    const previousScrollTop = previousMain?.scrollTop;
    const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
      ? document.activeElement
      : null;
    const focusSelector = active?.hasAttribute("data-reader-background")
      ? "button[data-reader-background]"
      : active?.hasAttribute("data-reader-focus")
        ? "[data-reader-focus]"
        : active?.hasAttribute("data-reader-directory")
          ? "[data-reader-directory]"
          : active?.hasAttribute("data-reader-copy")
            ? "[data-reader-copy]"
            : active?.classList.contains("text-reader-main")
              ? ".text-reader-main"
              : null;
    root.innerHTML = renderTextReader(model.snapshot);
    bindInteractions();
    updateSelectionActions();
    if (options.restore) {
      restoringPosition = true;
      requestAnimationFrame(() => {
        restorePosition();
        window.setTimeout(() => {
          restoringPosition = false;
        }, READER_RESTORE_GUARD_MS);
      });
    } else if (previousScrollTop !== undefined) {
      root.querySelector<HTMLElement>(".text-reader-main")?.scrollTo({ top: previousScrollTop });
      if (focusSelector) {
        requestAnimationFrame(() => {
          root.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
        });
      }
    }
  }

  async function load() {
    render();
    try {
      await model.load();
      const trustedScope = cacheScope?.fileVersion === model.snapshot.reading?.fileVersion ? cacheScope : null;
      writeCachedReaderBackground(storage, trustedScope, model.snapshot.background);
    } catch {
      // The model provides the actionable retained failure state.
    }
    render({ restore: !model.snapshot.error });
  }

  void load();
  return {
    model,
    destroy() {
      destroyed = true;
      if (scrollTimer) window.clearTimeout(scrollTimer);
      if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
