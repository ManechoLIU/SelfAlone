export type ViewportWindowInfo = {
  windowWidth: number;
  windowHeight: number;
  statusBarHeight?: number;
  safeArea?: { top: number; bottom: number };
};

export type ViewportGeometry = {
  width: number;
  height: number;
  baselineHeight: number;
  availableHeight: number;
  safeTop: number;
  safeBottom: number;
  effectiveBottomInset: number;
  contentHeight: number;
  keyboardHeight: number;
  keyboardOpen: boolean;
};

export type ViewportPlatform = {
  getWindowInfo?: () => ViewportWindowInfo;
  getSystemInfoSync: () => ViewportWindowInfo;
  onWindowResize?: (listener: (event: { size: ViewportWindowInfo }) => void) => void;
  offWindowResize?: (listener: (event: { size: ViewportWindowInfo }) => void) => void;
  onKeyboardHeightChange?: (listener: (event: { height: number }) => void) => void;
  offKeyboardHeightChange?: (listener: (event: { height: number }) => void) => void;
};

function finiteNonNegative(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function safeInsets(info: ViewportWindowInfo, fallback?: Pick<ViewportGeometry, "safeTop" | "safeBottom">) {
  const height = finiteNonNegative(info.windowHeight);
  const top = Math.min(height, finiteNonNegative(info.safeArea?.top ?? info.statusBarHeight ?? fallback?.safeTop));
  const bottomEdge = info.safeArea?.bottom;
  const bottom = bottomEdge === undefined
    ? Math.min(height - top, fallback?.safeBottom ?? 0)
    : Math.min(height - top, Math.max(0, height - finiteNonNegative(bottomEdge)));
  return { top, bottom };
}

function deriveGeometry(
  info: ViewportWindowInfo,
  baselineHeight: number,
  keyboardHeight: number,
  fallbackInsets?: Pick<ViewportGeometry, "safeTop" | "safeBottom">,
): ViewportGeometry {
  const width = finiteNonNegative(info.windowWidth);
  const height = finiteNonNegative(info.windowHeight);
  const baseline = Math.max(height, finiteNonNegative(baselineHeight));
  const keyboard = finiteNonNegative(keyboardHeight);
  const { top: safeTop, bottom: safeBottom } = safeInsets(info, fallbackInsets);
  const availableHeight = Math.min(height, Math.max(0, baseline - keyboard));
  const keyboardOpen = keyboard > 0;
  const effectiveBottomInset = keyboardOpen ? 0 : safeBottom;
  return {
    width,
    height,
    baselineHeight: baseline,
    availableHeight,
    safeTop,
    safeBottom,
    effectiveBottomInset,
    contentHeight: Math.max(0, availableHeight - safeTop - effectiveBottomInset),
    keyboardHeight: keyboard,
    keyboardOpen,
  };
}

export function initialViewportGeometry(info: ViewportWindowInfo): ViewportGeometry {
  return deriveGeometry(info, info.windowHeight, 0);
}

export function withKeyboardHeight(geometry: ViewportGeometry, height: number): ViewportGeometry {
  return deriveGeometry({
    windowWidth: geometry.width,
    windowHeight: geometry.height,
    safeArea: { top: geometry.safeTop, bottom: geometry.height - geometry.safeBottom },
  }, geometry.baselineHeight, height, geometry);
}

export function withWindowResize(geometry: ViewportGeometry, info: ViewportWindowInfo): ViewportGeometry {
  return deriveGeometry(info, geometry.baselineHeight, geometry.keyboardHeight, geometry);
}

export function availablePanelHeight(
  geometry: ViewportGeometry,
  reserved: { topReserved: number; bottomReserved: number; gap?: number },
) {
  return Math.max(0,
    geometry.contentHeight
      - finiteNonNegative(reserved.topReserved)
      - finiteNonNegative(reserved.bottomReserved)
      - finiteNonNegative(reserved.gap),
  );
}

export function viewportPresentation(geometry: ViewportGeometry) {
  return {
    keyboardOpen: geometry.keyboardOpen,
    viewportStyle: [
      `--viewport-width:${geometry.width}px`,
      `--viewport-height:${geometry.availableHeight}px`,
      `--safe-top:${geometry.safeTop}px`,
      `--safe-bottom:${geometry.effectiveBottomInset}px`,
      `--keyboard-height:${geometry.keyboardHeight}px`,
    ].join(";"),
    viewportMetrics: `${geometry.width}×${geometry.availableHeight} · safe ${geometry.safeTop}/${geometry.effectiveBottomInset} · keyboard ${geometry.keyboardHeight}`,
  };
}

export function createViewportTracker(platform: ViewportPlatform, onChange: (geometry: ViewportGeometry) => void) {
  let geometry = initialViewportGeometry(platform.getWindowInfo?.() ?? platform.getSystemInfoSync());
  const publish = (next: ViewportGeometry) => {
    geometry = next;
    onChange(geometry);
  };
  const onWindowResize = (event: { size: ViewportWindowInfo }) => publish(withWindowResize(geometry, event.size));
  const onKeyboardHeightChange = (event: { height: number }) => publish(withKeyboardHeight(geometry, event.height));

  publish(geometry);
  platform.onWindowResize?.(onWindowResize);
  platform.onKeyboardHeightChange?.(onKeyboardHeightChange);

  return () => {
    platform.offWindowResize?.(onWindowResize);
    platform.offKeyboardHeightChange?.(onKeyboardHeightChange);
  };
}
