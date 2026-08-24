import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesPath = new URL("./styles.css", import.meta.url);
const mainPath = new URL("./main.ts", import.meta.url);
const designPath = new URL("../../../redesign-v2/DESIGN.md", import.meta.url);

describe("library binding visual contract", () => {
  it("keeps the shared nav token authoritative and uses the surface token for content", async () => {
    const [styles, design] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(designPath, "utf8"),
    ]);
    const shellRule = styles.match(/\.library-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const railRule = styles.match(/\.library-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(design).toContain("| `nav-surface` | `#E7EAE8` |");
    expect(design).toContain("| `desktop-canvas` | `#F1F1EF` |");
    expect(shellRule).toContain("--library-rail: 184px;");
    expect(shellRule).toContain("background: #f1f1ef;");
    expect(railRule).toContain("background-color: #e7eae8;");
    expect(railRule).not.toContain("background-image:");
    expect(styles).not.toContain(".library-rail::before");
    expect(styles).not.toContain("desktop-left-rail-landscape-transparent-v4-preview");
    expect(styles).not.toContain("desktop-left-rail-landscape-approved-v1");
  });

  it("uses the real Chrome toolbar and five-column shelf dimensions", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain("grid-template-columns: minmax(280px, 1fr) 152px;");
    expect(styles).toContain("min-height: 52px; display: grid;");
    expect(styles).toContain("min-width: 152px; min-height: 52px;");
    expect(styles).toContain("grid-template-columns: repeat(5, 160px);");
    expect(styles).toContain("gap: 28px 55px;");
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

  it("keeps the selected navigation state distinct from the rail", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".library-nav a.active { color: #174c3f; background: #d4e5dc;");
  });

  it("compensates for the mascot asset transparent edge", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".library-companion { position: fixed; z-index: 12; right: 22px; bottom: 14px; display: flex; align-items: end; gap: 0;");
    expect(styles).toContain("margin-left: -14px;");
    expect(styles).toContain(".library-companion-button { margin-left: -8px; }");
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
