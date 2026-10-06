/**
 * 产品对比服务：读取已选产品、汇总结构化字段、组织知识证据、构建动态维度。
 * 不是独立 Comparison Agent。当前禁止固定评分、排名、K 值筛选或宣称最优。
 * 热工结果为可选注入，不作为对比前置步骤。
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { catalogProducts, knowledgeDocuments, productKnowledgeLinks } from "../../db/schema.js";
import { USER_LANGUAGE_NOTES } from "../../shared/ai-response-policy.js";
import {
  buildComparisonContext,
  buildProductComparisonDimensions,
  emptyThermalState,
  freezeProductComparisonResult,
  type ComparisonContext,
  type ComparisonProduct,
  type CompareProductsInput,
  type ProductComparisonResult,
  type ThermalCapabilityState
} from "./compare-product.js";

export type CompareProductDeps = {
  loadProducts?: (ids: string[]) => Promise<ComparisonProduct[]>;
  loadKnowledgeEvidence?: (products: ComparisonProduct[]) => Promise<Array<{
    productId: string;
    documentId: string;
    title: string;
    excerpt?: string | null;
  }>>;
};

async function defaultLoadProducts(app: FastifyInstance, ids: string[]): Promise<ComparisonProduct[]> {
  if (ids.length === 0) return [];
  const rows = await app.db.select({
    id: catalogProducts.id,
    name: catalogProducts.name,
    categoryId: catalogProducts.categoryId,
    summary: catalogProducts.summary,
    status: catalogProducts.status
  }).from(catalogProducts).where(and(
    inArray(catalogProducts.id, ids),
    eq(catalogProducts.status, "ACTIVE")
  ));
  const links = ids.length === 0
    ? []
    : await app.db.select({
      productId: productKnowledgeLinks.productId,
      knowledgeDocumentId: productKnowledgeLinks.knowledgeDocumentId
    }).from(productKnowledgeLinks).where(inArray(productKnowledgeLinks.productId, ids));
  const linkMap = new Map<string, string[]>();
  for (const link of links) {
    const list = linkMap.get(link.productId) ?? [];
    list.push(link.knowledgeDocumentId);
    linkMap.set(link.productId, list);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) {
      return {
        id,
        name: id,
        knowledgeDocumentIds: []
      };
    }
    return {
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      summary: row.summary,
      status: row.status,
      knowledgeDocumentIds: linkMap.get(row.id) ?? []
    };
  });
}

async function defaultLoadKnowledgeEvidence(
  app: FastifyInstance,
  products: ComparisonProduct[]
) {
  const documentIds = [...new Set(products.flatMap((item) => item.knowledgeDocumentIds ?? []))];
  if (documentIds.length === 0) return [];
  const docs = await app.db.select({
    id: knowledgeDocuments.id,
    title: knowledgeDocuments.title
  }).from(knowledgeDocuments).where(and(
    inArray(knowledgeDocuments.id, documentIds),
    isNull(knowledgeDocuments.deletedAt)
  ));
  const titleMap = new Map(docs.map((doc) => [doc.id, doc.title]));
  const evidence: Array<{ productId: string; documentId: string; title: string; excerpt?: string | null }> = [];
  for (const product of products) {
    for (const documentId of product.knowledgeDocumentIds ?? []) {
      const title = titleMap.get(documentId);
      if (!title) continue;
      evidence.push({
        productId: product.id,
        documentId,
        title
      });
    }
  }
  return evidence;
}

export async function compareProducts(
  app: FastifyInstance,
  input: CompareProductsInput,
  deps: CompareProductDeps = {}
): Promise<{ result: ProductComparisonResult; context: ComparisonContext }> {
  const productIds = [...new Set((input.productIds ?? []).filter(Boolean))];
  if (productIds.length < 2) {
    throw new Error("产品对比至少需要 2 个产品");
  }

  const products = await (deps.loadProducts ?? ((ids: string[]) => defaultLoadProducts(app, ids)))(productIds);

  const knowledgeEvidence = await (deps.loadKnowledgeEvidence
    ?? ((items: ComparisonProduct[]) => defaultLoadKnowledgeEvidence(app, items)))(products);
  const thermal: ThermalCapabilityState = input.thermal?.status
    ? {
      status: input.thermal.status,
      results: input.thermal.results ?? []
    }
    : emptyThermalState();

  const built = buildProductComparisonDimensions({
    products,
    focus: input.focus,
    confirmedRequirements: input.confirmedRequirements,
    knowledgeEvidence,
    thermal
  });

  const missingProducts = products.filter((item) => !item.status);
  const missingNotes = [
    ...built.missingNotes,
    ...missingProducts.map(() => USER_LANGUAGE_NOTES.missingProduct)
  ];

  const result = freezeProductComparisonResult({
    products,
    dimensions: built.dimensions,
    evidenceRefs: built.evidenceRefs,
    missingNotes,
    thermal,
    ranking: null,
    scores: null
  });

  const context = buildComparisonContext({
    conversationId: input.conversationId ?? "",
    projectId: input.projectId,
    userGoal: input.userGoal,
    confirmedRequirements: input.confirmedRequirements,
    productIds,
    result
  });

  return { result, context };
}

export function toProductCompareToolOutput(result: ProductComparisonResult): {
  ok: true;
  comparison: ProductComparisonResult;
  requiresUserSelection: boolean;
  multiple: true;
  minSelections: 1;
  sources: ProductComparisonResult["evidenceRefs"];
} {
  const selectable = result.products.filter((item) => item.status === "ACTIVE");
  return {
    ok: true,
    comparison: result,
    requiresUserSelection: selectable.length >= 1,
    multiple: true,
    minSelections: 1,
    sources: result.evidenceRefs
  };
}
