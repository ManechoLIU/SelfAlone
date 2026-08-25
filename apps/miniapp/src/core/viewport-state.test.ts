import { describe, expect, it, vi } from "vitest";
import {
  availablePanelHeight,
  createViewportTracker,
  initialViewportGeometry,
  viewportPresentation,
  withKeyboardHeight,
  withWindowResize,
} from "./viewport-state";

describe("Mini Program viewport geometry", () => {
  it.each([
    [320, 568, 24, 552, 320, 568, 24, 16, 528],
    [360, 640, 24, 624, 360, 640, 24, 16, 600],
    [360, 667, 24, 651, 360, 667, 24, 16, 627],
    [390, 844, 47, 810, 390, 844, 47, 34, 763],
    [430, 932, 47, 898, 430, 932, 47, 34, 851],
  ])("normalizes %sx%s safe-area metrics", (
    windowWidth,
    windowHeight,
    safeTop,
    safeBottomEdge,
    expectedWidth,
    expectedHeight,
    expectedSafeTop,
    expectedSafeBottom,
    expectedContentHeight,
  ) => {
    expect(initialViewportGeometry({
      windowWidth,
      windowHeight,
      safeArea: { top: safeTop, bottom: safeBottomEdge },
    })).toMatchObject({
      width: expectedWidth,
      height: expectedHeight,
      availableHeight: expectedHeight,
      safeTop: expectedSafeTop,
      safeBottom: expectedSafeBottom,
      effectiveBottomInset: expectedSafeBottom,
      contentHeight: expectedContentHeight,
      keyboardHeight: 0,
      keyboardOpen: false,
    });
  });

  it("does not subtract the keyboard twice when WeChat has already resized the window", () => {
    const initial = initialViewportGeometry({
      windowWidth: 390,
      windowHeight: 844,
      safeArea: { top: 47, bottom: 810 },
    });

    const overlayKeyboard = withKeyboardHeight(initial, 300);
    expect(overlayKeyboard).toMatchObject({
      height: 844,
      availableHeight: 544,
      contentHeight: 497,
      effectiveBottomInset: 0,
      keyboardOpen: true,
    });

    const resizedWindow = withWindowResize(overlayKeyboard, {
      windowWidth: 390,
      windowHeight: 544,
      safeArea: { top: 47, bottom: 544 },
    });
    expect(resizedWindow).toMatchObject({
      height: 544,
      availableHeight: 544,
      contentHeight: 497,
      keyboardHeight: 300,
    });
  });

  it("adopts a real viewport resize as the new baseline after the keyboard closes", () => {
    const initial = initialViewportGeometry({ windowWidth: 360, windowHeight: 640 });
    const resized = withWindowResize(initial, { windowWidth: 430, windowHeight: 932 });
    const keyboard = withKeyboardHeight(resized, 320);
    const closed = withKeyboardHeight(keyboard, 0);

    expect(resized.baselineHeight).toBe(932);
    expect(keyboard.availableHeight).toBe(612);
    expect(closed).toMatchObject({ availableHeight: 932, baselineHeight: 932, keyboardOpen: false });
  });

  it("derives panel space from the live viewport without a device-specific height", () => {
    const viewport = withKeyboardHeight(initialViewportGeometry({
      windowWidth: 320,
      windowHeight: 568,
      safeArea: { top: 24, bottom: 552 },
    }), 240);

    expect(availablePanelHeight(viewport, { topReserved: 58, bottomReserved: 72, gap: 16 })).toBe(158);
  });

  it("exposes one safe CSS-variable contract for every page shell", () => {
    const viewport = withKeyboardHeight(initialViewportGeometry({
      windowWidth: 390,
      windowHeight: 844,
      safeArea: { top: 47, bottom: 810 },
    }), 300);

    expect(viewportPresentation(viewport)).toEqual({
      keyboardOpen: true,
      viewportStyle: "--viewport-width:390px;--viewport-height:544px;--safe-top:47px;--safe-bottom:0px;--keyboard-height:300px",
      viewportMetrics: "390×544 · safe 47/0 · keyboard 300",
    });
  });
});

describe("viewport tracker", () => {
  it("publishes initial, resize and keyboard geometry and releases both listeners", () => {
    let resizeListener: ((event: { size: { windowWidth: number; windowHeight: number } }) => void) | undefined;
    let keyboardListener: ((event: { height: number }) => void) | undefined;
    const offWindowResize = vi.fn();
    const offKeyboardHeightChange = vi.fn();
    const onChange = vi.fn();
    const platform = {
      getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, safeArea: { top: 47, bottom: 810 } }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
      onWindowResize(listener: typeof resizeListener) { resizeListener = listener; },
      offWindowResize,
      onKeyboardHeightChange(listener: typeof keyboardListener) { keyboardListener = listener; },
      offKeyboardHeightChange,
    };

    const release = createViewportTracker(platform, onChange);
    resizeListener?.({ size: { windowWidth: 390, windowHeight: 544 } });
    keyboardListener?.({ height: 300 });
    release();

    expect(onChange.mock.calls.map(([value]) => ({
      availableHeight: value.availableHeight,
      keyboardHeight: value.keyboardHeight,
    }))).toEqual([
      { availableHeight: 844, keyboardHeight: 0 },
      { availableHeight: 544, keyboardHeight: 0 },
      { availableHeight: 544, keyboardHeight: 300 },
    ]);
    expect(offWindowResize).toHaveBeenCalledWith(resizeListener);
    expect(offKeyboardHeightChange).toHaveBeenCalledWith(keyboardListener);
  });
});
