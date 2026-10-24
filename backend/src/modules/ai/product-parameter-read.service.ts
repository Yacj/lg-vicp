import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
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
import { checkPendingQueryContinuity } from "./query-need.js";
import { previousParameterReadContext } from "./product-parameter-explanation.js";
import { readReferenceFactHistory } from "./reference-fact-history.js";
import { mergeParameterContinuation } from "./parameter-continuation.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { parameterSourceKinds } from "./product-parameter-diagnostics.js";
import { approvedCatalogAliases } from "../products/product-identity-approvals.js";

export type ParameterDiagnostic = "PARAMETER_NOT_INDEXED" | "VALUE_NO_MATCH" | "NAME_UNRESOLVED" | "SOURCE_SCOPE_LIMITED" | "FILTER_CONFLICT" | "RESULT_OBJECT_UNRESOLVED";
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
const parameterObservers = new WeakMap<object, (result: ReturnType<typeof evaluateLambdaFacts>) => void>();
/** 进程内验收观察器；请求和环境变量不能开启，生产默认不记录参数原文。 */
export function observeProductParameters(app: object, observer: (result: ReturnType<typeof evaluateLambdaFacts>) => void) {
  const key = (app as { server?: object }).server ?? app;
  parameterObservers.set(key, observer);
  return () => parameterObservers.delete(key);
}
const finiteValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const factValue = (value: unknown) => typeof value === "string" && value.trim() ? finiteValue(Number(value)) : finiteValue(value);

/** 各来源独立读取后按同一属性身份核验；不合并不同产品/材料层，也不把空来源当全局不存在。 */
type ParameterIdentity = Pick<LambdaFact, "subjectType" | "name" | "systemName" | "productName">;
/** 语义提案只截取型号时，只能用本轮逐字出现且唯一的有权完整名称补足；不按前缀猜对象。 */
export function completeParameterSubject(query: ProductParameterQuery, message: string, known: readonly ParameterIdentity[]) {
  if (!query.subjectText) return query;
  const text = normalizeEntityText(message), partial = normalizeEntityText(query.subjectText);
  const names = new Map<string, string>();
  for (const row of known) for (const name of [row.name, row.productName].filter((x): x is string => !!x)) {
    const normalized = normalizeEntityText(name);
    if (normalized && text.includes(normalized) && normalized.includes(partial)) names.set(normalized, name);
  }
  // 通用名称可同时是完整型号的子串，不能把这两段当成两个候选后退回通用名称。
  // 只使用本轮原文逐字出现的有权完整名称；不推断型号，也不改变参数口径。
  const complete = [...names.entries()].filter(([name]) => ![...names.keys()].some(other => other !== name && other.includes(name)));
  if (complete.length !== 1) return query;
  return { ...query, subjectText: complete[0]![1] };
}
export function evaluateLambdaFacts(query: ProductParameterQuery, input: readonly LambdaFact[], aliases: readonly { term: string; alias: string }[] = [], limited = false,
  knownIdentities: readonly ParameterIdentity[] = []) {
  const sameName = (expected: string, names: string[]) => names.some(name => normalizeEntityText(expected) === normalizeEntityText(name)
    || aliases.some(alias => normalizeEntityText(alias.term) === normalizeEntityText(name) && normalizeEntityText(alias.alias) === normalizeEntityText(expected)));
  const all = [...new Map(input.filter(row => finiteValue(row.value) != null).map(row => [JSON.stringify([row.source.kind, row.source.id, row.source.layerId, row.source.constructionId]), row])).values()];
  const matchesName = (row: ParameterIdentity) => (!query.subjectText || sameName(query.subjectText, [row.name, ...(row.productName ? [row.productName] : [])]))
    && (!query.systemText || !!row.systemName && sameName(query.systemText, [row.systemName]));
  const matchesIdentity = (row: ParameterIdentity) => (query.subjectType === "ANY" || row.subjectType === query.subjectType) && matchesName(row);
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
  // 名称存在与所问参数口径可用是两件事；识别名称不能把其他口径的数据变成命中。
  if (!scoped.length) issues.push((query.subjectText || query.systemText) && ![...knownIdentities, ...all].some(matchesName) ? "NAME_UNRESOLVED" : "PARAMETER_NOT_INDEXED");
  else if (!matches.length && !issues.length) issues.push("VALUE_NO_MATCH");
  if (limited) issues.push("SOURCE_SCOPE_LIMITED");
  return { query, facts: matches, diagnostics: { issues, scannedCount: all.length, identityCount: scoped.length, matchedCount: matches.length,
    excludedValueCount: scoped.filter(row => !conflicts.has(identity(row)) && !compare(row.value)).length,
    conflictCount: conflicts.size, matchedSourceCount: matchingSources.length, coverage: "AUTHORIZED_PUBLISHED_ONLY" as const, missingTolerance } };
}

export function renderLambdaAnswer(result: ReturnType<typeof evaluateLambdaFacts>): string {
  const { query, facts, diagnostics: d } = result;
  const comparison = { READ: "", EXACT: "=", LT: "<", LTE: "≤", GT: ">", GTE: "≥", APPROX: "≈" }[query.operator];
  const heading = `本次查询导热系数 λ${query.targetValue == null ? "" : ` ${comparison} ${query.targetValue} W/(m·K)`}。`;
  const lines = [heading];
  if (d.issues.includes("NAME_UNRESOLVED")) {
    lines.push(`“${query.systemText ?? query.subjectText}”这个名称还没对应到当前资料。请确认一下产品或体系名称，我会沿用刚才的参数范围继续查。`);
    return lines.join("\n");
  }
  if (d.missingTolerance) lines.push("λ 的近似查询尚未给出数值范围或 ± 容差，请明确容差；不会套用图集 K/R 的默认窗口。");
  if (d.conflictCount) lines.push("同一参数身份存在来源值冲突，相关记录已排除，需核对正式来源。");
  if (d.issues.includes("NAME_UNRESOLVED")) lines.push("本次有权读取的参数来源未能证明所述名称或体系归属；请确认原名称或提供正式资料，不会自动更正名称或关联产品。");
  if (d.issues.includes("PARAMETER_NOT_INDEXED")) {
    const name = query.systemText ?? query.subjectText;
    lines.push(name
      ? `资料里有“${name}”的记录，但没有单独给出${query.subjectType === "ANY" ? "所问范围" : labels[query.subjectType]}的导热系数。可以结合原表或具体规格，继续核对参数对应哪一部分。`
      : "现有资料没有单独提供所问范围的导热系数，可以指定产品、材料或原表继续核对。");
    return lines.join("\n");
  }
  if (d.issues.includes("VALUE_NO_MATCH")) {
    lines.push("现有可核对的资料中，没有符合当前数值条件的记录。可以换个数值范围，或告诉我具体产品、材料名称继续查。");
    return lines.join("\n");
  }
  const displayKey = (fact: LambdaFact) => `${fact.subjectType}:${normalizeEntityText(fact.name)}:${fact.value}`;
  const distinctFacts = [...new Map(facts.map(fact => [displayKey(fact), fact])).values()];
  const subjectTypes = new Set(facts.map(fact => fact.subjectType));
  if (subjectTypes.size > 1) {
    const counts = facts.reduce<Record<string, number>>((acc, fact) => { const key = labels[fact.subjectType]; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
    lines.push(`命中构成：${Object.entries(counts).map(([key, count]) => `${key} ${count} 条`).join("、")}；按名称+数值去重后 ${distinctFacts.length} 项。`);
  }
  for (const fact of distinctFacts.slice(0, 12)) {
    const source = (fact.sources ?? [fact.source]).map(item => {
      const title = item.title ?? item.evidenceRef ?? { CATALOG: "正式产品目录", SPEC_PARAMETER: "已发布规格参数", MATERIAL_PARAMETER: "已发布材料参数", KNOWLEDGE_FACT: "当前发布资料", CONFIRMED_LAYER: "当前确认原页" }[item.kind];
      return `${title}${item.pageLabel ? `，印刷页码 ${item.pageLabel}` : ""}`;
    }).join("；");
    lines.push(`- ${fact.name}（${labels[fact.subjectType]}）：λ=${fact.value} W/(m·K)。来源：${source}。`);
  }
  if (distinctFacts.length > 12) lines.push(`共找到 ${distinctFacts.length} 项，先列出12项。可以按产品、材料名称或数值范围继续筛选。`);
  if (facts.some(fact => fact.subjectType === "MATERIAL_LAYER"))
    lines.push("其中“构造材料层”只是原表材料层的 λ 参数，不是独立产品，也不能据此推荐完整构造方案；需要方案时请按传热系数 K 或热阻 R 查构造。");
  if (d.issues.includes("SOURCE_SCOPE_LIMITED")) lines.push("部分记录的来源或参数归属尚未核实，没有列入结果。");
  if (subjectTypes.size > 1) lines.push("这些参数对应不同对象，请按各自标注的归属和来源使用。");
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
  const activePending = await readQueryClarification(ctx.app, conversation, decision.queryCurrentMessageId);
  const continuityError = checkPendingQueryContinuity(ctx.userMessage ?? "", decision.semantic, activePending);
  if (continuityError) throw new Error(continuityError);
  const pending = decision.semantic.queryContext === "CLARIFICATION_REPLY" ? activePending : null;
  if (decision.semantic.queryContext === "CLARIFICATION_REPLY" && (!pending || pending.messageId !== decision.queryContextMessageId))
    throw new Error("待澄清问题已失效，请重新说明参数目标");
  const previous = decision.semantic.queryContext === "PREVIOUS_PARAMETER"
    ? previousParameterReadContext(await readReferenceFactHistory(ctx.app, conversation.id), conversation) : undefined;
  const refinement = previous ? mergeParameterContinuation(ctx.userMessage ?? "", query, previous.query) : undefined;
  if (decision.semantic.queryContext === "PREVIOUS_PARAMETER" && (!previous || previous.messageId !== decision.parameterContextMessageId
    || refinement?.error || !isDeepStrictEqual(refinement?.query, query))) throw new Error("上次参数查询条件已变化，请重新读取后继续。");
  const error = previous ? null : validateProductParameterEvidence(ctx.userMessage ?? "", query, pending?.message);
  if (error) throw new Error(error);
  // 不得把“只补充指标名”静默降级成全库 READ：没有对象、没有目标值时只问一个关键点。
  if (query.operator === "READ" && query.subjectType === "ANY" && !query.subjectText && !query.systemText) {
    return { query, facts: [], sources: [], diagnostics: { issues: ["PARAMETER_NOT_INDEXED" as const], scannedCount: 0, identityCount: 0,
      matchedCount: 0, excludedValueCount: 0, conflictCount: 0, matchedSourceCount: 0, coverage: "AUTHORIZED_PUBLISHED_ONLY" as const,
      missingTolerance: false, checkedSourceKinds: [...parameterSourceKinds] },
      answer: "这次只说了“导热系数”，还没说要看哪个产品/材料。请告诉我名称，或给出目标值（例如 λ 小于 0.3）；我不会把所有材料和构造层的 λ 一起列出来。" };
  }
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
  const result = evaluateLambdaFacts(completeParameterSubject(query, ctx.userMessage ?? "", known), rows, [...aliases, ...approvedCatalogAliases(products)], limited, known);
  parameterObservers.get((ctx.app as { server?: object }).server ?? ctx.app)?.(result);
  if ((pending?.need?.goal === "SCHEMES" || decision.semantic.readGoal === "SCHEMES") && result.facts.length) {
    return { query: result.query, facts: [], sources: [], diagnostics: { ...result.diagnostics,
      issues: ["RESULT_OBJECT_UNRESOLVED" as const], checkedSourceKinds: [...parameterSourceKinds] },
      answer: "我会保留你给的导热系数范围。λ 是材料或产品的参数，还需要确认你想筛方案中哪一层的 λ；这些参数记录本身不能直接当作完整方案。也可以按整构造的 K 或热阻继续找。" };
  }
  const diagnostics = { ...result.diagnostics, checkedSourceKinds: [...parameterSourceKinds] };
  const sources = [...new Map(result.facts.flatMap(row => row.sources ?? [row.source]).filter(source => source.documentId).map(source => [JSON.stringify([source.documentId, source.versionId, source.pageId]),
    { documentId: source.documentId!, versionId: source.versionId!, pageId: source.pageId, title: source.title!, pageLabel: source.pageLabel }])).values()];
  return { ...result, diagnostics, sources, answer: renderLambdaAnswer(result) };
}
