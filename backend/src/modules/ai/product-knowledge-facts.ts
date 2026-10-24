import { and, eq, isNull, or } from "drizzle-orm";
import { knowledgeDocuments, knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import type { KnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { readableRenderModel } from "../../shared/readable-page-render.js";
import { confirmedPageSourceAudit } from "../../shared/confirmed-page-source-audit.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { resolveQueryEntities, type QueryEntity } from "../thermal/thermal-entity-resolver.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";

export type ProductParameterKey = "LAMBDA" | "CORRECTION" | "THICKNESS";
export interface ProductKnowledgeSource {
  documentId: string; versionId: string; pageId: string; pageLabel: string | null; title: string;
  revision: string; constructionId: string; layerId: string; constructionName: string;
  specClass?: "I" | "II" | "III";
  issues?: string[];
}
export interface ProductKnowledgeAttribute {
  key: ProductParameterKey; value: number; unit: string;
  scope: "MATERIAL_LAYER" | "CONSTRUCTION_OPTION"; source: ProductKnowledgeSource;
}
/** 原表产品/可变材料层的只读对象，不提供可销售SKU、正式Candidate或计算授权。 */
export interface ProductKnowledgeItem {
  id: string; name: string; kind: "KNOWLEDGE_LAYER"; attributes: ProductKnowledgeAttribute[];
  sources: ProductKnowledgeSource[]; warnings: string[];
  sourceCount?: number;
}
/** 会话与回答只保存每个已展示参数值的代表来源，完整适用条件仍回读当前原页。 */
export function compactProductKnowledgeItem(item: ProductKnowledgeItem): ProductKnowledgeItem {
  const unique = new Map<string, ProductKnowledgeAttribute>();
  for (const attribute of item.attributes) {
    const key = JSON.stringify([attribute.key, attribute.value, attribute.scope]);
    if (!unique.has(key)) unique.set(key, attribute);
  }
  const attributes = [...unique.values()];
  const sources = [...new Map(attributes.map(attribute => [JSON.stringify(attribute.source), attribute.source])).values()];
  return { ...item, attributes, sources: sources.length ? sources : item.sources.slice(0, 1), sourceCount: item.sources.length };
}
export function projectKnowledgeProducts(model: KnowledgePageRenderModel, source: Omit<ProductKnowledgeSource, "constructionId" | "layerId" | "constructionName">): ProductKnowledgeItem[] {
  return model.constructions.flatMap(construction => construction.layers.filter(layer => layer.variable === true).map(layer => {
    const origin = { ...source, constructionId: construction.constructionId, layerId: layer.layerId,
      constructionName: construction.constructionCode ?? construction.systemName ?? model.pageTitle ?? "原表构造",
      specClass: construction.specClass ?? undefined };
    const attributes: ProductKnowledgeAttribute[] = [];
    if (layer.lambda != null && Number.isFinite(layer.lambda) && layer.lambda > 0)
      attributes.push({ key: "LAMBDA", value: layer.lambda, unit: "W/(m·K)", scope: "MATERIAL_LAYER", source: origin });
    if (layer.alpha != null && Number.isFinite(layer.alpha) && layer.alpha > 0)
      attributes.push({ key: "CORRECTION", value: layer.alpha, unit: "", scope: "MATERIAL_LAYER", source: origin });
    for (const option of construction.options) if (option.thicknessMm != null && Number.isFinite(option.thicknessMm) && option.thicknessMm > 0)
      attributes.push({ key: "THICKNESS", value: option.thicknessMm, unit: "mm", scope: "CONSTRUCTION_OPTION", source: origin });
    return { id: `knowledge:${origin.pageId}:${layer.layerId}`, name: layer.name, kind: "KNOWLEDGE_LAYER" as const,
      attributes, sources: [origin], warnings: [...(model.warnings ?? [])] };
  }));
}

export async function readProductKnowledgeItems(ctx: ReferenceReadContext, entityText?: string | null) {
  const rows = await ctx.app.db.select({ page: knowledgePages, document: knowledgeDocuments, version: knowledgeDocumentVersions })
    .from(knowledgePages).innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgePages.versionId),
      eq(knowledgeDocuments.currentVersionId, knowledgeDocumentVersions.id), eq(knowledgeDocumentVersions.documentId, knowledgeDocuments.id)))
    .where(and(eq(knowledgeDocuments.status, "ACTIVE"), isNull(knowledgeDocuments.deletedAt),
      eq(knowledgeDocumentVersions.status, "PUBLISHED"), eq(knowledgeDocumentVersions.usageMode, "AI_ENABLED"),
      ctx.conversation.projectId ? or(isNull(knowledgeDocuments.projectId), eq(knowledgeDocuments.projectId, ctx.conversation.projectId)) : isNull(knowledgeDocuments.projectId)));
  const items: ProductKnowledgeItem[] = [];
  for (const row of rows) {
    if (!isReferencePageConsumable({ versionId: row.version.id, versionStatus: row.version.status, usageMode: row.version.usageMode,
      documentStatus: row.document.status, documentDeletedAt: row.document.deletedAt, currentVersionId: row.document.currentVersionId,
      effectiveDate: row.version.effectiveDate, expiryDate: row.version.expiryDate, projectId: row.document.projectId }, undefined, ctx.conversation.projectId)) continue;
    const confirmed = readPageRecognitionMeta(row.page.metadata).confirmedStructuredData;
    const model = confirmed ? readableRenderModel(row.page.id, row.page.metadata, visiblePageLabel(row.page), row.version.id) : null;
    if (!model) continue;
    // constructionId中含完整确认内容指纹；旧确认页不补写revision，但读取身份仍随内容变化。
    const revision = model.confirmedRevision ?? model.constructions[0]?.constructionId ?? "";
    const auditedIssues = confirmedPageSourceAudit({ pageId: row.page.id, versionId: row.version.id, metadata: row.page.metadata })?.issues ?? [];
    items.push(...projectKnowledgeProducts({ ...model, warnings: auditedIssues }, { documentId: row.document.id, versionId: row.version.id, pageId: row.page.id,
      pageLabel: visiblePageLabel(row.page), title: row.document.title, revision, issues: auditedIssues }));
  }
  const q = entityText ? normalizeEntityText(entityText) : "";
  const specEntities: QueryEntity[] = ["I", "II", "III"].map(value => ({ field: "specClass", value, names: [`${value}型`] }));
  const spec = resolveQueryEntities(entityText ?? "", {}, specEntities).specClass;
  const exactName = q && items.some(item => normalizeEntityText(item.name) === q);
  // 仅检索原文名称线索；不把子串命中升级为正式产品身份或别名映射。
  return items.filter(item => (!q || (exactName ? normalizeEntityText(item.name) === q : normalizeEntityText(item.name).includes(q)))
    && (!spec || (item.sources[0]?.specClass ?? resolveQueryEntities(item.name, {}, specEntities).specClass) === spec));
}

export function groupProductKnowledgeItems(items: readonly ProductKnowledgeItem[]) {
  const groups = new Map<string, ProductKnowledgeItem>();
  for (const item of items) {
    const key = normalizeEntityText(item.name);
    const previous = groups.get(key);
    if (previous) { previous.attributes.push(...item.attributes); previous.sources.push(...item.sources);
      previous.warnings = [...new Set([...previous.warnings, ...item.warnings])]; }
    else groups.set(key, structuredClone(item));
  }
  return [...groups.values()];
}
