import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildReaderBlocks,
  createReaderPositionSaver,
  readerBodyScrollMetrics,
  readerBlockFromScroll,
  readerSectionBlockIndexes,
  readViewportHeight,
  restoreReaderBlock,
  toReadingPosition,
} from "./reader-state";

afterEach(() => vi.useRealTimers());

describe("natural continuous reading", () => {
  it("splits text into locator blocks without defining visual pages", () => {
    const blocks = buildReaderBlocks([
      { id: "section-1", index: 0, title: "第一章", body: "甲".repeat(620), locator: "section:0" },
      { id: "section-2", index: 1, title: "第二章", body: "乙".repeat(40), locator: "section:1" },
    ], 300);
    expect(blocks.map((block) => [block.sectionId, block.offset, block.text.length])).toEqual([
      ["section-1", 0, 300], ["section-1", 300, 300], ["section-1", 600, 20], ["section-2", 0, 40],
    ]);
  });

  it("restores the nearest locator block and serializes continuous progress", () => {
    const blocks = buildReaderBlocks([
      { id: "section-1", index: 0, title: "第一章", body: "甲".repeat(620), locator: "section:0" },
      { id: "section-2", index: 1, title: "第二章", body: "乙".repeat(40), locator: "section:1" },
    ], 300);
    expect(restoreReaderBlock(blocks, { sectionId: "section-1", offset: 340 })).toBe(1);
    expect(toReadingPosition(blocks, 3, 4, "dark")).toEqual({
      sectionId: "section-2",
      offset: 0,
      progress: 1,
      expectedVersion: 4,
      background: "dark",
    });
  });

  it("maps free vertical scrolling to measured blocks without snapping", () => {
    const geometry = [
      { offsetTop: 0, height: 600 },
      { offsetTop: 600, height: 600 },
      { offsetTop: 1200, height: 600 },
      { offsetTop: 1800, height: 600 },
    ];
    expect(readerBlockFromScroll(geometry, { scrollTop: 0, scrollHeight: 2400, viewportHeight: 600 })).toBe(0);
    expect(readerBlockFromScroll(geometry, { scrollTop: 900, scrollHeight: 2400, viewportHeight: 600 })).toBe(1);
    expect(readerBlockFromScroll(geometry, { scrollTop: 1800, scrollHeight: 2400, viewportHeight: 600 })).toBe(3);
  });

  it("uses measured heights for long chapters instead of an even block index", () => {
    const geometry = [
      { offsetTop: 0, height: 740 },
      { offsetTop: 740, height: 260 },
      { offsetTop: 1000, height: 1600 },
      { offsetTop: 2600, height: 340 },
    ];
    expect(readerBlockFromScroll(geometry, {
      scrollTop: 2100,
      scrollHeight: 2940,
      viewportHeight: 600,
    })).toBe(2);
  });

  it("maps each catalog section to its first rendered block", () => {
    const blocks = buildReaderBlocks([
      { id: "section-1", index: 0, title: "第一章", body: "甲".repeat(620), locator: "section:0" },
      { id: "section-2", index: 1, title: "第二章", body: "乙".repeat(40), locator: "section:1" },
    ], 300);
    expect(readerSectionBlockIndexes(blocks, [
      { id: "section-1" },
      { id: "section-2" },
    ])).toEqual([0, 3]);
  });

  it("returns no catalog target for an empty section instead of block zero", () => {
    const blocks = buildReaderBlocks([
      { id: "empty-section", index: 0, title: "空章节", body: "", locator: "section:0" },
      { id: "section-2", index: 1, title: "第二章", body: "乙".repeat(40), locator: "section:1" },
    ], 300);
    expect(readerSectionBlockIndexes(blocks, [
      { id: "empty-section" },
      { id: "section-2" },
    ])).toEqual([null, 0]);
  });

  it("subtracts the measured introduction height from body scroll metrics", () => {
    expect(readerBodyScrollMetrics({
      scrollTop: 960,
      scrollHeight: 3360,
      viewportHeight: 600,
    }, 960)).toEqual({ scrollTop: 0, scrollHeight: 2400, viewportHeight: 600 });
  });

  it("saves only the latest position after inertial scrolling settles", async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const saver = createReaderPositionSaver(async (index) => { saved.push(index); }, 400);
    saver.schedule(1);
    vi.advanceTimersByTime(250);
    saver.schedule(2);
    vi.advanceTimersByTime(399);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(saved).toEqual([2]);
  });

  it("flushes before navigation and serializes a newer position behind an in-flight save", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const releases: Array<() => void> = [];
    const saver = createReaderPositionSaver((index) => {
      calls.push(index);
      return new Promise<void>((resolve) => releases.push(resolve));
    }, 400);
    saver.schedule(1);
    const firstFlush = saver.flush();
    expect(calls).toEqual([1]);
    saver.schedule(2);
    vi.advanceTimersByTime(400);
    expect(calls).toEqual([1]);
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([1, 2]);
    releases.shift()?.();
    await firstFlush;
  });

  it("falls back to the legacy viewport API when getWindowInfo is unavailable", () => {
    expect(readViewportHeight({ getSystemInfoSync: () => ({ windowHeight: 568 }) })).toBe(568);
    expect(readViewportHeight({ getWindowInfo: () => ({ windowHeight: 844 }), getSystemInfoSync: () => ({ windowHeight: 568 }) })).toBe(844);
  });
});
