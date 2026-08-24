import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesPath = new URL("./styles.css", import.meta.url);
const mainPath = new URL("./main.ts", import.meta.url);

describe("library binding visual contract", () => {
  it("keeps the reading canvas neutral and the approved rail scene fully framed", async () => {
    const styles = await readFile(stylesPath, "utf8");
    const shellRule = styles.match(/\.library-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const railRule = styles.match(/\.library-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(shellRule).toContain("background: #fbfbf8;");
    expect(shellRule).not.toContain("gradient(");
    expect(railRule).toContain("background-position: 37% bottom;");
    expect(railRule).toContain("background-size: cover;");
    expect(styles).toContain("background: rgba(217, 233, 225, .16);");
  });

  it("matches the approved rail identity scale and selected navigation surface", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".library-brand img { width: 74px; height: 74px;");
    expect(styles).toContain("background: #dce9e4;");
  });

  it("keeps the bound title and five-column continuous shelf at 1440", async () => {
    const [styles, main] = await Promise.all([
      readFile(stylesPath, "utf8"),
      readFile(mainPath, "utf8"),
    ]);

    expect(main).toContain('<h1 class="library-title">读书</h1>');
    expect(styles).toContain("grid-template-columns: repeat(5, minmax(132px, 180px));");
    expect(styles).toContain("gap: 44px 36px;");
  });

  it("puts a real source below every cover and omits the normal-state companion", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain('class="book-source"');
    expect(main).toContain("book.sourceLabel");
    expect(main).not.toContain('class="library-companion"');
  });

  it("continues the approved low-contrast mountain asset into the lower right paper", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".library-main::after");
    expect(styles).toContain('url("/backgrounds/desktop-left-rail-landscape-approved-v1.png")');
    expect(styles).toContain("mix-blend-mode: multiply;");
    expect(styles).toContain("mask-image: radial-gradient(");
  });
});
