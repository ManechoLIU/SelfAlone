import type { TextAnnotationSource as ContractTextAnnotationSource, TextLocator } from "@selfalone/contracts";

export const TEXT_ANNOTATION_LIMITS = {
  maxSectionIdLength: 512,
  maxQuoteLength: 20_000,
  maxThoughtLength: 20_000,
  maxNoteBodyLength: 100_000,
} as const;

export type TextAnnotationSection = {
  sectionId: string;
  fileVersion: number;
  text: string;
};

/** A source is the shared text locator plus an exclusive end offset and snapshot quote. */
export type TextAnnotationSource = ContractTextAnnotationSource;

export type TextHighlightDraft = TextAnnotationSource & {
  thought: string | null;
};

export type TextNoteDraft = {
  body: string;
  source: TextAnnotationSource | null;
};

function isSafeInteger(value: number) {
  return Number.isSafeInteger(value);
}

function requiredText(value: string, errorCode: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  if (normalized.length > maxLength) throw new Error("TEXT_TOO_LONG");
  return normalized;
}

function validateFileVersion(fileVersion: number) {
  if (!isSafeInteger(fileVersion) || fileVersion < 1) throw new Error("INVALID_FILE_VERSION");
}

function validateLocator(locator: TextLocator) {
  if (locator.kind !== "text") throw new Error("INVALID_LOCATOR");
  validateFileVersion(locator.fileVersion);
  if (!locator.sectionId || locator.sectionId.length > TEXT_ANNOTATION_LIMITS.maxSectionIdLength) {
    throw new Error("INVALID_LOCATOR");
  }
  if (!isSafeInteger(locator.offset) || locator.offset < 0) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
}

function validateSourceShape(source: TextAnnotationSource) {
  validateLocator(source.locator);
  if (!isSafeInteger(source.endOffset) || source.endOffset <= source.locator.offset) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
  requiredText(source.quote, "INVALID_HIGHLIGHT_QUOTE", TEXT_ANNOTATION_LIMITS.maxQuoteLength);
}

export function createTextAnnotationSource(input: {
  section: TextAnnotationSection;
  locator: TextLocator;
  endOffset: number;
  quote?: string;
}) {
  validateFileVersion(input.section.fileVersion);
  validateLocator(input.locator);
  if (input.locator.fileVersion !== input.section.fileVersion) throw new Error("STALE_VERSION");
  if (input.locator.sectionId !== input.section.sectionId) throw new Error("SECTION_NOT_FOUND");
  if (
    !isSafeInteger(input.endOffset)
    || input.locator.offset < 0
    || input.endOffset <= input.locator.offset
    || input.endOffset > input.section.text.length
  ) {
    throw new Error("INVALID_HIGHLIGHT_RANGE");
  }
  const expectedQuote = input.section.text.slice(input.locator.offset, input.endOffset);
  const quote = input.quote ?? expectedQuote;
  if (quote !== expectedQuote) throw new Error("INVALID_HIGHLIGHT_QUOTE");
  requiredText(quote, "INVALID_HIGHLIGHT_QUOTE", TEXT_ANNOTATION_LIMITS.maxQuoteLength);
  return {
    locator: input.locator,
    endOffset: input.endOffset,
    quote,
  } satisfies TextAnnotationSource;
}

export function validateTextAnnotationSource(input: {
  section: TextAnnotationSection;
  source: TextAnnotationSource;
}) {
  return createTextAnnotationSource({
    section: input.section,
    locator: input.source.locator,
    endOffset: input.source.endOffset,
    quote: input.source.quote,
  });
}

export function createTextHighlightDraft(input: {
  section: TextAnnotationSection;
  locator: TextLocator;
  endOffset: number;
  quote?: string;
  thought?: string | null;
}): TextHighlightDraft {
  const source = createTextAnnotationSource(input);
  const thought = input.thought?.trim() || null;
  if (thought && thought.length > TEXT_ANNOTATION_LIMITS.maxThoughtLength) {
    throw new Error("TEXT_TOO_LONG");
  }
  return { ...source, thought };
}

export function createTextNoteDraft(input: {
  body: string;
  source?: TextAnnotationSource | null;
}): TextNoteDraft {
  const body = requiredText(input.body, "NOTE_BODY_REQUIRED", TEXT_ANNOTATION_LIMITS.maxNoteBodyLength);
  const source = input.source ?? null;
  if (source) validateSourceShape(source);
  return { body, source };
}

export function textLocatorFromSource(source: TextAnnotationSource): TextLocator {
  return source.locator;
}
