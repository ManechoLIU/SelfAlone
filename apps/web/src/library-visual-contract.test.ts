import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesPath = new URL("./styles.css", import.meta.url);
const mainPath = new URL("./main.ts", import.meta.url);
const designPath = new URL("../../../redesign-v2/DESIGN.md", import.meta.url);
const webDesignPath = new URL("../../../redesign-v2/DESIGN-WEB.md", import.meta.url);
const rightSceneryPath = new URL(
  "../../../redesign-v2/assets/backgrounds/desktop-right-distant-mountains-transparent-v1.png",
  import.meta.url,
);

describe("library binding visual contract", () => {
  it("renders the library with the same desktop rail DOM as conversation", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toMatch(/import \{ renderDesktopAppShell, renderDesktopRail \} from "\.\/ui\/desktop-shell";/);
    expect(main).toContain('renderDesktopRail({ activeSection: "library", conversationHref: conversationRoute })');
    expect(main).not.toContain('class="library-rail"');
    expect(main).not.toContain('class="library-brand"');
    expect(main).not.toContain('class="library-nav"');
    expect(main).not.toContain('class="disabled-nav"');
  });

  it("uses one shared desktop rail token and responsive width for both routes", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toMatch(/\.desktop-app-shell,\s*\.library-shell\s*\{[\s\S]*--desktop-rail-width:\s*164px;/);
    expect(styles).toMatch(/\.desktop-app-shell,\s*\.library-shell\s*\{[\s\S]*--desktop-celadon-dark:\s*#174c3f;/);
    expect(styles).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.desktop-app-shell,\s*\.library-shell\s*\{[^}]*--desktop-rail-width:\s*92px/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?\.desktop-app-shell,\s*\.library-shell\s*\{[^}]*--desktop-rail-width:\s*72px/);
  });

  it("scopes the library visual tokens without changing the legacy workspace", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const rootRule = styles.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const sharedRule = styles.match(/\.desktop-app-shell,\s*\.library-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const shellRule = styles.match(/\.library-shell\s*\{\n  --ink:([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(rootRule).toContain("--ink: #183c31;");
    expect(rootRule).toContain("--ink-soft: #455d54;");
    expect(rootRule).toContain("--muted: #778a83;");
    expect(rootRule).toContain("--accent: #4d7d6b;");
    expect(rootRule).toContain("--accent-strong: #315f50;");
    expect(rootRule).toContain("--accent-pale: #e3efea;");
    expect(rootRule).toContain("--line: #dce7e2;");
    expect(rootRule).toContain("--surface: #ffffff;");
    expect(rootRule).toContain("--canvas: #f4f8f6;");

    expect(sharedRule).toContain("--desktop-ink: #21312d;");
    expect(sharedRule).toContain("--desktop-muted: #5f6f69;");
    expect(sharedRule).toContain("--desktop-celadon: #0d6a57;");
    expect(sharedRule).toContain("--desktop-celadon-dark: #174c3f;");
    expect(sharedRule).toContain("--desktop-line: #cbd8d3;");
    expect(shellRule).toContain("--ink-soft: var(--desktop-muted);");
    expect(shellRule).toContain("--muted: var(--desktop-muted);");
    expect(shellRule).toContain("--accent: var(--desktop-celadon);");
    expect(shellRule).toContain("--accent-strong: var(--desktop-celadon-dark);");
    expect(shellRule).toContain("--accent-pale: #d9eae3;");
    expect(shellRule).toContain("--line: var(--desktop-line);");
    expect(shellRule).toContain("--surface: #f8faf6;");
    expect(shellRule).toContain("--canvas: var(--desktop-paper);");
  });

  it("uses the approved transparent rail scenery over the authoritative shell colors", async () => {
    const [styles, design, webDesign] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(designPath, "utf8"),
      readFile(webDesignPath, "utf8"),
    ]);
    const shellRule = styles.match(/\.library-shell\s*\{\n  --ink:([\s\S]*?)\n\}/)?.[1] ?? "";
    const railRule = styles.match(/\.desktop-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const sceneryRule = styles.match(/\.desktop-rail-scenery\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(design).toContain("| `nav-surface` | `#E7EAE8` |");
    expect(design).toContain("| `desktop-canvas` | `#F1F1EF` |");
    expect(design).toContain("| `border` | `#CBD8D3` |");
    expect(design).toContain("常规边框为 `1px solid`，颜色统一使用 `border` Token");
    expect(webDesign).toContain("assets/backgrounds/desktop-left-rail-vintage-transparent-v2.png");
    expect(webDesign).toContain("可见圆面约 `38px`");
    expect(webDesign).toContain("封面外缘不加描边，只保留一层轻阴影");
    expect(shellRule).toContain("--canvas: var(--desktop-paper);");
    expect(railRule).toContain("background: #e7eae8;");
    expect(railRule).not.toContain("background-image:");
    expect(sceneryRule).toContain('background: url("/backgrounds/desktop-left-rail-vintage-transparent-v2.png") center bottom / 100% auto no-repeat;');
    expect(sceneryRule).toContain("bottom: -1px;");
    expect(sceneryRule).toContain("width: 122%;");
    expect(sceneryRule).toContain("opacity: .44;");
    expect(sceneryRule).toContain("mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.62) 18%, #000 38%, #000 100%);");
    expect(styles).not.toContain("desktop-left-rail-landscape-transparent-v4-preview");
    expect(styles).not.toContain("desktop-left-rail-landscape-approved-v1");
  });

  it("uses the independent approved right-canvas mountain without masks or global fading", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const mainSceneryRule = styles.match(/\.library-main::after\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const responsiveSceneryRules = [...styles.matchAll(/\.library-main::after\s*\{([\s\S]*?)\n\}/g)]
      .map((match) => match[1] ?? "")
      .join("\n");
    const companionRule = styles.match(/\.library-companion\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const at1200 = styles.match(/@media \(max-width: 1200px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const at1024 = styles.match(/@media \(max-width: 1024px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const at768 = styles.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(mainSceneryRule).toContain('background-image: url("/backgrounds/desktop-right-distant-mountains-transparent-v1.png");');
    expect(mainSceneryRule).not.toContain("desktop-left-rail-vintage-transparent-v2.png");
    expect(mainSceneryRule).toContain("right: 0;");
    expect(mainSceneryRule).toContain("bottom: 0;");
    expect(mainSceneryRule).toContain("width: 680px;");
    expect(mainSceneryRule).toContain("height: 136px;");
    expect(mainSceneryRule).toContain("background-size: contain;");
    expect(mainSceneryRule).toContain("background-position: right bottom;");
    expect(mainSceneryRule).toContain("background-repeat: no-repeat;");
    expect(mainSceneryRule).toContain("pointer-events: none;");
    expect(mainSceneryRule).toContain("opacity: 1;");
    expect(responsiveSceneryRules).not.toMatch(/mask|blur|filter/);
    expect(at1200).toContain(".library-main::after { width: 560px; height: 112px; }");
    expect(at1024).toContain(".library-main::after { width: 420px; height: 84px; }");
    expect(at768).toContain(".library-main::after { display: none; }");
    expect(companionRule).toContain("z-index: 12;");
  });

  it("ships the byte-identical approved transparent right-canvas asset", async () => {
    const bytes = await readFile(rightSceneryPath).catch(() => Buffer.alloc(0));

    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("2d6d70888bf55e4c629e27f883a2ccc1c3dee5e3e36d00e46e2f86d2f7229f0f");
  });

  it("uses the real Chrome toolbar and five-column shelf dimensions", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain("grid-template-columns: minmax(280px, 1fr) 152px;");
    expect(styles).toContain("min-height: 52px; display: grid;");
    expect(styles).toContain("min-width: 152px; min-height: 52px;");
    expect(styles).toContain("grid-template-columns: repeat(5, 160px);");
    expect(styles).toContain("width: 944px;");
    expect(styles).toContain("gap: 30px 36px;");
  });

  it("uses a compact toolbar and clear vertical rhythm below 1200px", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const compactRule = styles.match(/@media \(max-width: 1199px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const noteRule = styles.match(/\.weread-note\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const gridRule = styles.match(/\.book-grid\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(compactRule).toContain(".library-toolbar form, .import-button { min-height: 48px; }");
    expect(noteRule).toContain("margin-top: 12px;");
    expect(gridRule).toContain("margin-top: 22px;");
  });

  it("keeps the icon-only import control named and discoverable on narrow screens", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain('id="top-import-button" class="import-button ${libraryUploading ? "busy" : ""}" type="button" aria-label="导入书籍" title="导入书籍"');
    expect(main).toContain('id="empty-import-button" class="primary-button state-import" type="button"');
    expect(main).toContain('id="book-import" type="file"');
    expect(main).toContain('id="book-import" type="file" tabindex="-1" aria-hidden="true"');
    expect(main.match(/id="book-import"/g)).toHaveLength(1);
  });

  it("keeps the selected navigation state distinct from the rail", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".desktop-nav-link.active { color: var(--desktop-celadon-dark); background: #d9eae3;");
  });

  it("keeps a compact visible chat bubble on a 44px shoulder-aligned target", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const compactRule = styles.match(/@media \(max-width: 1199px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const narrowRule = styles.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(styles).toContain(".library-companion { position: fixed; z-index: 12; right: 22px; bottom: 14px; display: flex; align-items: end; gap: 0;");
    expect(styles).toContain(".library-companion-button { width: 44px; height: 44px; margin-left: -14px; align-self: center; transform: translateY(-4px);");
    expect(styles).toContain(".library-companion-button svg { width: 38px; height: 38px; padding: 9px; border-radius: 50%; background: #0d6a57;");
    expect(compactRule).toContain(".library-companion { right: 6px; bottom: 8px; }");
    expect(compactRule).toContain(".library-companion img { width: 72px; height: 72px; }");
    expect(compactRule).toContain(".library-companion-button { transform: none; }");
    expect(narrowRule).toContain(".library-companion { right: 0; }");
    expect(narrowRule).toContain(".library-companion img { width: 60px; height: 60px; }");
  });

  it("keeps the bound title and removes repeated cover metadata", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);

    expect(main).toContain('<h1 class="library-title">读书</h1>');
    expect(main).not.toContain('class="cover-source"');
    expect(main).not.toContain('<strong title="${escapeHtml(book.title)}">');
    expect(styles).toContain("aspect-ratio: 5 / 7;");
  });

  it("renders approved cover art under real title and author metadata", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);
    const coverRule = styles.match(/\.default-cover\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(main).toContain("coverAssetForBook(book.id)");
    expect(main).toContain('class="default-cover-art"');
    expect(coverRule).toContain("box-shadow: 0 8px 18px rgba(33,49,45,.08);");
    expect(coverRule).not.toContain("border:");
    expect(coverRule).not.toContain("gradient(");
    expect(coverRule).not.toContain("5px 5px 0");
    expect(styles).not.toContain(".default-cover::after");
  });

  it("keeps the 5:7 artwork full-height and overlays a restrained parse status inside it", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const artRule = styles.match(/\.default-cover-art\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const titleRule = styles.match(/\.default-cover strong\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const badgeRule = styles.match(/\.parse-badge\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(artRule).toContain("inset: 0;");
    expect(artRule).toContain("height: 100%;");
    expect(titleRule).toContain("-webkit-line-clamp: 3;");
    expect(titleRule).toContain("overflow: hidden;");
    expect(badgeRule).toContain("inset: auto 0 0;");
    expect(badgeRule).toContain("height: 24px;");
    expect(badgeRule).toContain("background: rgba(241,241,239,.48);");
    expect(badgeRule).toContain("background-image: linear-gradient(to left, rgba(241,241,239,.52) 0 62px, transparent 88px);");
    expect(badgeRule).toContain("font-size: 12px;");
    expect(badgeRule).toContain("line-height: 18px;");
    expect(badgeRule).toContain("font-weight: 500;");
    expect(badgeRule).not.toContain("backdrop-filter");
    expect(badgeRule).not.toContain("border-top:");
    expect(styles).toContain("linear-gradient(rgba(23,76,63,.20), rgba(23,76,63,.20)), rgba(241,241,239,.82)");
    expect(styles).toContain("background: #174c3f;");
    expect(styles).toContain("height: 3px;");
  });

  it("keeps the search progress local and the WeChat service copy in one left-aligned cluster", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);

    expect(main).toContain('aria-busy="${libraryState.searching}"');
    expect(main).toContain('class="library-search-status" role="status" aria-live="polite"');
    expect(main).toContain("正在搜索…");
    expect(main).toContain("开发中");
    expect(styles).toContain(".weread-note { width: min(944px, 100%);");
    expect(styles).toContain("justify-content: flex-start;");
    expect(styles).toContain("margin: 0 0 0 20px;");
  });

  it("restores the approved seated companion and 44px conversation bubble", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);

    expect(main).toContain('class="library-companion"');
    expect(main).toContain('class="library-companion-button"');
    expect(main).toContain('/mascot/laoji-mascot-seated-reading-transparent-v1.png');
    expect(main).toContain('aria-label="和老己聊聊"');
    expect(styles).toContain(".library-companion img { width: 104px; height: 104px;");
    expect(styles).toContain("width: 44px; height: 44px;");
    expect(styles).toContain("fill: none; stroke: currentColor;");
  });

  it("uses the shared SVG icon set for empty library states", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);

    expect(main).toContain('class="library-state-icon">${icons.search}');
    expect(main).toContain('class="library-state-icon">${icons.book}');
    expect(main).not.toContain('class="empty-glyph"');
    expect(styles).not.toContain(".empty-glyph");
  });
});
