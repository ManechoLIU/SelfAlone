import { randomUUID } from "node:crypto";
import type { ChatResponderPort } from "./conversation-responder";
import type {
  OutlineInput,
  OutlineResult,
  PptOutlineGenerationAdapter,
} from "./ppt-outline-adapters";
import type { PptOutlineParagraph } from "./ppt-outline-runtime";

export const PPT_OUTLINE_GENERATION_FAILED = "PPT_OUTLINE_GENERATION_FAILED" as const;
export const PPT_OUTLINE_GENERATION_ABORTED = "PPT_OUTLINE_ABORTED" as const;

const DEFAULT_OUTLINE_MAX_TOKENS = 2_048;

export type RealPptOutlineGenerationAdapterOptions = {
  /** Existing text-model chat port (DeepSeek / platform capability). */
  chat: ChatResponderPort;
  createParagraphId?: () => string;
  maxTokens?: number;
};

/**
 * Real PPT outline generation that reuses the shared ChatResponderPort pipe
 * (DeepSeek credential lease + platform free-tier capability). It does not open
 * a parallel HTTP client or accept keys from the caller.
 */
export class RealPptOutlineGenerationAdapter implements PptOutlineGenerationAdapter {
  private readonly chat: ChatResponderPort;
  private readonly createParagraphId: () => string;
  private readonly maxTokens: number;

  constructor(options: RealPptOutlineGenerationAdapterOptions) {
    if (!options.chat) {
      throw new Error(PPT_OUTLINE_GENERATION_FAILED);
    }
    this.chat = options.chat;
    this.createParagraphId = options.createParagraphId ?? (() => randomUUID());
    this.maxTokens = options.maxTokens ?? DEFAULT_OUTLINE_MAX_TOKENS;
  }

  async createOutline(input: OutlineInput, signal: AbortSignal): Promise<OutlineResult> {
    if (signal.aborted) throw new Error(PPT_OUTLINE_GENERATION_ABORTED);

    const userPrompt = buildOutlineUserPrompt(input);
    const requestId = `ppt-outline:${input.draftId}`.slice(0, 64);

    let reply: { text: string };
    try {
      reply = await this.chat.chat({
        accountId: input.accountId,
        text: userPrompt,
        maxTokens: this.maxTokens,
        context: [
          {
            id: "ppt-outline-system",
            role: "system",
            text: OUTLINE_SYSTEM_PROMPT,
          },
          {
            id: "ppt-outline-user",
            role: "user",
            text: userPrompt,
            requestId,
          },
        ],
      }, signal);
    } catch (error) {
      if (signal.aborted) throw new Error(PPT_OUTLINE_GENERATION_ABORTED);
      if (error instanceof Error && error.message === PPT_OUTLINE_GENERATION_ABORTED) {
        throw error;
      }
      throw new Error(PPT_OUTLINE_GENERATION_FAILED);
    }

    const paragraphs = parseOutlineParagraphs(reply?.text, this.createParagraphId);
    if (paragraphs.length === 0) {
      throw new Error(PPT_OUTLINE_GENERATION_FAILED);
    }
    assertOutlineHierarchy(paragraphs);
    return { paragraphs };
  }
}

export function createRealPptOutlineGenerationAdapter(
  options: RealPptOutlineGenerationAdapterOptions,
): PptOutlineGenerationAdapter {
  return new RealPptOutlineGenerationAdapter(options);
}

const OUTLINE_SYSTEM_PROMPT = [
  "你是读书 PPT 大纲生成器。只输出一个 JSON 数组，不要 Markdown 围栏，不要解释。",
  "每个元素形如 {\"level\":1|2|3,\"text\":\"非空字符串\"}。",
  "level 1 表示一页标题；level 2 是该页下的要点；level 3 是要点下的说明。",
  "必须先有 level 1，再有 level 2，再有 level 3；禁止孤儿子层。",
  "根据用途、听众、页数范围与公开资料组织内容；资料不足时不要编造全书分析，可基于已给书名与需求做有限大纲。",
].join("");

function buildOutlineUserPrompt(input: OutlineInput): string {
  const books = input.sources.length > 0
    ? input.sources.map((source, index) => (
      `${index + 1}. 《${source.title}》${source.author ? ` / ${source.author}` : ""}`
    )).join("\n")
    : "（未指定书目）";
  const publicSources = input.publicSources.length > 0
    ? input.publicSources.map((source, index) => (
      `${index + 1}. ${source.title} (${source.url})`
    )).join("\n")
    : "（无公开资料）";
  const pageRange = input.pageRange
    ? `${input.pageRange.min}-${input.pageRange.max}`
    : "未指定";

  return [
    `用途：${input.purpose?.trim() || "未指定"}`,
    `听众：${input.audience?.trim() || "未指定"}`,
    `页数范围：${pageRange}`,
    `补充要求：${input.additionalRequirements.trim() || "无"}`,
    "书目：",
    books,
    "公开资料：",
    publicSources,
    "请生成连续分层 PPT 大纲 JSON 数组。",
  ].join("\n");
}

export function parseOutlineParagraphs(
  raw: string | undefined,
  createParagraphId: () => string,
): PptOutlineParagraph[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const payload = extractJsonArray(raw);
  if (!Array.isArray(payload) || payload.length === 0) return [];

  const paragraphs: PptOutlineParagraph[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") return [];
    const level = (entry as { level?: unknown }).level;
    const text = (entry as { text?: unknown }).text;
    if (level !== 1 && level !== 2 && level !== 3) return [];
    if (typeof text !== "string" || !text.trim()) return [];
    paragraphs.push({
      id: createParagraphId(),
      level,
      text: text.trim(),
    });
  }
  return paragraphs;
}

function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

function assertOutlineHierarchy(paragraphs: readonly PptOutlineParagraph[]) {
  let hasPage = false;
  let hasPoint = false;
  for (const paragraph of paragraphs) {
    if (paragraph.level === 1) {
      hasPage = true;
      hasPoint = false;
    } else if (paragraph.level === 2) {
      if (!hasPage) throw new Error(PPT_OUTLINE_GENERATION_FAILED);
      hasPoint = true;
    } else if (!hasPage || !hasPoint) {
      throw new Error(PPT_OUTLINE_GENERATION_FAILED);
    }
  }
}
