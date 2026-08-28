import { describe, expect, it } from "vitest";
import type { WeReadConnectionProjection } from "@selfalone/contracts";
import { createWeReadState } from "./weread-state";
import { renderWeReadLibrary, renderWeReadSettings } from "./weread-view";

const connection: WeReadConnectionProjection = {
  connectionId: "connection-1",
  accountExternalId: "account-1",
  apiKeyHint: "••••1234",
  status: "verified",
  verifiedAt: "2026-08-28T00:00:00.000Z",
  revision: "revision-1",
};

const book = {
  externalId: "weread-book-1",
  title: "置身事内",
  author: "兰小欢",
  coverUrl: "/book-covers/local-default-celadon-ink-v1.png",
  progressPercent: 63,
  lastReadAt: "2026-08-27T08:00:00.000Z",
};

const annotation = {
  externalId: "weread-note-1",
  bookExternalId: book.externalId,
  quote: "理解一个系统，先看它的激励。",
  thought: "先看激励，再看结果。",
  location: "第 3 章",
  createdAt: "2026-08-27T08:10:00.000Z",
  updatedAt: "2026-08-27T08:10:00.000Z",
};

describe("desktop WeRead views", () => {
  it("renders an operable connection form and keeps a failed draft visible", () => {
    const html = renderWeReadSettings(createWeReadState({
      view: "connection",
      draftApiKey: "retry-key",
      phase: "failed",
      error: "微信读书连接未完成，请检查 API Key 后重试。",
    }));

    expect(html).toContain('data-weread-connection-form');
    expect(html).toContain('name="apiKey"');
    expect(html).toContain('type="password"');
    expect(html).toContain('data-weread-action="save-connection"');
    expect(html).toContain("retry-key");
    expect(html).toContain("微信读书连接未完成");
    expect(html).toContain('role="alert"');
  });

  it("renders local cover URLs, reading progress, quotes and thoughts", () => {
    const html = renderWeReadSettings(createWeReadState({
      view: "connection",
      phase: "ready",
      connection,
      books: [book],
      annotations: { [book.externalId]: [annotation] },
      selectedBookExternalId: book.externalId,
    }));

    expect(html).toContain('src="/book-covers/local-default-celadon-ink-v1.png"');
    expect(html).toContain("置身事内");
    expect(html).toContain("63%");
    expect(html).toContain("理解一个系统，先看它的激励。");
    expect(html).toContain("先看激励，再看结果。");
    expect(html).toContain('data-weread-book-id="weread-book-1"');
    expect(html).not.toContain("local-only-secret");
  });

  it("keeps the library row usable while a failed sync preserves existing books", () => {
    const html = renderWeReadLibrary(createWeReadState({
      phase: "failed",
      connection,
      books: [book],
      annotations: { [book.externalId]: [annotation] },
      error: "同步服务暂时不可用，已保留上次成功同步的数据。",
    }));

    expect(html).toContain('data-weread-library');
    expect(html).toContain('data-weread-action="retry-sync"');
    expect(html).toContain("同步服务暂时不可用");
    expect(html).toContain("已保留上次成功同步的数据");
    expect(html).toContain('src="/book-covers/local-default-celadon-ink-v1.png"');
    expect(html).toContain("理解一个系统，先看它的激励。");
  });
});
