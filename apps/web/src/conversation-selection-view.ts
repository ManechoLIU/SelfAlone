import "./conversation-selection.css";
import { escapeHtml } from "./ui/desktop-shell";
import type { ConversationSelectionController } from "./conversation-selection-controller";
import {
  selectionDraftFor,
  type ConversationSelectionQuestion,
  type ConversationSelectionState,
} from "./conversation-selection-state";

export type ConversationSelectionViewOptions = {
  state: ConversationSelectionState;
};

export type ConversationSelectionViewResult = {
  main: string;
};

export function renderConversationSelectionView(
  options: ConversationSelectionViewOptions,
): ConversationSelectionViewResult {
  const { state } = options;
  const error = state.status === "error"
    ? `<p class="conversation-selection-error" role="alert">选择保存失败，当前输入仍保留，请重试</p>`
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
) {
  let disposed = false;
  let renderedState: ConversationSelectionState | null = null;

  const render = (nextState: ConversationSelectionState = controller.getState()) => {
    if (disposed) return;
    if (renderedState && isDraftOnlyChange(renderedState, nextState)) {
      patchDraftControls(root, nextState);
      renderedState = nextState;
      return;
    }

    root.innerHTML = renderConversationSelectionView({ state: nextState }).main;
    renderedState = nextState;
    bindSelectionControls(root, controller);
  };

  const unsubscribe = controller.subscribe(render);
  render(controller.getState());
  void controller.hydrate();

  return () => {
    disposed = true;
    unsubscribe();
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
  return `<article class="conversation-selection-question ${readonly ? "is-readonly" : "is-pending"}" data-selection-question="${escapeHtml(question.id)}" data-selection-status="${question.status}">
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
    : `<button class="conversation-selection-confirm" type="button" data-selection-confirm="${escapeHtml(question.id)}"${saving ? " disabled" : ""}>确认选择</button>`;
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
  return `<div class="conversation-selection-readonly" role="status">
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
}
