import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversationChatState, updateConversationDraft } from "./conversation-chat-state";
import { createConversationChatController } from "./conversation-chat-controller";
import { mountConversationChatView, renderConversationChatView } from "./conversation-chat-view";
import { createPptRequirementsWorkspaceStore } from "./ppt-requirements-workspace-state";
import { createPptOutlineWorkspaceStore } from "./ppt-outline-workspace-state";
import type { PptOutlineParagraph, PptOutlineSnapshot } from "./ppt-outline-workspace-client";

const conversationChatCss = readFileSync(new URL("./conversation-chat.css", import.meta.url), "utf8");
const requirementsCss = readFileSync(new URL("./ppt-requirements-workspace.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

class FakeTextArea {
  value = "";
  private readonly listeners = new Map<string, Array<(event: { target: FakeTextArea }) => void>>();

  addEventListener(type: string, listener: (event: { target: FakeTextArea }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchInput() {
    for (const listener of [...(this.listeners.get("input") ?? [])]) {
      listener({ target: this });
    }
  }
}

class FakeForm {
  addEventListener() {
    // The input regression only needs the form to be discoverable.
  }
}

class FakeButton {
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchClick() {
    for (const listener of [...(this.listeners.get("click") ?? [])]) listener();
  }
}

class FakeNoticeRegion {
  retry = new FakeButton();
  patchCount = 0;
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.patchCount += 1;
  }

  get innerHTML() {
    return this.markup;
  }

  querySelector<T>(selector: string) {
    if (selector.includes("ppt-workspace-retry") && this.markup.includes("data-ppt-workspace-retry")) return this.retry as T;
    return null;
  }
}

class FakeMainRoot {
  input = new FakeTextArea();
  form = new FakeForm();
  notice = new FakeNoticeRegion();
  renderCount = 0;
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.renderCount += 1;
  }

  get innerHTML() {
    return this.markup;
  }

  querySelector<T>(selector: string) {
    if (selector.includes("conversation-chat-form")) return this.form as T;
    if (selector.includes("conversation-chat-input")) return this.input as T;
    if (selector.includes("ppt-workspace-notice")) return this.notice as T;
    return null;
  }
}

class FakeTaskRoot {
  innerHTML = "";

  closest() {
    return null;
  }
}

describe("conversation chat view", () => {
  it("renders a state-driven conversation with one controlled composer", () => {
    const state = updateConversationDraft(createConversationChatState("conversation-a"), "当前输入");
    const rendered = renderConversationChatView({ state, title: "今天的对话" });

    expect(rendered.main).toContain('data-conversation-chat="conversation-a"');
    expect(rendered.main).not.toContain('class="conversation-chat-header"');
    expect(rendered.main).toContain('data-conversation-chat-input');
    expect(rendered.main).toContain('name="message"');
    expect(rendered.main).toContain('value="当前输入"');
    expect(rendered.main.match(/data-conversation-chat-input/g)).toHaveLength(1);
    expect(rendered.main).toContain("还没有消息");
    expect(rendered.main).not.toContain("本地演示");
    expect(rendered.main).not.toContain("免费额度");
    expect(rendered.taskPanel).toBe("");
  });

  it("renders server messages, pending state, and retained error copy without examples", () => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "失败后保留",
      status: "error" as const,
      errorCode: "CONVERSATION_REPLY_FAILED",
      messages: [
        { id: "user-1", role: "user" as const, text: "来自真实状态的提问" },
        { id: "assistant-1", role: "assistant" as const, text: "来自确定性运行时的回复" },
      ],
    };
    const rendered = renderConversationChatView({ state, title: "当前会话" });

    expect(rendered.main).toContain("来自真实状态的提问");
    expect(rendered.main).toContain("来自确定性运行时的回复");
    expect(rendered.main).toContain("发送失败，输入仍保留");
    expect(rendered.main).not.toContain("CONVERSATION_REPLY_FAILED");
    expect(rendered.main).toContain('value="失败后保留"');
    expect(rendered.taskPanel).toBe("");
    expect(rendered.main).not.toContain("示例");
  });

  it.each(["PLATFORM_CONFIGURATION_REQUIRED", "PLATFORM_EXHAUSTION"])(
    "guides platform error %s back to text-model configuration without losing its draft",
    (errorCode) => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "请保留这段输入",
      status: "error" as const,
      errorCode,
      messages: [{ id: "user-1", role: "user" as const, text: "当前会话上下文" }],
    };

    const rendered = renderConversationChatView({ state });

    expect(rendered.main).toContain("配置自己的 AI 模型后继续");
    expect(rendered.main).toContain('href="#/settings/text-model?return=%23%2Fconversation"');
    expect(rendered.main).toContain(">配置 AI 模型</a>");
    expect(rendered.main).toContain('value="请保留这段输入"');
    expect(rendered.main).toContain("当前会话上下文");
    },
  );

  it("uses the complete conversation handoff hash in its text-model configuration link", () => {
    const state = {
      ...createConversationChatState("conversation-a"),
      draft: "保留阶段草稿",
      status: "error" as const,
      errorCode: "PLATFORM_CONFIGURATION_REQUIRED",
    };

    const rendered = renderConversationChatView({
      state,
      settingsReturnTo: "#/conversation?stage=outline&book=book-a",
    });

    expect(rendered.main).toContain(
      'href="#/settings/text-model?return=%23%2Fconversation%3Fstage%3Doutline%26book%3Dbook-a"',
    );
  });

  it("keeps platform unavailability in place with a retry prompt and no pricing copy", () => {
      const state = {
        ...createConversationChatState("conversation-a"),
        draft: "请稍后继续",
        status: "error" as const,
        errorCode: "PLATFORM_UNAVAILABLE",
      };

      const rendered = renderConversationChatView({ state });

      expect(rendered.main).toContain("当前会话和输入已保留，请稍后重试");
      expect(rendered.main).toContain('value="请稍后继续"');
      expect(rendered.main).not.toContain("余额");
      expect(rendered.main).not.toContain("金额");
      expect(rendered.main).not.toContain("价格");
  });

  it("uses fixed understandable copy for initial load failures", () => {
    expect(mainSource).toContain("老己服务暂时无法连接，当前会话和输入已保留，请稍后重试。");
    expect(mainSource).not.toContain("conversationChatError = error instanceof Error ? error.message : \"CONVERSATION_REQUEST_FAILED\"");
  });

  it("removes the task workspace track from normal conversation chat", () => {
    expect(mainSource).toContain('<div class="desktop-app-shell" data-active-section="conversation" style="--desktop-task-width: 0px;">');
  });

  it("uses the account-scoped requirements save and outline recovery path after create/reuse", () => {
    expect(mainSource).toContain("pptWorkspaceClient.createOrReuse");
    expect(mainSource).not.toContain("pptWorkspaceClient.getWorkspace");
    expect(mainSource).toContain("pptWorkspaceClient.saveRequirements");
    expect(mainSource).toContain("pptOutlineClient?.getOutline");
  });

  it("does not rebuild the composer DOM for consecutive input events", () => {
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({
          id: "conversation-a",
          revision: 1,
          draft: null,
          context: [],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        }),
        sendText: async () => {
          throw new Error("not used");
        },
      },
    });
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeTaskRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
    );
    const initialRenderCount = mainRoot.renderCount;
    const input = mainRoot.input;

    input.value = "连";
    input.dispatchInput();
    input.value = "连续";
    input.dispatchInput();

    expect(controller.getState().draft).toBe("连续");
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(input);
    dispose();
  });

  it("retries the failed workspace with the stored request context without resending its message", () => {
    const context = { conversationId: "conversation-a", requestId: "request-workspace-1", bookId: "book-1" };
    const workspaceStore = createPptRequirementsWorkspaceStore();
    workspaceStore.begin(context);
    workspaceStore.fail(context, new Error("workspace offline"));
    const retries: Array<typeof context> = [];
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({ id: "conversation-a", revision: 1, draft: null, context: [], activeRun: null, tasks: [], works: [], deleted: false }),
        sendText: async () => { throw new Error("not used"); },
      },
    });
    const mainRoot = new FakeMainRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      new FakeTaskRoot() as unknown as HTMLElement,
      controller,
      { workspaceStore, onWorkspaceRetry: (retryContext) => retries.push(retryContext) },
    );
    mainRoot.notice.retry.dispatchClick();

    expect(retries).toEqual([context]);
    dispose();
  });

  it("establishes a definite chat height chain so the stream scrolls and the composer stays pinned", () => {
    expect(mainSource).toContain('class="desktop-conversation-scroll desktop-conversation-scroll-chat"');
    expect(mainSource).toMatch(/id=\\?"conversation-chat-main-mount\\?" class=\\?"conversation-chat-mount\\?"/);
    expect(requirementsCss).toMatch(/\.desktop-conversation-scroll-chat\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
    expect(requirementsCss).toMatch(/\.desktop-conversation-scroll-chat\s*>\s*\[data-conversation-quota-host\]\s*\{[^}]*flex:\s*none/s);
    expect(requirementsCss).toMatch(/\.conversation-chat-mount\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-height:\s*0/s);
    expect(requirementsCss).toMatch(/\.conversation-chat-mount\s*>\s*\.conversation-chat-view\s*\{[^}]*height:\s*100%[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s+auto/s);
    expect(conversationChatCss).toMatch(/\.conversation-chat-scroll\s*\{[^}]*overflow:\s*auto/s);
  });

  it("keeps the workspace notice in a stable region between the stream and the composer", () => {
    const rendered = renderConversationChatView({
      state: createConversationChatState("conversation-a"),
      workspaceState: {
        phase: "error",
        context: { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" },
        error: new Error("offline"),
      },
    });

    const scrollIndex = rendered.main.indexOf('class="conversation-chat-scroll"');
    const noticeIndex = rendered.main.indexOf("data-ppt-workspace-notice");
    const composerIndex = rendered.main.indexOf('class="conversation-chat-composer"');
    expect(noticeIndex).toBeGreaterThan(scrollIndex);
    expect(composerIndex).toBeGreaterThan(noticeIndex);
    const scrollBlock = rendered.main.slice(scrollIndex, noticeIndex);
    expect(scrollBlock).not.toContain("ppt-requirements-notice");
    const noticeRegion = rendered.main.slice(noticeIndex, composerIndex);
    expect(noticeRegion).toContain("PPT 工作区暂时无法准备");
    expect(noticeRegion).toContain("data-ppt-workspace-retry");
  });

  it("patches only the workspace regions on workspace transitions, preserving composer focus and draft", () => {
    const context = { conversationId: "conversation-a", requestId: "request-focus-1", bookId: "book-1" };
    const workspaceStore = createPptRequirementsWorkspaceStore();
    const controller = createConversationChatController({
      conversationId: "conversation-a",
      client: {
        getSession: async () => ({ id: "conversation-a", revision: 1, draft: null, context: [], activeRun: null, tasks: [], works: [], deleted: false }),
        sendText: async () => { throw new Error("not used"); },
      },
    });
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeTaskRoot();

    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
      { workspaceStore },
    );
    const initialRenderCount = mainRoot.renderCount;
    const composerInput = mainRoot.input;
    composerInput.value = "正在输入的草稿";
    composerInput.dispatchInput();

    workspaceStore.begin(context);
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(composerInput);
    expect(mainRoot.notice.innerHTML).toContain("正在准备这本书的 PPT 范围与需求");
    expect(taskRoot.innerHTML).toBe("");

    workspaceStore.ready(context, {
      status: "created",
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });
    expect(mainRoot.renderCount).toBe(initialRenderCount);
    expect(mainRoot.input).toBe(composerInput);
    expect(controller.getState().draft).toBe("正在输入的草稿");
    expect(taskRoot.innerHTML).toContain("范围与需求");
    expect(taskRoot.innerHTML).toContain("desktop-stage-steps");
    dispose();
  });

  it("marks the send control unavailable while sending and keeps keyboard semantics explicit", () => {
    const state = { ...createConversationChatState("conversation-a"), status: "sending" as const, draft: "发送中" };
    const rendered = renderConversationChatView({ state });

    expect(rendered.main).toContain('aria-busy="true"');
    expect(rendered.main).toContain('data-conversation-chat-send');
    expect(rendered.main).toMatch(/data-conversation-chat-send[^>]*disabled/);
    expect(rendered.main).toMatch(/data-conversation-chat-input[^>]*readonly/);
    expect(rendered.main).toContain("Enter 发送，Shift+Enter 换行");
  });

  it("keeps the responsive and reduced-motion contract scoped to the private slice", () => {
    expect(conversationChatCss).toContain("@media (max-width: 1279px)");
    expect(conversationChatCss).toContain("@media (max-width: 1024px)");
    expect(conversationChatCss).toContain("@media (max-width: 768px)");
    expect(conversationChatCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(conversationChatCss).toContain("overflow-wrap: anywhere");
    expect(conversationChatCss).toContain("focus-visible");
    expect(conversationChatCss).not.toContain("background-image: url(");
  });
});

// ---------- Outline editor mount fakes (structural sync regressions) ----------

type ParsedOutlineRow = { id: string; level: string; text: string; orphan: boolean };

function unescapeHtmlText(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&");
}

function parseOutlineRows(markup: string): ParsedOutlineRow[] {
  const rows: ParsedOutlineRow[] = [];
  const rowPattern = /<div class="ppt-outline-paragraph" data-level="(\d)" data-paragraph-id="([^"]+)">([\s\S]*?)(?=<div class="ppt-outline-paragraph"|$)/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(markup)) !== null) {
    const [, level, id, segment] = match;
    const textMatch = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(segment);
    rows.push({
      id,
      level,
      text: unescapeHtmlText(textMatch?.[1] ?? ""),
      orphan: segment.includes(`data-ppt-outline-orphan="${id}"`),
    });
  }
  return rows;
}

class FakeOutlineTextarea {
  selectionStart = 0;
  selectionEnd = 0;
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(public value: string, readonly row: FakeOutlineRow) {}

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  closest(selector: string) {
    if (selector.includes("data-ppt-outline-text")) return this;
    if (selector.includes("data-paragraph-id")) return this.row;
    return null;
  }

  focus() {
    this.row.editor.host.focused = this;
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  dispatchInput() {
    this.emit("input", { type: "input", target: this });
  }

  dispatchKeydown(key: string, options: { shiftKey?: boolean } = {}) {
    const event = {
      type: "keydown",
      key,
      shiftKey: options.shiftKey ?? false,
      target: this as unknown,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    this.emit("keydown", event);
    return event;
  }

  private emit(type: string, event: object) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    this.row.editor.dispatchFromChild(type, event);
  }
}

class FakeOutlineRow {
  readonly dataset: { paragraphId: string; level: string };
  readonly textarea: FakeOutlineTextarea;
  readonly orphan: boolean;

  constructor(readonly editor: FakeOutlineEditor, parsed: ParsedOutlineRow) {
    this.dataset = { paragraphId: parsed.id, level: parsed.level };
    this.orphan = parsed.orphan;
    this.textarea = new FakeOutlineTextarea(parsed.text, this);
  }

  get id() {
    return this.dataset.paragraphId;
  }

  querySelector(selector: string) {
    if (selector.includes("data-ppt-outline-text")) return this.textarea;
    if (selector.includes("data-ppt-outline-orphan")) return this.orphan ? { id: this.id } : null;
    return null;
  }
}

class FakeOutlineEditor {
  rows: FakeOutlineRow[] = [];
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(readonly host: FakeOutlineTaskRoot, markup: string) {
    this.setRows(markup);
  }

  set innerHTML(markup: string) {
    this.setRows(markup);
    this.host.editorRebuilds += 1;
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchFromChild(type: string, event: object) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  querySelectorAll(selector: string): unknown[] {
    if (selector.includes("data-paragraph-id")) return this.rows;
    if (selector.includes("data-ppt-outline-text")) return this.rows.map((row) => row.textarea);
    return [];
  }

  private setRows(markup: string) {
    this.rows = parseOutlineRows(markup).map((parsed) => new FakeOutlineRow(this, parsed));
  }
}

class FakeOutlineButton {
  disabled = false;
  textContent: string;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly host: FakeOutlineTaskRoot, label: string) {
    this.textContent = label;
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of [...(this.listeners.get("click") ?? [])]) listener();
  }

  focus() {
    this.host.focused = this;
  }

  setAttribute() {}
  removeAttribute() {}
}

class FakeRequirementsForm {
  readonly submitButton: FakeOutlineButton;
  readonly preset = { value: "8-10", addEventListener() {} };
  private readonly fieldValues: Record<string, string> = {
    purpose: "分享",
    audience: "同事",
    pageMin: "8",
    pageMax: "10",
    additionalRequirements: "",
  };
  private readonly listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();

  constructor(readonly host: FakeOutlineTaskRoot) {
    this.submitButton = new FakeOutlineButton(host, "生成大纲");
  }

  field(name: string) {
    return { value: this.fieldValues[name] ?? "" };
  }

  querySelector(selector: string) {
    if (selector.includes("data-ppt-requirements-generate")) return this.submitButton;
    const nameMatch = /\[name="([^"]+)"\]/.exec(selector);
    if (nameMatch) return this.field(nameMatch[1]);
    return null;
  }

  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchSubmit() {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    for (const listener of [...(this.listeners.get("submit") ?? [])]) listener(event);
    return event;
  }
}

class FakeStatusSlot {
  constructor(readonly host: FakeOutlineTaskRoot) {}

  replaceWith(next: { html: string }) {
    this.host.statusHtml = next.html;
    this.host.retryButton = null;
  }
}

class FakeStatusFragment {
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
  }

  querySelector(selector: string) {
    if (selector.includes("data-ppt-outline-status")) {
      const html = /<p class="ppt-outline-status[\s\S]*?<\/p>/.exec(this.markup)?.[0];
      return html ? { html } : null;
    }
    return null;
  }
}

class FakeOutlineTaskRoot {
  editor: FakeOutlineEditor | null = null;
  pageCount: { textContent: string } | null = null;
  retryButton: FakeOutlineButton | null = null;
  backButton: FakeOutlineButton | null = null;
  requirementsForm: FakeRequirementsForm | null = null;
  focused: unknown = null;
  editorRebuilds = 0;
  statusHtml = "";
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.rebuild();
  }

  get innerHTML() {
    return this.markup;
  }

  closest() {
    return null;
  }

  querySelector(selector: string): unknown {
    if (selector.includes("data-ppt-outline-editor")) return this.editor;
    if (selector.includes("data-ppt-outline-pagecount")) return this.pageCount;
    if (selector.includes("data-ppt-outline-status")) return this.statusHtml ? new FakeStatusSlot(this) : null;
    if (selector.includes("data-ppt-outline-retry")) {
      if (!this.statusHtml.includes("data-ppt-outline-retry")) return null;
      if (!this.retryButton) this.retryButton = new FakeOutlineButton(this, "重试");
      return this.retryButton;
    }
    if (selector.includes("data-ppt-outline-back")) return this.backButton;
    if (selector.includes("data-ppt-requirements-form")) return this.requirementsForm;
    if (selector.includes("data-ppt-page-preset")) return this.requirementsForm?.preset ?? null;
    if (selector.includes("data-ppt-page-min")) return this.requirementsForm?.field("pageMin") ?? null;
    if (selector.includes("data-ppt-page-max")) return this.requirementsForm?.field("pageMax") ?? null;
    return null;
  }

  querySelectorAll(selector: string): unknown[] {
    return this.editor ? this.editor.querySelectorAll(selector) : [];
  }

  private rebuild() {
    this.editor = this.markup.includes("data-ppt-outline-editor") ? new FakeOutlineEditor(this, this.markup) : null;
    const pageCountMatch = /当前 \d+ 页/.exec(this.markup);
    this.pageCount = this.markup.includes("data-ppt-outline-pagecount") ? { textContent: pageCountMatch?.[0] ?? "" } : null;
    this.statusHtml = /<p class="ppt-outline-status[\s\S]*?<\/p>/.exec(this.markup)?.[0] ?? "";
    this.retryButton = null;
    this.backButton = this.markup.includes("data-ppt-outline-back") ? new FakeOutlineButton(this, "返回修改需求") : null;
    this.requirementsForm = this.markup.includes("data-ppt-requirements-form") ? new FakeRequirementsForm(this) : null;
  }
}

function outlineSnapshot(paragraphs: PptOutlineParagraph[], version = 3): PptOutlineSnapshot {
  return {
    version,
    pageCount: paragraphs.filter((paragraph) => paragraph.level === 1).length,
    paragraphs,
    publicSources: [],
  };
}

function createOutlineScheduler() {
  const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
  return {
    scheduled,
    schedule(callback: () => void, delayMs: number) {
      scheduled.push({ delayMs, callback });
      return scheduled.length;
    },
    clear() {
      scheduled.length = 0;
    },
    flush() {
      const pending = scheduled.splice(0, scheduled.length);
      for (const item of pending) item.callback();
    },
  };
}

function createStubChatController() {
  return createConversationChatController({
    conversationId: "conversation-a",
    client: {
      getSession: async () => ({
        id: "conversation-a",
        revision: 1,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      }),
      sendText: async () => {
        throw new Error("not used");
      },
    },
  });
}

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("outline workspace editor mount", () => {
  const originalDocument = (globalThis as Record<string, unknown>).document;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).document = { createElement: () => new FakeStatusFragment() };
  });

  afterEach(() => {
    if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = originalDocument;
  });

  function mountOutlineEditor(paragraphs: PptOutlineParagraph[], options: { idFactory?: () => string } = {}) {
    const scheduler = createOutlineScheduler();
    const saves: Array<{ draftId: string; expectedVersion: number; paragraphs: PptOutlineParagraph[] }> = [];
    const outlineStore = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        saves.push(input);
        return outlineSnapshot(input.paragraphs, input.expectedVersion + 1);
      },
      recover: async () => null,
      idFactory: options.idFactory,
    });
    const controller = createStubChatController();
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeOutlineTaskRoot();
    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
      { outlineStore },
    );
    outlineStore.ready("draft-1", outlineSnapshot(paragraphs));
    return { scheduler, saves, outlineStore, taskRoot, mainRoot, dispose };
  }

  it("keeps DOM rows, autosave payload and focus in sync when Enter splits a paragraph", async () => {
    const { scheduler, saves, outlineStore, taskRoot, dispose } = mountOutlineEditor(
      [
        { id: "page-1", level: 1, text: "第一页" },
        { id: "point-1", level: 2, text: "要点一" },
      ],
      { idFactory: () => "new-1" },
    );
    expect(taskRoot.editor?.rows.map((row) => row.id)).toEqual(["page-1", "point-1"]);

    const pageInput = taskRoot.editor!.rows[0].textarea;
    pageInput.selectionStart = 2;
    pageInput.selectionEnd = 2;
    const event = pageInput.dispatchKeydown("Enter");

    expect(event.defaultPrevented).toBe(true);
    const state = outlineStore.getState();
    const stateRows = state.phase === "ready" ? state.paragraphs.map((p) => [p.id, p.text]) : [];
    expect(stateRows).toEqual([["page-1", "第一"], ["new-1", "页"], ["point-1", "要点一"]]);
    // The visible rows must match the store exactly: no ghost or duplicate paragraph.
    expect(taskRoot.editor!.rows.map((row) => [row.id, row.textarea.value])).toEqual(stateRows);
    // The store focus hint lands on the start of the new paragraph.
    const newRow = taskRoot.editor!.rows[1];
    expect(taskRoot.focused).toBe(newRow.textarea);
    expect(newRow.textarea.selectionStart).toBe(0);

    scheduler.flush();
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
    expect(saves).toHaveLength(1);
    // The persisted payload matches what is visible, nothing more.
    expect(saves[0].paragraphs.map((p) => [p.id, p.text])).toEqual(
      taskRoot.editor!.rows.map((row) => [row.id, row.textarea.value]),
    );
    dispose();
  });

  it("exposes orphan hierarchy feedback immediately and clears it when the level is repaired", () => {
    const { scheduler, outlineStore, taskRoot, dispose } = mountOutlineEditor([
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-1", level: 2, text: "要点一" },
      { id: "detail-1", level: 3, text: "说明一" },
    ]);
    const pointInput = taskRoot.editor!.rows[1].textarea;
    pointInput.selectionStart = 1;
    pointInput.selectionEnd = 1;
    const outdentEvent = pointInput.dispatchKeydown("Tab", { shiftKey: true });

    expect(outdentEvent.defaultPrevented).toBe(true);
    let editor = taskRoot.editor!;
    expect(editor.rows.map((row) => [row.id, row.dataset.level])).toEqual([
      ["page-1", "1"],
      ["point-1", "1"],
      ["detail-1", "3"],
    ]);
    expect(editor.rows[2].orphan).toBe(true);
    expect(taskRoot.pageCount?.textContent).toBe("当前 2 页");
    expect(outlineStore.getState()).toMatchObject({ orphanIds: ["detail-1"], saveBlocked: true });
    // Focus stays on the edited paragraph with its caret preserved.
    expect(taskRoot.focused).toBe(editor.rows[1].textarea);
    expect(editor.rows[1].textarea.selectionStart).toBe(1);

    const repairEvent = editor.rows[1].textarea.dispatchKeydown("Tab");
    expect(repairEvent.defaultPrevented).toBe(true);
    editor = taskRoot.editor!;
    expect(editor.rows.map((row) => [row.id, row.dataset.level])).toEqual([
      ["page-1", "1"],
      ["point-1", "2"],
      ["detail-1", "3"],
    ]);
    expect(editor.rows[2].orphan).toBe(false);
    expect(outlineStore.getState()).toMatchObject({ orphanIds: [], saveBlocked: false });
    expect(scheduler.scheduled).toHaveLength(1);
    dispose();
  });

  it("merges on paragraph-start Backspace without leaving ghost rows in the DOM or payload", async () => {
    const { scheduler, saves, taskRoot, dispose } = mountOutlineEditor([
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-1", level: 2, text: "要点一" },
      { id: "page-2", level: 1, text: "第二页" },
    ]);
    const pageTwoInput = taskRoot.editor!.rows[2].textarea;
    pageTwoInput.selectionStart = 0;
    pageTwoInput.selectionEnd = 0;
    const event = pageTwoInput.dispatchKeydown("Backspace");

    expect(event.defaultPrevented).toBe(true);
    const editor = taskRoot.editor!;
    expect(editor.rows.map((row) => [row.id, row.textarea.value])).toEqual([
      ["page-1", "第一页"],
      ["point-1", "要点一第二页"],
    ]);
    expect(taskRoot.focused).toBe(editor.rows[1].textarea);
    expect(editor.rows[1].textarea.selectionStart).toBe(3);

    scheduler.flush();
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0].paragraphs.map((p) => [p.id, p.text])).toEqual(
      editor.rows.map((row) => [row.id, row.textarea.value]),
    );
    dispose();
  });

  it("keeps the same textarea, caret and editor DOM for pure text edits", () => {
    const { outlineStore, taskRoot, dispose } = mountOutlineEditor([
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-1", level: 2, text: "要点一" },
    ]);
    const editor = taskRoot.editor!;
    const pointInput = editor.rows[1].textarea;
    const rebuildsBefore = taskRoot.editorRebuilds;

    pointInput.value = "改后要点";
    pointInput.selectionStart = 4;
    pointInput.selectionEnd = 4;
    pointInput.dispatchInput();

    expect(taskRoot.editorRebuilds).toBe(rebuildsBefore);
    expect(editor.rows[1].textarea).toBe(pointInput);
    expect(pointInput.selectionStart).toBe(4);
    const state = outlineStore.getState();
    expect(state.phase === "ready" && state.paragraphs[1].text).toBe("改后要点");
    expect(state).toMatchObject({ dirty: true });
    dispose();
  });

  it("moves focus to the next actionable control on Escape so Tab hierarchy keys never trap keyboard users", () => {
    const { taskRoot, dispose } = mountOutlineEditor([
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-1", level: 2, text: "要点一" },
    ]);
    expect(taskRoot.backButton).not.toBeNull();

    const event = taskRoot.editor!.rows[0].textarea.dispatchKeydown("Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(taskRoot.focused).toBe(taskRoot.backButton);
    dispose();
  });

  it("disables requirements submit while save and generate are in flight and ignores duplicate submits", async () => {
    const context = { conversationId: "conversation-a", requestId: "request-1", bookId: "book-1" };
    const workspaceStore = createPptRequirementsWorkspaceStore();
    const controller = createStubChatController();
    const mainRoot = new FakeMainRoot();
    const taskRoot = new FakeOutlineTaskRoot();
    const submitGate = deferredVoid();
    const submits: Array<{ purpose: string; pageRange: { min: number; max: number } }> = [];
    const dispose = mountConversationChatView(
      mainRoot as unknown as HTMLElement,
      taskRoot as unknown as HTMLElement,
      controller,
      {
        workspaceStore,
        onRequirementsSubmit: (input) => {
          submits.push(input);
          return submitGate.promise;
        },
      },
    );
    workspaceStore.ready(context, {
      status: "created",
      workspace: {
        draft: { id: "draft-1", conversationId: "conversation-a", stage: "requirements", version: 1, requirements: { purpose: null, audience: null, pageRange: null, additionalRequirements: "" } },
        sources: [{ bookId: "book-1", title: "测试书", author: null, sourceLabel: "本地" }],
      },
    });
    const form = taskRoot.requirementsForm!;
    const first = form.dispatchSubmit();
    const second = form.dispatchSubmit();

    expect(first.prevented).toBe(true);
    expect(second.prevented).toBe(true);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ purpose: "分享", pageRange: { min: 8, max: 10 } });
    expect(form.submitButton.disabled).toBe(true);
    expect(form.submitButton.textContent).toContain("正在");

    submitGate.resolve();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(form.submitButton.disabled).toBe(false);
    expect(form.submitButton.textContent).toBe("生成大纲");
    dispose();
  });
});
