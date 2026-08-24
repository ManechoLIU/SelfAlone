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

    expect(design).toContain("| `nav-surface` | `#CFE1D7` |");
    expect(design).not.toContain("| `nav-surface` | `#F5F8F6` |");
    expect(shellRule).toContain("--library-rail: 184px;");
    expect(shellRule).toContain("background: #f8faf6;");
    expect(railRule).toContain("background-color: #cfe1d7;");
    expect(railRule).toContain("background-position: 37% bottom;");
    expect(railRule).toContain("background-size: cover;");
  });

  it("uses the real Chrome toolbar and five-column shelf dimensions", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain("grid-template-columns: minmax(280px, 1fr) 152px;");
    expect(styles).toContain("min-height: 52px; display: grid;");
    expect(styles).toContain("min-width: 152px; min-height: 52px;");
    expect(styles).toContain("grid-template-columns: repeat(5, 160px);");
    expect(styles).toContain("gap: 28px 55px;");
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

  it("keeps a deterministic asset-variant boundary and a restrained fallback", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);
    const coverRule = styles.match(/\.default-cover\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(main).toContain("function coverVariantClass(bookId: string)");
    expect(main).toContain("coverVariantClass(book.id)");
    expect(main).toContain("% 5");
    expect(coverRule).toContain("box-shadow: 0 8px 18px rgba(33,49,45,.08);");
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
    expect(main).toContain('/mascot/laoji-mascot-seated-reading-transparent-v1.png');
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
