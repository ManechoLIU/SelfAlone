import {
  PPT_TEMPLATE_IDS,
  isPptTemplateId,
  type PptTemplateId,
} from "../../contracts/src/ppt-template";

export const CANONICAL_PPT_TEMPLATE_IDS = PPT_TEMPLATE_IDS;

export type CanonicalPptTemplateId = PptTemplateId;

export type PptTemplateDefinition = {
  id: CanonicalPptTemplateId;
  aspectRatio: "16:9";
};

const PPT_TEMPLATE_CATALOG: readonly PptTemplateDefinition[] = Object.freeze(
  PPT_TEMPLATE_IDS.map((id) => Object.freeze({ id, aspectRatio: "16:9" as const })),
);

export function getPptTemplateCatalog(): PptTemplateDefinition[] {
  return PPT_TEMPLATE_CATALOG.map((template) => ({ ...template }));
}

export function isCanonicalPptTemplateId(value: string): value is CanonicalPptTemplateId {
  return isPptTemplateId(value);
}

export function resolvePptTemplate(templateId: string): PptTemplateDefinition {
  if (!isCanonicalPptTemplateId(templateId)) {
    throw new Error("UNKNOWN_TEMPLATE");
  }
  const template = PPT_TEMPLATE_CATALOG.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error("UNKNOWN_TEMPLATE");
  return { ...template };
}
