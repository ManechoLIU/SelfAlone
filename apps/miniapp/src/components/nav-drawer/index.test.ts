// @ts-expect-error Vitest runs this contract in Node; Mini production types intentionally exclude Node built-ins.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import drawerWxml from "./index.wxml?raw";
import drawerWxss from "./index.wxss?raw";

function readUint32(buffer: Uint8Array, offset: number) {
  return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
}

function readPngChunks(buffer: Uint8Array) {
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = readUint32(buffer, offset);
    const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    chunks.push({ type, data: buffer.subarray(dataStart, dataStart + length) });
    offset = dataStart + length + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

describe("miniapp navigation drawer visual contract", () => {
  it("uses a paper-open hierarchy instead of card-like navigation", () => {
    expect(drawerWxss).toContain("background: linear-gradient(180deg, #fbfcf9 0%, #f7f8f3 100%)");
    expect(drawerWxss).toContain(".drawer-search");
    expect(drawerWxss).toContain("border: 0");
    expect(drawerWxss).toContain("background: #f0f3ef");
    expect(drawerWxss).toContain(".drawer-conversation--current");
    expect(drawerWxss).toContain("border-radius: 0");
    expect(drawerWxss).toContain("overflow-y: hidden");
    expect(drawerWxss).toContain("min-height: 64px");
    expect(drawerWxss).toContain("font-size: 16px; line-height: 24px");
  });

  it("models loading, empty, filtered-empty, failed and normal conversation states", () => {
    expect(drawerWxml).toContain("status");
    expect(drawerWxml).toContain("正在加载会话");
    expect(drawerWxml).toContain("还没有会话");
    expect(drawerWxml).toContain("没有匹配的会话");
    expect(drawerWxml).toContain("会话暂时无法加载");
    expect(drawerWxml).toContain("重试");
    expect(drawerWxml).toContain('role="alert"');
    expect(drawerWxml).toContain("drawerStatus === 'failed' || drawerStatus === 'normal'");
    expect(drawerWxml).toContain('wx:for="{{visibleConversations}}"');
    expect(drawerWxml).not.toMatch(/开发适配器|不会同步|客户端基础工作包|F3|F4|H3/);
  });

  it("keeps open conversation rows, keyboard shortening and bottom layering semantic", () => {
    expect(drawerWxml).toContain('aria-current="{{item.current ? \'page\' : \'false\'}}"');
    expect(drawerWxml).toContain('disabled="{{item.disabled}}"');
    expect(drawerWxml).toContain("当前会话");
    expect((drawerWxml.match(/<scroll-view\b/g) ?? [])).toHaveLength(1);
    expect(drawerWxml).toContain('scroll-y="true"');
    expect(drawerWxml).toContain('bindtap="retry"');
    expect(drawerWxss).toContain(".drawer-conversations {\n  position: relative;\n  z-index: 1;");
    expect(drawerWxss).toContain(".drawer-state {\n  position: relative;\n  z-index: 1;");
    expect(drawerWxss).toContain(".drawer-nav {\n  position: relative;\n  z-index: 2;");
    expect(drawerWxss).toContain("calc(var(--safe-bottom, env(safe-area-inset-bottom)) + 18px)");
  });

  it("keeps visible focus semantics and disables motion displacement when requested", () => {
    expect(drawerWxml).toContain('aria-label="搜索会话"');
    expect(drawerWxml).toContain('aria-label="关闭主导航"');
    expect(drawerWxml).toContain('aria-label="重试加载会话"');
    expect(drawerWxss).toContain("min-height: 44px");
    expect(drawerWxss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(drawerWxss).toContain("animation: drawer-fade 140ms ease");
    expect(drawerWxss).not.toContain("scale(");
  });

  it("keeps the bottom destinations directional and leaves scenery asset-free", () => {
    expect((drawerWxml.match(/class="drawer-nav__arrow"/g) ?? [])).toHaveLength(2);
    expect(drawerWxml).toContain('src="/assets/icons/arrow.svg"');
    expect(drawerWxml).toContain('class="drawer-scenery-slot"');
    expect(drawerWxss).toContain(".drawer-nav__arrow");
    expect(drawerWxss).toContain("height: 140px");
    expect(drawerWxss).toContain("pointer-events: none");
    expect(drawerWxss).not.toContain("desktop-left-rail-vintage");
    expect(drawerWxss).not.toMatch(/background-image\s*:/);
  });

  it("renders the mirrored scenery as a non-interactive, masked bottom slot", () => {
    const scenerySlotRule = drawerWxss.match(/\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const sceneryRule = drawerWxss.match(/\.drawer-scenery\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(drawerWxml).toContain('<image class="drawer-scenery" src="/assets/backgrounds/mobile-drawer-landscape-transparent-cropped-v1-mirrored.png" mode="widthFix" aria-hidden="true"></image>');
    expect(scenerySlotRule).toContain("height: 140px");
    expect(scenerySlotRule).toContain("overflow: hidden");
    expect(scenerySlotRule).toContain("z-index: 0");
    expect(scenerySlotRule).toContain("pointer-events: none");
    expect(sceneryRule).toContain("left: 0");
    expect(sceneryRule).toContain("bottom: 0");
    expect(sceneryRule).toContain("width: 100%");
    expect(sceneryRule).toContain("height: auto");
    expect(sceneryRule).toContain("opacity: .62");
    expect(sceneryRule).toContain("pointer-events: none");
    expect(sceneryRule).toContain("mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.12) 28px, rgba(0,0,0,.78) 72px, #000 140px)");
    expect(drawerWxss).toContain(".drawer-nav {\n  position: relative;\n  z-index: 2;");
  });

  it("keeps the scenery out of the conversation list layout", () => {
    const conversationRule = drawerWxss.match(/\.drawer-conversations\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(conversationRule).not.toContain("padding-bottom");
    expect(drawerWxss).toContain(".drawer-scenery-slot {\n  position: absolute;");
    expect(drawerWxss).toContain(".drawer-scenery-slot {\n  position: absolute;\n  left: 0;\n  right: 0;");
  });

  it("keeps scenery below the current conversation on short screens", () => {
    const shortScreenRule = drawerWxss.match(/@media \(max-height: 600px\)\s*\{[\s\S]*?\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(shortScreenRule).toContain("height: 72px");
  });

  it("shrinks scenery progressively before the short drawer content band", () => {
    const regularRule = drawerWxss.match(/\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const compactRule = drawerWxss.match(/@media \(max-height: 700px\)\s*\{\s*\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const shortRule = drawerWxss.match(/@media \(max-height: 600px\)\s*\{[\s\S]*?\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const readHeight = (rule: string) => Number(rule.match(/height:\s*(\d+)px/)?.[1] ?? NaN);

    const regularHeight = readHeight(regularRule);
    const compactHeight = readHeight(compactRule);
    const shortHeight = readHeight(shortRule);

    expect(regularHeight).toBe(140);
    expect(compactHeight).toBeLessThan(regularHeight);
    expect(shortHeight).toBeLessThan(compactHeight);
  });

  it("keeps the compact short-screen rhythm above the bottom navigation", () => {
    const shortMediaStart = drawerWxss.indexOf("@media (max-height: 600px)");
    const shortMedia = shortMediaStart >= 0 ? drawerWxss.slice(shortMediaStart) : "";
    const shortSlot = shortMedia.match(/\.drawer-scenery-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const bottomOffset = Number(shortSlot.match(/bottom:\s*calc\([^+]+\+\s*(\d+)px\)/)?.[1] ?? NaN);
    const compactTouchHeights = [...shortMedia.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));

    expect(bottomOffset).toBeGreaterThanOrEqual(154);
    expect(shortMedia).toContain(".drawer-panel");
    expect(shortMedia).toContain(".drawer-new");
    expect(shortMedia).toContain(".drawer-search");
    expect(shortMedia).toContain(".drawer-section-title");
    expect(compactTouchHeights.length).toBeGreaterThan(0);
    expect(Math.min(...compactTouchHeights)).toBeGreaterThanOrEqual(44);
  });

  it("ships the scenery as a compact indexed PNG with explicit transparency", () => {
    // @ts-expect-error Vitest runs this contract in Node; Mini production types intentionally exclude URL globals.
    const asset = readFileSync(new URL("../../assets/backgrounds/mobile-drawer-landscape-transparent-cropped-v1-mirrored.png", import.meta.url));
    const chunks = readPngChunks(asset);
    const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
    const palette = chunks.find((chunk) => chunk.type === "PLTE")?.data;
    const transparency = chunks.find((chunk) => chunk.type === "tRNS")?.data;

    expect(Array.from(asset.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(asset.byteLength).toBeLessThan(200_000);
    expect(ihdr && readUint32(ihdr, 0)).toBe(1024);
    expect(ihdr && readUint32(ihdr, 4)).toBe(737);
    expect(ihdr?.[9]).toBe(3);
    expect(palette).toBeDefined();
    expect(transparency).toBeDefined();
    expect((transparency?.length ?? 0)).toBe((palette?.length ?? 0) / 3);
    expect(Math.min(...(transparency ?? []))).toBe(0);
    expect(Math.max(...(transparency ?? []))).toBeLessThan(255);
  });
});
