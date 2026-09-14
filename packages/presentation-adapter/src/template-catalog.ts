import {
  PPT_TEMPLATE_IDS,
  isPptTemplateId,
  type PptTemplateCatalogItem,
  type PptTemplateId,
} from "@selfalone/contracts";

export const CANONICAL_PPT_TEMPLATE_IDS = PPT_TEMPLATE_IDS;

export type CanonicalPptTemplateId = PptTemplateId;

export type PptTemplateDefinition = PptTemplateCatalogItem;

function freezeTemplate(template: PptTemplateDefinition): PptTemplateDefinition {
  return Object.freeze({
    ...template,
    preview: Object.freeze({
      colorTokens: Object.freeze([...template.preview.colorTokens]),
      layoutTokens: Object.freeze([...template.preview.layoutTokens]),
    }),
  });
}

const PPT_TEMPLATE_CATALOG: readonly PptTemplateDefinition[] = Object.freeze([
  freezeTemplate({
    id: "celadon-reading",
    label: "青瓷书卷",
    description: "适合读书分享与传统文化主题，留白充足、层次清晰。",
    aspectRatio: "16:9",
    preview: {
      colorTokens: ["paper-warm", "celadon", "ink"],
      layoutTokens: ["book-spread", "generous-whitespace"],
    },
  }),
  freezeTemplate({
    id: "editorial-paper",
    label: "编辑纸页",
    description: "适合研究汇报与观点表达，以纸张质感强化信息层级。",
    aspectRatio: "16:9",
    preview: {
      colorTokens: ["paper-white", "charcoal", "vermilion"],
      layoutTokens: ["editorial-grid", "annotation-margin"],
    },
  }),
  freezeTemplate({
    id: "minimal-ink",
    label: "极简水墨",
    description: "适合简洁演示与方法论表达，用克制水墨突出核心结论。",
    aspectRatio: "16:9",
    preview: {
      colorTokens: ["rice-paper", "ink", "mist-gray"],
      layoutTokens: ["minimal-canvas", "ink-wash-anchor"],
    },
  }),
]);

function copyTemplate(template: PptTemplateDefinition): PptTemplateDefinition {
  return {
    ...template,
    preview: {
      colorTokens: [...template.preview.colorTokens],
      layoutTokens: [...template.preview.layoutTokens],
    },
  };
}

export function getPptTemplateCatalog(): PptTemplateDefinition[] {
  return PPT_TEMPLATE_CATALOG.map(copyTemplate);
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
  return copyTemplate(template);
}
