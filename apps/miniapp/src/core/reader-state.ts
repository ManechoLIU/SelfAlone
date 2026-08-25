import type { ReadingBackground } from "../adapters/client";

export type BookSection = {
  id: string;
  index: number;
  title: string;
  body: string;
  locator: string;
};

export type ReaderBlock = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  offset: number;
  text: string;
};

export type ReaderBlockGeometry = {
  offsetTop: number;
  height: number;
};

export function buildReaderBlocks(
  sections: BookSection[],
  charactersPerLocatorBlock = 360,
): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  for (const section of sections) {
    const body = section.body.trim();
    for (let offset = 0; offset < body.length; offset += charactersPerLocatorBlock) {
      blocks.push({
        id: `${section.id}:${offset}`,
        sectionId: section.id,
        sectionTitle: section.title,
        offset,
        text: body.slice(offset, offset + charactersPerLocatorBlock),
      });
    }
  }
  return blocks;
}

export function restoreReaderBlock(
  blocks: ReaderBlock[],
  position: { sectionId: string; offset: number } | null,
) {
  if (!position) return 0;
  let closest = blocks.findIndex((block) => block.sectionId === position.sectionId);
  blocks.forEach((block, index) => {
    if (block.sectionId === position.sectionId && block.offset <= position.offset) closest = index;
  });
  return Math.max(0, closest);
}

export function readerBlockFromScroll(
  geometry: readonly ReaderBlockGeometry[],
  metrics: { scrollTop: number; scrollHeight: number; viewportHeight: number },
) {
  if (geometry.length <= 1) return 0;
  const scrollTop = Math.max(0, Number.isFinite(metrics.scrollTop) ? metrics.scrollTop : 0);
  const viewportHeight = Math.max(0, Number.isFinite(metrics.viewportHeight) ? metrics.viewportHeight : 0);
  const readingAnchor = scrollTop + Math.min(viewportHeight * 0.25, 96);
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  geometry.forEach((block, index) => {
    const offsetTop = Math.max(0, Number.isFinite(block.offsetTop) ? block.offsetTop : 0);
    const height = Math.max(1, Number.isFinite(block.height) ? block.height : 1);
    const bottom = offsetTop + height;
    if (readingAnchor >= offsetTop && readingAnchor < bottom) {
      closestIndex = index;
      closestDistance = 0;
      return;
    }
    const distance = readingAnchor < offsetTop
      ? offsetTop - readingAnchor
      : readingAnchor - bottom;
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });

  return closestIndex;
}

export function readerSectionBlockIndexes(
  blocks: ReaderBlock[],
  sections: Array<Pick<BookSection, "id">>,
) {
  return sections.map((section) => {
    const index = blocks.findIndex((block) => block.sectionId === section.id);
    return index >= 0 ? index : null;
  });
}

export function readerBodyScrollMetrics(
  metrics: { scrollTop: number; scrollHeight: number; viewportHeight: number },
  introHeight: number,
) {
  const measuredIntroHeight = Math.max(metrics.viewportHeight, introHeight);
  return {
    scrollTop: Math.max(0, metrics.scrollTop - measuredIntroHeight),
    scrollHeight: Math.max(metrics.viewportHeight, metrics.scrollHeight - measuredIntroHeight),
    viewportHeight: metrics.viewportHeight,
  };
}

export function createReaderPositionSaver(
  save: (index: number) => Promise<void>,
  delay = 400,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingIndex: number | null = null;
  let inFlight: Promise<void> | null = null;

  const drain = (): Promise<void> => {
    if (inFlight) return inFlight.then(() => drain());
    if (pendingIndex === null) return Promise.resolve();
    const index = pendingIndex;
    pendingIndex = null;
    inFlight = Promise.resolve(save(index)).finally(() => { inFlight = null; });
    return inFlight.then(() => drain());
  };

  return {
    schedule(index: number) {
      pendingIndex = index;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delay);
    },
    flush(index?: number) {
      if (index !== undefined) pendingIndex = index;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return drain();
    },
  };
}

export function readViewportHeight(platform: {
  getWindowInfo?: () => { windowHeight: number };
  getSystemInfoSync: () => { windowHeight: number };
}) {
  return platform.getWindowInfo?.().windowHeight ?? platform.getSystemInfoSync().windowHeight;
}

export function toReadingPosition(
  blocks: ReaderBlock[],
  blockIndex: number,
  expectedVersion: number,
  background: ReadingBackground,
) {
  const safeIndex = Math.min(Math.max(0, blockIndex), Math.max(0, blocks.length - 1));
  const block = blocks[safeIndex];
  if (!block) throw new Error("READER_BLOCK_MISSING");
  return {
    sectionId: block.sectionId,
    offset: block.offset,
    progress: blocks.length <= 1 ? 1 : safeIndex / (blocks.length - 1),
    background,
    expectedVersion,
  };
}
