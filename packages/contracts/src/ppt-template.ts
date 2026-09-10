export const PPT_TEMPLATE_IDS = Object.freeze([
  "celadon-reading",
  "editorial-paper",
  "minimal-ink",
] as const);

export type PptTemplateId = (typeof PPT_TEMPLATE_IDS)[number];

export type PptTemplateCatalogItem = {
  id: PptTemplateId;
  aspectRatio: "16:9";
};

export type ConfirmPptOutlineRequest = {
  expectedVersion: number;
};

export type SelectPptTemplateRequest = {
  expectedVersion: number;
  templateId: PptTemplateId;
};

export function isPptTemplateId(value: string): value is PptTemplateId {
  return (PPT_TEMPLATE_IDS as readonly string[]).includes(value);
}
