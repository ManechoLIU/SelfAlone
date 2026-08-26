import "./conversation-selection.css";
import { escapeHtml } from "./ui/desktop-shell";
import type { ConversationSelectionController } from "./conversation-selection-controller";
import {
  selectionDraftFor,
  selectionQuestionsForMessage,
  type ConversationSelectionQuestion,
  type ConversationSelectionState,
} from "./conversation-selection-state";

export type ConversationSelectionViewOptions = {
  state: ConversationSelectionState;
};

export type ConversationSelectionViewResult = {
  main: string;
};

export type ConversationSelectionMountOptions = {
  /** Restrict this mounted view to questions attached to one assistant message. */
  assistantMessageId?: string;
  /** Skip hydration when the parent chat mount already owns the one hydrate call. */
  hydrate?: boolean;
};

type ConversationSelectionViewState = ConversationSelectionState & {
  recoveryQuestionId?: string;
};

export function renderConversationSelectionView(
  options: ConversationSelectionViewOptions,
): ConversationSelectionViewResult {
  const { state } = options;
  const recoveryQuestionId = (state as ConversationSelectionViewState).recoveryQuestionId;
  const error = state.status === "error"
    ? recoveryQuestionId
      ? `<div class="conversation-selection-recovery" role="alert">
          <p class="conversation-selection-error">这次保存结果尚未确认，当前输入仍保留</p>
          <button class="conversation-selection-retry" type="button" data-selection-retry="${escapeHtml(recoveryQuestionId)}" aria-label="重试保存当前选择">重试保存</button>
        </div>`
      : `<p class="conversation-selection-error" role="alert">选择保存失败，当前输入仍保留，请重试</p>`
    : "";
  const status = state.status === "loading"
    ? `<p class="conversation-selection-status" role="status">正在恢复选择…</p>`
    : state.status === "saving"
      ? `<p class="conversation-selection-status" role="status">正在保存选择…</p>`
      : "";

  return {
    main: `<section class="conversation-selection" data-conversation-selection="${escapeHtml(state.conversationId)}" aria-busy="${state.status === "loading" || state.status === "saving" ? "true" : "false"}">
      ${state.questions.map((question) => renderQuestion(question, state)).join("")}
      ${status}
      ${error}
    </section>`,
  };
}

export function mountConversationSelectionView(
  root: HTMLElement,
  controller: ConversationSelectionController,
  options: ConversationSelectionMountOptions = {},
) {
  let disposed = false;
  let renderedState: ConversationSelectionState | null = null;

  const render = (nextState: ConversationSelectionState = controller.getState()) => {
    if (disposed) return;
    const scopedState = options.assistantMessageId
      ? selectionStateForMessage(nextState, options.assistantMessageId)
      : nextState;
    if (renderedState && isDraftOnlyChange(renderedState, scopedState)) {
      patchDraftControls(root, scopedState);
      renderedState = scopedState;
      return;
    }

    const focusTarget = captureFocus(root);
    root.innerHTML = renderConversationSelectionView({ state: scopedState }).main;
    renderedState = scopedState;
    bindSelectionControls(root, controller);
    restoreFocus(root, focusTarget);
  };

  const unsubscribe = controller.subscribe(render);
  render(controller.getState());
  if (options.hydrate !== false) void controller.hydrate();

  return () => {
    disposed = true;
    unsubscribe();
  };
}

export function selectionStateForMessage(
  state: ConversationSelectionState,
  assistantMessageId: string,
): ConversationSelectionState {
  const questions = selectionQuestionsForMessage(state, assistantMessageId);
  const questionIds = new Set(questions.map((question) => question.id));
  const drafts = Object.fromEntries(
    Object.entries(state.drafts).filter(([questionId]) => questionIds.has(questionId)),
  );
  const recoveryQuestionId = (state as ConversationSelectionViewState).recoveryQuestionId;
  return {
    ...state,
    questions,
    activeQuestionId: questions.some((question) => question.id === state.activeQuestionId)
      ? state.activeQuestionId
      : questions.find((question) => question.status === "pending")?.id ?? null,
    drafts,
    ...(recoveryQuestionId && questionIds.has(recoveryQuestionId) ? { recoveryQuestionId } : {}),
  };
}

function renderQuestion(
  question: ConversationSelectionQuestion,
  state: ConversationSelectionState,
) {
  const draft = selectionDraftFor(state, question.id);
  const readonly = question.status !== "pending";
  const body = readonly
    ? renderReadonlyQuestion(question)
    : renderPendingQuestion(question, draft, state.status === "saving");
  return `<article class="conversation-selection-question ${readonly ? "is-readonly" : "is-pending"}" data-selection-question="${escapeHtml(question.id)}" data-selection-status="${question.status}" tabindex="-1">
    <p class="conversation-selection-prompt">${escapeHtml(question.prompt)}</p>
    ${body}
  </article>`;
}

function renderPendingQuestion(
  question: ConversationSelectionQuestion,
  draft: { values: readonly string[]; freeText: string },
  saving: boolean,
) {
  const controls = question.mode === "free"
    ? `<label class="conversation-selection-free-label" for="conversation-selection-free-${escapeHtml(question.id)}">
        <span class="visually-hidden">补充回答</span>
        <textarea id="conversation-selection-free-${escapeHtml(question.id)}" class="conversation-selection-free-input" data-selection-free-input="${escapeHtml(question.id)}" rows="3" maxlength="2000"${saving ? " readonly aria-disabled=\"true\"" : ""}>${escapeHtml(draft.freeText)}</textarea>
      </label>`
    : `<div class="conversation-selection-options" role="group" aria-label="可选答案">
        ${question.options.map((option) => {
          const selected = draft.values.includes(option.value);
          return `<button class="conversation-selection-option${selected ? " is-selected" : ""}" type="button" data-selection-option="${escapeHtml(option.value)}" data-selection-question-id="${escapeHtml(question.id)}" aria-pressed="${selected ? "true" : "false"}"${saving ? " disabled" : ""}>
            <span class="conversation-selection-option-mark" aria-hidden="true">${selected ? checkIcon() : ""}</span>
            <span>${escapeHtml(option.label)}</span>
          </button>`;
        }).join("")}
      </div>`;
  const confirm = question.mode === "single" && !question.requiresConfirmation
    ? ""
    : `<button class="conversation-selection-confirm" type="button" data-selection-confirm="${escapeHtml(question.id)}" aria-label="确认当前选择"${saving || !isValidConfirmationDraft(question, draft) ? " disabled" : ""}>确认选择</button>`;
  return `<div class="conversation-selection-pending" data-selection-pending="${escapeHtml(question.id)}">
    ${controls}
    ${confirm}
  </div>`;
}

function renderReadonlyQuestion(question: ConversationSelectionQuestion) {
  const selected = question.mode === "free"
    ? question.freeText ?? ""
    : question.selectedValues
      .map((value) => question.options.find((option) => option.value === value)?.label ?? value)
      .join("、");
  const status = question.status === "stale" ? "已失效，当前问题不可再提交" : "已确认";
  return `<div class="conversation-selection-readonly" role="status" tabindex="-1">
    <span class="conversation-selection-readonly-label">${escapeHtml(status)}</span>
    <span class="conversation-selection-readonly-value">已选择：${escapeHtml(selected || "未填写")}</span>
  </div>`;
}

function checkIcon() {
  return `<svg viewBox="0 0 16 16" focusable="false"><path d="m3.25 8.25 3 3 6.5-6.5" /></svg>`;
}

function bindSelectionControls(root: HTMLElement, controller: ConversationSelectionController) {
  root.querySelectorAll<HTMLButtonElement>("[data-selection-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const questionId = button.dataset.selectionQuestionId;
      const value = button.dataset.selectionOption;
      if (questionId && value) void controller.selectOption(questionId, value);
    });
  });
  root.querySelectorAll<HTMLTextAreaElement>("[data-selection-free-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const questionId = input.dataset.selectionFreeInput;
      if (questionId) controller.setFreeText(questionId, input.value);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-selection-confirm]").forEach((button) => {
    button.addEventListener("click", () => {
      const questionId = button.dataset.selectionConfirm;
      if (questionId) void controller.confirm(questionId);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-selection-retry]").forEach((button) => {
    button.addEventListener("click", () => {
      const questionId = button.dataset.selectionRetry;
      if (questionId) void controller.retry(questionId);
    });
  });
}

function isDraftOnlyChange(previous: ConversationSelectionState, next: ConversationSelectionState) {
  return previous.conversationId === next.conversationId
    && previous.questions === next.questions
    && previous.activeQuestionId === next.activeQuestionId
    && previous.status === next.status
    && previous.errorCode === next.errorCode
    && previous.drafts !== next.drafts;
}

function patchDraftControls(root: HTMLElement, state: ConversationSelectionState) {
  root.querySelectorAll<HTMLButtonElement>("[data-selection-option]").forEach((button) => {
    const questionId = button.dataset.selectionQuestionId;
    const value = button.dataset.selectionOption;
    if (!questionId || !value) return;
    const selected = selectionDraftFor(state, questionId).values.includes(value);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const mark = button.querySelector<HTMLElement>(".conversation-selection-option-mark");
    if (mark) mark.innerHTML = selected ? checkIcon() : "";
  });
  root.querySelectorAll<HTMLTextAreaElement>("[data-selection-free-input]").forEach((input) => {
    const questionId = input.dataset.selectionFreeInput;
    if (questionId && input.value !== selectionDraftFor(state, questionId).freeText) {
      input.value = selectionDraftFor(state, questionId).freeText;
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-selection-confirm]").forEach((button) => {
    const questionId = button.dataset.selectionConfirm;
    if (!questionId) return;
    const question = state.questions.find((candidate) => candidate.id === questionId);
    if (!question) return;
    const valid = isValidConfirmationDraft(question, selectionDraftFor(state, questionId));
    button.disabled = state.status === "saving" || !valid;
  });
}

function isValidConfirmationDraft(
  question: ConversationSelectionQuestion,
  draft: { values: readonly string[]; freeText: string },
) {
  if (question.mode === "free") return draft.freeText.trim().length > 0;
  if (question.mode === "multi") return draft.values.length > 0;
  return draft.values.length === 1;
}

type FocusTarget = {
  kind: "free" | "confirm" | "retry" | "option" | "question";
  questionId: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
} | null;

function captureFocus(root: HTMLElement): FocusTarget {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const freeQuestionId = active.getAttribute("data-selection-free-input");
  if (freeQuestionId) {
    const input = active as HTMLTextAreaElement;
    return {
      kind: "free",
      questionId: freeQuestionId,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    };
  }
  const confirmQuestionId = active.getAttribute("data-selection-confirm");
  if (confirmQuestionId) return { kind: "confirm", questionId: confirmQuestionId };
  const retryQuestionId = active.getAttribute("data-selection-retry");
  if (retryQuestionId) return { kind: "retry", questionId: retryQuestionId };
  const optionQuestionId = active.getAttribute("data-selection-question-id");
  if (optionQuestionId && active.hasAttribute("data-selection-option")) {
    return { kind: "option", questionId: optionQuestionId };
  }
  const question = active.closest<HTMLElement>("[data-selection-question]");
  const questionId = question?.getAttribute("data-selection-question");
  if (questionId) return { kind: "question", questionId };
  return null;
}

function restoreFocus(root: HTMLElement, target: FocusTarget) {
  if (!target) return;
  const questionId = cssEscape(target.questionId);
  const questionSelector = `[data-selection-question="${questionId}"]`;
  const selector = target.kind === "free"
    ? `[data-selection-free-input="${questionId}"]`
    : target.kind === "confirm"
      ? `[data-selection-confirm="${questionId}"]`
      : target.kind === "retry"
        ? `[data-selection-retry="${questionId}"]`
        : target.kind === "option"
          ? `[data-selection-option][data-selection-question-id="${questionId}"]`
          : questionSelector;
  const element = target.kind === "question"
    ? findFocusable(root, [`${questionSelector} .conversation-selection-readonly`, selector])
    : findFocusable(root, [selector]);
  if (!element) {
    if (target.kind !== "option" && target.kind !== "question" && target.kind !== "confirm") return;
    const fallbackSelectors = [
      `${questionSelector} .conversation-selection-readonly`,
      questionSelector,
    ];
    if (target.kind === "option" || target.kind === "question") {
      fallbackSelectors.push(
        "[data-selection-option]",
        "[data-selection-free-input]",
        "[data-selection-confirm]",
        "[data-selection-retry]",
      );
    }
    findFocusable(root, fallbackSelectors)?.focus();
    return;
  }
  element.focus();
  if (element instanceof HTMLTextAreaElement && target.selectionStart !== undefined && target.selectionEnd !== undefined) {
    element.setSelectionRange(target.selectionStart ?? element.value.length, target.selectionEnd ?? element.value.length);
  }
}

function findFocusable(root: HTMLElement, selectors: readonly string[]) {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (element instanceof HTMLButtonElement && element.disabled) continue;
      return element;
    }
  }
  return null;
}

function cssEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
