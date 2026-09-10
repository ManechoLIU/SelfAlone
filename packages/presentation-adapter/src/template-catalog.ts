export const CANONICAL_PPT_TEMPLATE_IDS = Object.freeze([
  "celadon-reading",
  "editorial-paper",
  "minimal-ink",
] as const);

export type CanonicalPptTemplateId = (typeof CANONICAL_PPT_TEMPLATE_IDS)[number];

export type PptTemplateDefinition = {
  id: CanonicalPptTemplateId;
  aspectRatio: "16:9";
};

const PPT_TEMPLATE_CATALOG: readonly PptTemplateDefinition[] = Object.freeze([
  Object.freeze({ id: "celadon-reading", aspectRatio: "16:9" }),
  Object.freeze({ id: "editorial-paper", aspectRatio: "16:9" }),
  Object.freeze({ id: "minimal-ink", aspectRatio: "16:9" }),
]);

export function getPptTemplateCatalog(): PptTemplateDefinition[] {
  return PPT_TEMPLATE_CATALOG.map((template) => ({ ...template }));
}

export function isCanonicalPptTemplateId(value: string): value is CanonicalPptTemplateId {
  return (CANONICAL_PPT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function resolvePptTemplate(templateId: string): PptTemplateDefinition {
  if (!isCanonicalPptTemplateId(templateId)) {
    throw new Error("UNKNOWN_TEMPLATE");
  }
  const template = PPT_TEMPLATE_CATALOG.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error("UNKNOWN_TEMPLATE");
  return { ...template };
}
