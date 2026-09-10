import { createRequire } from "node:module";
import { PPT_TEMPLATE_IDS } from "@selfalone/contracts";
import { describe, expect, it, vi } from "vitest";
import { getPptTemplateCatalog as exportedCatalog } from "./index";
import {
  CANONICAL_PPT_TEMPLATE_IDS,
  getPptTemplateCatalog,
  isCanonicalPptTemplateId,
  resolvePptTemplate,
} from "./template-catalog";

describe("canonical PPT template catalog", () => {
  it("resolves the canonical IDs through the declared contracts package", async () => {
    const requireFromPackage = createRequire(
      new URL("../package.json", import.meta.url),
    );
    expect(() => requireFromPackage.resolve("@selfalone/contracts")).not.toThrow();
    const contracts = await import("@selfalone/contracts");
    expect(CANONICAL_PPT_TEMPLATE_IDS).toBe(contracts.PPT_TEMPLATE_IDS);
  });

  it("exposes exactly three 16:9 templates in stable order", () => {
    expect(CANONICAL_PPT_TEMPLATE_IDS).toBe(PPT_TEMPLATE_IDS);
    expect(Object.isFrozen(CANONICAL_PPT_TEMPLATE_IDS)).toBe(true);
    expect(CANONICAL_PPT_TEMPLATE_IDS).toEqual([
      "celadon-reading",
      "editorial-paper",
      "minimal-ink",
    ]);
    expect(getPptTemplateCatalog()).toEqual([
      { id: "celadon-reading", aspectRatio: "16:9" },
      { id: "editorial-paper", aspectRatio: "16:9" },
      { id: "minimal-ink", aspectRatio: "16:9" },
    ]);
    expect(exportedCatalog()).toEqual(getPptTemplateCatalog());
    expect(new Set(getPptTemplateCatalog().map((item) => item.id)).size).toBe(3);
  });

  it("rejects unknown and legacy M0 IDs without a network or engine call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network disabled");
    });

    expect(isCanonicalPptTemplateId("celadon-reading")).toBe(true);
    expect(isCanonicalPptTemplateId("qingci-study")).toBe(false);
    expect(isCanonicalPptTemplateId("paper-notes")).toBe(false);
    expect(isCanonicalPptTemplateId("ink-minimal")).toBe(false);
    expect(isCanonicalPptTemplateId("modern-minimal")).toBe(false);
    expect(() => resolvePptTemplate("qingci-study")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => resolvePptTemplate("paper-notes")).toThrow("UNKNOWN_TEMPLATE");
    expect(() => resolvePptTemplate("ink-minimal")).toThrow("UNKNOWN_TEMPLATE");
    expect(resolvePptTemplate("editorial-paper")).toEqual({
      id: "editorial-paper",
      aspectRatio: "16:9",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
