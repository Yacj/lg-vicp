import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { catalogProducts, knowledgeAliases, knowledgeDocuments, knowledgeDocumentVersions, knowledgeFacts, knowledgePages } from "../../db/schema.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import { validatePageRecognitionEvidence } from "../../shared/page-recognition-evidence.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import { canonicalLambdaUnit } from "../../shared/lambda-field.js";
import { listPublishedMaterials, listPublishedMaterialParameters, listPublishedProductParameters, listPublishedProductSpecs } from "../masterdata/md-read.service.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import { productParameterQuerySchema, validateProductParameterEvidence, type ProductParameterQuery } from "./product-parameter-query.js";
import { readQueryClarification } from "./query-clarification-context.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";

export type ParameterDiagnostic = "PARAMETER_NOT_INDEXED" | "VALUE_NO_MATCH" | "NAME_UNRESOLVED" | "SOURCE_SCOPE_LIMITED" | "FILTER_CONFLICT";
export interface LambdaFact {
  parameter: "LAMBDA"; unit: "W/(m·K)"; value: number;
  subjectType: Exclude<ProductParameterQuery["subjectType"], "ANY">;
  subjectId: string; name: string; systemName?: string; productId?: string; productName?: string; specId?: string;
  source: { kind: "CATALOG" | "SPEC_PARAMETER" | "MATERIAL_PARAMETER" | "KNOWLEDGE_FACT" | "CONFIRMED_LAYER";
    id: string; documentId?: string; versionId?: string; pageId?: string; pageLabel?: string | null;
    constructionId?: string; layerId?: string; title?: string; evidenceRef?: string | null };
  /** 仅明确同一参数身份、同值时合并展示；保留每一条有权来源。 */
  sources?: LambdaFact["source"][];
}
const labels: Record<LambdaFact["subjectType"], string> = {
  PRODUCT_EQUIVALENT: "产品当量", SPEC_EQUIVALENT: "规格当量", SPEC_NOMINAL: "规格标称", MATERIAL: "材料参数", MATERIAL_LAYER: "构造材料层"
};
const finiteValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const factValue = (value: unknown) => typeof value === "string" && value.trim() ? finiteValue(Number(value)) : finiteValue(value);

/** 各来源独立读取后按同一属性身份核验；不合并不同产品/材料层，也不把空来源当全局不存在。 */
type ParameterIdentity = Pick<LambdaFact, "subjectType" | "name" | "systemName" | "productName">;
export function evaluateLambdaFacts(query: ProductParameterQuery, input: readonly LambdaFact[], aliases: readonly { term: string; alias: string }[] = [], limited = false,
  knownIdentities: readonly ParameterIdentity[] = []) {
  const sameName = (expected: string, names: string[]) => names.some(name => normalizeEntityText(expected) === normalizeEntityText(name)
    || aliases.some(alias => normalizeEntityText(alias.term) === normalizeEntityText(name) && normalizeEntityText(alias.alias) === normalizeEntityText(expected)));
  const all = [...new Map(input.filter(row => finiteValue(row.value) != null).map(row => [JSON.stringify([row.source.kind, row.source.id, row.source.layerId, row.source.constructionId]), row])).values()];
  const matchesIdentity = (row: ParameterIdentity) => (query.subjectType === "ANY" || row.subjectType === query.subjectType)
    && (!query.subjectText || sameName(query.subjectText, [row.name, ...(row.productName ? [row.productName] : [])]))
    && (!query.systemText || !!row.systemName && sameName(query.systemText, [row.systemName]));
  const scoped = all.filter(matchesIdentity);
  const conflicts = new Set<string>();
  const identity = (row: LambdaFact) => JSON.stringify([row.subjectType, row.subjectId, row.specId ?? null]);
  const values = new Map<string, number>();
  for (const row of scoped) {
    const key = identity(row), previous = values.get(key);
    if (previous != null && previous !== row.value) conflicts.add(key);
    values.set(key, row.value);
  }
  const compare = (value: number) => {
    const target = query.targetValue!;
    switch (query.operator) {
      case "READ": return true;
      case "EXACT": return Math.abs(value - target) <= 1e-9;
      case "LT": return value < target;
      case "LTE": return value <= target;
      case "GT": return value > target;
      case "GTE": return value >= target;
      case "APPROX": return query.tolerance != null && Math.abs(value - target) <= query.tolerance + 1e-12;
    }
  };
  const missingTolerance = query.operator === "APPROX" && query.tolerance == null;
  const matchingSources = missingTolerance ? [] : scoped.filter(row => !conflicts.has(identity(row)) && compare(row.value));
  const grouped = new Map<string, LambdaFact>();
  for (const row of matchingSources) {
    const key = identity(row), previous = grouped.get(key);
    if (previous) previous.sources!.push(row.source);
    else grouped.set(key, { ...row, sources: [row.source] });
  }
  const matches = [...grouped.values()];
  const issues: ParameterDiagnostic[] = [];
  if (conflicts.size || missingTolerance) issues.push("FILTER_CONFLICT");
  if (!scoped.length) issues.push((query.subjectText || query.systemText) && !knownIdentities.some(matchesIdentity) ? "NAME_UNRESOLVED" : "PARAMETER_NOT_INDEXED");
  else if (!matches.length && !issues.length) issues.push("VALUE_NO_MATCH");
  if (limited) issues.push("SOURCE_SCOPE_LIMITED");
  return { query, facts: matches, diagnostics: { issues, scannedCount: all.length, identityCount: scoped.length, matchedCount: matches.length,
    excludedValueCount: scoped.filter(row => !conflicts.has(identity(row)) && !compare(row.value)).length,
    conflictCount: conflicts.size, matchedSourceCount: matchingSources.length, coverage: "AUTHORIZED_PUBLISHED_ONLY" as const, missingTolerance } };
}

export function renderLambdaAnswer(result: ReturnType<typeof evaluateLambdaFacts>): string {
  const { query, facts, diagnostics: d } = result;
  const heading = `本次查询导热系数 λ${query.targetValue == null ? "" : `，目标 ${query.targetValue} W/(m·K)`}。`;
  const lines = [heading];
  if (d.missingTolerance) lines.push("λ 的近似查询尚未给出数值范围或 ± 容差，请明确容差；不会套用图集 K/R 的默认窗口。");
  if (d.conflictCount) lines.push("同一参数身份存在来源值冲突，相关记录已排除，需核对正式来源。");
  if (d.issues.includes("NAME_UNRESOLVED")) lines.push("本次有权读取的参数来源未能证明所述名称或体系归属；请确认原名称或提供正式资料，不会自动更正名称或关联产品。");
  if (d.issues.includes("PARAMETER_NOT_INDEXED")) lines.push("本次可读来源未包含该归属的独立 λ 参数，不能据此判断其他资料是否存在记录。");
  if (d.issues.includes("VALUE_NO_MATCH")) lines.push("本次搜索范围有独立 λ 参数，但没有符合当前数值条件的记录。");
  for (const fact of facts.slice(0, 24)) {
    const source = (fact.sources ?? [fact.source]).map(item => {
      const title = item.title ?? item.evidenceRef ?? { CATALOG: "正式产品目录", SPEC_PARAMETER: "已发布规格参数", MATERIAL_PARAMETER: "已发布材料参数", KNOWLEDGE_FACT: "当前发布资料", CONFIRMED_LAYER: "当前确认原页" }[item.kind];
      return `${title}${item.pageLabel ? `，印刷页码 ${item.pageLabel}` : ""}`;
    }).join("；");
    lines.push(`- ${fact.name}（${labels[fact.subjectType]}）：λ=${fact.value} W/(m·K)。来源：${source}。`);
  }
  if (facts.length > 24) lines.push(`共匹配 ${facts.length} 条，当前列出24条；未以展示数量代替全部命中。`);
  if (d.issues.includes("SOURCE_SCOPE_LIMITED")) lines.push("部分来源的参数归属或证据不足，未参与匹配；结果仅覆盖本次可核验范围。");
  lines.push("产品当量、规格当量与材料层参数分别标明归属，不作跨归属等同、插值、热工计算或合规判断。");
  return lines.join("\n");
}

/** 与Tool共用；从服务器Domain提案取条件，执行时重验澄清原问和本人同端同项目权限。 */
export async function readProductParameters(ctx: ReferenceReadContext) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (conversation.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  const decision = ctx.domainDecision;
  if (decision?.intent !== "PRODUCT_PARAMETER_QUERY" || decision.mutation !== "NONE" || decision.semantic?.requestedEffect !== "READ_ONLY")
    throw new Error("本轮没有已核验的产品或材料参数读取目标");
  if (applyDomainPolicy(ctx.userMessage ?? "", decision.semantic, ctx.taskState).intent !== "PRODUCT_PARAMETER_QUERY")
    throw new Error("本轮参数提案未通过读取策略核验");
  const query = productParameterQuerySchema.parse(decision.semantic.parameterQuery);
  const pending = decision.semantic.queryContext === "CLARIFICATION_REPLY" ? await readQueryClarification(ctx.app, conversation, decision.queryCurrentMessageId) : null;
  if (decision.semantic.queryContext === "CLARIFICATION_REPLY" && (!pending || pending.messageId !== decision.queryContextMessageId))
    throw new Error("待澄清问题已失效，请重新说明参数目标");
  const error = validateProductParameterEvidence(ctx.userMessage ?? "", query, pending?.message);
  if (error) throw new Error(error);
  const db = ctx.app.db;
  // 不使用只筛VERIFIED的底层Fact resolver：必须同时重验当前发布版本和项目范围。
  const visibleProject = conversation.projectId ? or(isNull(knowledgeDocuments.projectId), eq(knowledgeDocuments.projectId, conversation.projectId)) : isNull(knowledgeDocuments.projectId);
  const publication = and(eq(knowledgeDocuments.status, "ACTIVE"), isNull(knowledgeDocuments.deletedAt),
    eq(knowledgeDocumentVersions.status, "PUBLISHED"), eq(knowledgeDocumentVersions.usageMode, "AI_ENABLED"), visibleProject);
  const [products, specs, materials, materialParameters, specParameters, aliases, pages, verifiedFacts] = await Promise.all([
    db.select().from(catalogProducts).where(eq(catalogProducts.status, "ACTIVE")),
    listPublishedProductSpecs(db, {}), listPublishedMaterials(db), listPublishedMaterialParameters(db, {}),
    listPublishedProductParameters(db, { parameterCode: "lambda_eq" }),
    db.select({ term: knowledgeAliases.term, alias: knowledgeAliases.alias }).from(knowledgeAliases).where(and(eq(knowledgeAliases.enabled, true), eq(knowledgeAliases.scope, "GLOBAL"))),
    db.select({ page: knowledgePages, document: knowledgeDocuments, version: knowledgeDocumentVersions }).from(knowledgePages)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
      .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgePages.versionId), eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId), eq(knowledgeDocumentVersions.documentId, knowledgeDocuments.id)))
      .where(publication),
    db.select({ fact: knowledgeFacts, document: knowledgeDocuments, version: knowledgeDocumentVersions }).from(knowledgeFacts)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeFacts.sourceDocumentId))
      .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgeFacts.sourceVersionId), eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId), eq(knowledgeDocumentVersions.documentId, knowledgeDocuments.id)))
      .where(and(publication, eq(knowledgeFacts.status, "VERIFIED"), inArray(knowledgeFacts.factType, ["MATERIAL", "THERMAL_PARAMETER"])))
  ]);
  const rows: LambdaFact[] = [];
  const known: ParameterIdentity[] = [
    ...products.map(row => ({ subjectType: "PRODUCT_EQUIVALENT" as const, name: row.name })),
    ...materials.map(row => ({ subjectType: "MATERIAL" as const, name: row.name })),
    ...specs.filter(row => !row.catalogProductId || products.some(product => product.id === row.catalogProductId))
      .flatMap(row => (["SPEC_EQUIVALENT", "SPEC_NOMINAL"] as const).map(subjectType => ({ subjectType, name: row.specCode,
        productName: products.find(product => product.id === row.catalogProductId)?.name })))
  ];
  let limited = false;
  const add = (value: unknown, row: Omit<LambdaFact, "value" | "parameter" | "unit">) => {
    known.push(row);
    const number = factValue(value);
    if (number == null) { limited = true; return; }
    rows.push({ ...row, value: number, parameter: "LAMBDA", unit: "W/(m·K)" });
  };
  for (const product of products) add(product.thermalConductivity, { subjectType: "PRODUCT_EQUIVALENT", subjectId: product.id, productId: product.id, name: product.name, source: { kind: "CATALOG", id: product.id } });
  for (const parameter of specParameters) {
    const spec = specs.find(spec => spec.id === parameter.specId);
    if (!spec || spec.catalogProductId && !products.some(product => product.id === spec.catalogProductId)) continue;
    if (parameter.unit && canonicalLambdaUnit(parameter.unit) !== "w/mk") { limited = true; continue; }
    add(parameter.value, { subjectType: "SPEC_EQUIVALENT", subjectId: spec.id, specId: spec.id, productId: spec.catalogProductId ?? undefined,
      productName: products.find(product => product.id === spec.catalogProductId)?.name,
      name: spec.specCode, source: { kind: "SPEC_PARAMETER", id: parameter.id, evidenceRef: parameter.evidenceRef } });
  }
  for (const parameter of materialParameters) {
    const material = materials.find(item => item.id === parameter.materialId);
    if (material) add(parameter.thermalConductivity, { subjectType: "MATERIAL", subjectId: material.id, name: material.name,
      source: { kind: "MATERIAL_PARAMETER", id: parameter.id, evidenceRef: parameter.evidenceRef } });
  }
  const readable = (document: typeof knowledgeDocuments.$inferSelect, version: typeof knowledgeDocumentVersions.$inferSelect) => isReferencePageConsumable({
    versionId: version.id, versionStatus: version.status, usageMode: version.usageMode, documentStatus: document.status, documentDeletedAt: document.deletedAt,
    currentVersionId: document.currentVersionId, effectiveDate: version.effectiveDate, expiryDate: version.expiryDate, projectId: document.projectId }, undefined, conversation.projectId);
  for (const { fact, document, version } of verifiedFacts) {
    if (!readable(document, version)) continue;
    const source = { kind: "KNOWLEDGE_FACT" as const, id: fact.id, documentId: document.id, versionId: version.id, pageLabel: fact.sourcePageLabel, title: document.title };
    const material = materials.find(item => item.id === fact.data.materialId || item.id === fact.subject);
    const spec = specs.find(item => item.id === fact.data.specId || item.id === fact.subject);
    if (fact.factType === "MATERIAL" && material) add(fact.data.thermalConductivity ?? fact.data.lambda, { subjectType: "MATERIAL", subjectId: material.id, name: material.name, source });
    else if (fact.factType === "THERMAL_PARAMETER" && fact.data.parameterCode === "lambda_eq" && spec
      && (!spec.catalogProductId || products.some(product => product.id === spec.catalogProductId)) && (!fact.data.unit || canonicalLambdaUnit(String(fact.data.unit)) === "w/mk"))
      add(fact.data.value, { subjectType: "SPEC_EQUIVALENT", subjectId: spec.id, specId: spec.id, name: spec.specCode,
        productId: spec.catalogProductId ?? undefined, productName: products.find(product => product.id === spec.catalogProductId)?.name, source });
    else limited = true;
  }
  for (const { page, document, version } of pages) {
    if (!readable(document, version)) continue;
    const data = readPageRecognitionMeta(page.metadata).confirmedStructuredData;
    if (!data) continue;
    if (data.schemaVersion === 2 && validatePageRecognitionEvidence(data).issues.length) { limited = true; continue; }
    const model = buildKnowledgePageRenderModel(page.id, data);
    for (const construction of model?.constructions ?? []) for (const layer of construction.layers) {
      if (layer.sourceRegion === "DIAGRAM") continue;
      add(layer.lambda, { subjectType: "MATERIAL_LAYER", subjectId: layer.layerId, name: layer.name, systemName: construction.systemName ?? undefined,
        source: { kind: "CONFIRMED_LAYER", id: page.id, documentId: document.id, versionId: version.id, pageId: page.id,
          pageLabel: visiblePageLabel(page), title: document.title, constructionId: construction.constructionId, layerId: layer.layerId } });
    }
  }
  const result = evaluateLambdaFacts(query, rows, aliases, limited, known);
  const sources = [...new Map(result.facts.flatMap(row => row.sources ?? [row.source]).filter(source => source.documentId).map(source => [JSON.stringify([source.documentId, source.versionId, source.pageId]),
    { documentId: source.documentId!, versionId: source.versionId!, pageId: source.pageId, title: source.title!, pageLabel: source.pageLabel }])).values()];
  return { ...result, sources, answer: renderLambdaAnswer(result) };
}
