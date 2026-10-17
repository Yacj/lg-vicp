import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { knowledgeDocuments, knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import { buildKnowledgePageRenderModel, THERMAL_PAGE_FIELDS } from "../../shared/knowledge-page-render.js";
import { getPageImageDownloadName } from "../knowledge/knowledge-page-image.js";
import type { WikiHit } from "../knowledge/knowledge.service.js";
import { budgetKnowledgeTestReferences, formatConfirmedLookupAnswer, KnowledgeReferenceCitationStream, matchConfirmedPageOptions, thermalLookupPrimaryFields, type KnowledgeTestReferenceContext } from "../knowledge/knowledge-test-reference.js";
import { env } from "../../config/env.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import { buildHighlights, REFERENCE_PAGE_LIMIT, type ReferencePageBlock, type ReferencePageMatch } from "./reference-page.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import { readableRenderModel } from "../../shared/readable-page-render.js";
import { compactCandidateResult } from "./tools/thermal-lookup.js";
import { referenceSolutionCandidate, type SolutionCandidateSnapshot } from "./solution-workflow.js";
import { confirmedReferenceQuery } from "./structured-reference-query.js";
import type { ThermalQueryState } from "../thermal/thermal-query-state.js";
import { queryConfirmedPageFacts, confirmedFactExtremum, inspectConfirmedPageFacts, type ConfirmedPageFact } from "../knowledge/confirmed-page-facts.js";
import type { ConstraintCandidate } from "../thermal/thermal-query-state.js";

/** 只重查上次已展示/显式选择的资料范围；不把热工表未命中升级为全库宽查。 */
export async function querySelectedKnowledgeCandidates(app: FastifyInstance, query: ThermalQueryState, projectId: string | null) {
  if (!query.documentIds?.length && !query.knowledgeVersionIds?.length) return [];
  const ids = await app.db.select({ id: knowledgePages.id }).from(knowledgePages).where(and(
    query.documentIds?.length ? inArray(knowledgePages.documentId, query.documentIds) : undefined,
    query.knowledgeVersionIds?.length ? inArray(knowledgePages.versionId, query.knowledgeVersionIds) : undefined));
  const readable = await readConsumableReferencePages(app, ids.map(page => page.id), projectId);
  const snapshots = readable.flatMap(({ page, document }) => {
    const data = readPageRecognitionMeta(page.metadata).confirmedStructuredData;
    return data ? [{ page, data, model: buildKnowledgePageRenderModel(page.id, data)!, systemId: document.insulationSystemId }] : [];
  });
  return matchConfirmedPageOptions(snapshots, "", query, undefined).map(candidate => ({
    ...compactCandidateResult(candidate), candidateId: candidate.candidateId, sourceType: "REFERENCE" as const,
    referenceKind: "KNOWLEDGE_PAGE" as const, constructionCode: candidate.scheme.code, optionId: candidate.candidateId,
    sourceVersionId: candidate.sourceVersionId, sourcePageLabel: visiblePageLabel(readable.find(row => row.page.id === candidate.sourcePageId)!.page)
  }));
}

export async function readConsumableReferencePages(app: FastifyInstance, pageIds: readonly string[], projectId: string | null) {
  if (!pageIds.length) return [];
  const rows = await app.db.select({ page: knowledgePages, document: knowledgeDocuments, version: knowledgeDocumentVersions })
    .from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .innerJoin(knowledgeDocumentVersions, and(eq(knowledgeDocumentVersions.id, knowledgePages.versionId), eq(knowledgeDocumentVersions.documentId, knowledgePages.documentId)))
    .where(and(inArray(knowledgePages.id, [...new Set(pageIds)]), projectId ? or(isNull(knowledgeDocuments.projectId), eq(knowledgeDocuments.projectId, projectId)) : isNull(knowledgeDocuments.projectId)));
  return rows.filter(({ document, version }) => isReferencePageConsumable({
    versionId: version.id, versionStatus: version.status, usageMode: version.usageMode,
    documentStatus: document.status, documentDeletedAt: document.deletedAt, currentVersionId: document.currentVersionId,
    effectiveDate: version.effectiveDate, expiryDate: version.expiryDate, projectId: document.projectId
  }, undefined, projectId));
}

type SourceRow = Awaited<ReturnType<typeof readConsumableReferencePages>>[number];
export async function toReferencePageBlock(app: FastifyInstance, { page, document }: SourceRow): Promise<ReferencePageBlock> {
  let imageUrl = "";
  if (page.pageImageObjectKey) {
    try { imageUrl = await app.storage.createDownloadUrl(page.pageImageObjectKey, getPageImageDownloadName(page.pageImageObjectKey, page.physicalPageNumber), 3600); }
    catch { app.log.warn({ pageId: page.id }, "来源页图片暂不可用，保留确认表格"); }
  }
  return { type: "REFERENCE_PAGE", page: { documentId: document.id, pageId: page.id, documentTitle: document.title,
    versionId: page.versionId, pageLabelSource: page.pageLabelSource, pageLabelVerified: page.pageLabelVerified,
    docNumber: document.docNumber,
    pageNumber: page.physicalPageNumber, physicalPageNumber: page.physicalPageNumber,
    ...(visiblePageLabel(page) ? { pageLabel: visiblePageLabel(page)! } : {}), imageUrl },
    renderModel: readableRenderModel(page.id, page.metadata, visiblePageLabel(page)),
    matches: [], summary: {}, highlights: [] };
}

/** C 端只从本轮有权检索/选中的当前发布版本读取确认档位，不复用 B 端草稿接口。 */
export async function loadPublishedKnowledgeReferences(app: FastifyInstance, hits: readonly WikiHit[], projectId: string | null, message: string, lookup?: ReturnType<typeof normalizeConversationLookupQuery>["query"], options?: { completePublishedScope: boolean }): Promise<KnowledgeTestReferenceContext & {
  solutionCandidates?: SolutionCandidateSnapshot[]; diagnosticRows?: ConstraintCandidate[]; confirmedFacts?: ConfirmedPageFact[]; allConfirmedFacts?: ConfirmedPageFact[];
}> {
  // 语义已grounding的独立查表不能依赖全文检索top-N；继承/显式资料范围仍严格保留。
  const freshFactScope = options?.completePublishedScope || lookup?.parserSource === "LLM" && lookup.intent === "REFERENCE_LOOKUP"
    && !lookup.documentIds && !lookup.knowledgeVersionIds
    && Boolean(lookup.filters?.length || lookup.pageLabel || lookup.applicationPart || lookup.roofForm || lookup.placement || lookup.placements?.length || lookup.constructionCodes?.length || lookup.schemeCode || lookup.specClass);
  const versionIds = [...new Set(lookup?.knowledgeVersionIds ?? hits.map(hit => hit.versionId))];
  if (!versionIds.length && !freshFactScope) return { context: "", pages: [] };
  const normalized = confirmedReferenceQuery(message, lookup);
  const numeric = normalized.authoritative || Boolean(options?.completePublishedScope && lookup && !lookup.unresolved?.length);
  const sourceIds = [...new Set(hits.map(hit => hit.pageId).filter((id): id is string => Boolean(id)))];
  const rows = freshFactScope ? await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .where(and(eq(knowledgePages.versionId, knowledgeDocuments.currentVersionId), eq(knowledgeDocuments.status, "ACTIVE"), isNull(knowledgeDocuments.deletedAt),
      projectId ? or(isNull(knowledgeDocuments.projectId), eq(knowledgeDocuments.projectId, projectId)) : isNull(knowledgeDocuments.projectId),
      lookup?.documentIds ? inArray(knowledgePages.documentId, lookup.documentIds) : undefined,
      lookup?.knowledgeVersionIds ? inArray(knowledgePages.versionId, lookup.knowledgeVersionIds) : undefined,
      lookup?.pageLabel ? eq(knowledgePages.pageLabel, lookup.pageLabel) : undefined))
    : await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
      .where(and(inArray(knowledgePages.versionId, versionIds), numeric ? undefined : inArray(knowledgePages.id, sourceIds)));
  const readable = await readConsumableReferencePages(app, rows.map(row => row.id), projectId);
  const snapshots = readable.flatMap(({ page, document }) => {
    const data = readPageRecognitionMeta(page.metadata).confirmedStructuredData;
    return data ? [{ page, data, model: buildKnowledgePageRenderModel(page.id, data)!, systemId: document.insulationSystemId }] : [];
  });
  if (!snapshots.length && !numeric) return { context: "", pages: [] };
  const matchingDiagnostics = { excludedMissingCoreFields: 0, excludedMissingBaseMaterial: 0 };
  const inspection = numeric ? inspectConfirmedPageFacts(snapshots, normalized.query) : undefined;
  const pageFacts = numeric && (options?.completePublishedScope || snapshots.some(snapshot => snapshot.data.schemaVersion === 2)) ? inspection!.facts : undefined;
  const matched = numeric && !pageFacts ? matchConfirmedPageOptions(snapshots, message, normalized.query, normalized.structured, matchingDiagnostics) : undefined;
  const ids = pageFacts ? [...new Set(pageFacts.map(fact => fact.pageId))].slice(0, REFERENCE_PAGE_LIMIT)
    : matched ? [...new Set(matched.map(candidate => candidate.sourcePageId!))].slice(0, REFERENCE_PAGE_LIMIT) : sourceIds.slice(0, REFERENCE_PAGE_LIMIT);
  const pages = await Promise.all(ids.flatMap(id => {
    const row = readable.find(item => item.page.id === id);
    return row ? [toReferencePageBlock(app, row)] : [];
  }));
  if (numeric) pages.forEach(page => { if (!pageFacts) page.answerStyle = "THERMAL_SOLUTIONS"; page.primaryFieldKeys = thermalLookupPrimaryFields(normalized.query.filters, normalized.structured?.compareMetric); });
  const selectedIds = pageFacts ? pageFacts.filter(fact => ids.includes(fact.pageId)).map(fact => fact.option.optionId).slice(0, 12)
    : matched?.filter(candidate => ids.includes(candidate.sourcePageId!)).map(candidate => candidate.candidateId).slice(0, numeric ? 12 : 3);
  const budget = budgetKnowledgeTestReferences(pages, selectedIds, env.AI_CONTEXT_BUCKET_KNOWLEDGE_TOKENS);
  const solutionCandidates = matched?.filter(candidate => budget.citationOptionIds.includes(candidate.candidateId)).map(candidate => {
    const page = readable.find(({ page }) => page.id === candidate.sourcePageId)!.page;
    return { ...referenceSolutionCandidate(compactCandidateResult(candidate)), referenceKind: "KNOWLEDGE_PAGE" as const,
      thermalReferenceRowId: undefined, optionId: candidate.candidateId, sourceDocumentId: page.documentId, sourceVersionId: page.versionId,
      sourcePageLabel: visiblePageLabel(page) };
  });
  const totalMatched = pageFacts?.length ?? matched?.length ?? 0;
  const totalGroups = pageFacts ? new Set(pageFacts.map(fact => fact.construction.constructionId)).size : new Set(matched?.map(candidate => candidate.scheme.substrateMaterial)).size;
  // 后续改条件必须回到同一已消费版本查询，不能退回仅有示例行的全局热工表。
  const scopedQuery = { ...normalized.query, documentIds: [...new Set(readable.map(row => row.document.id))],
    knowledgeVersionIds: [...new Set(readable.map(row => row.version.id))] };
  return { pages, ...budget, authoritative: numeric, ...(pageFacts ? { readOnlyPageFacts: true } : {}), solutionCandidates, totalMatched, totalGroups, matchingDiagnostics, query: scopedQuery,
    queryDiagnostics: inspection?.diagnostics, diagnosticRows: inspection?.rows, confirmedFacts: inspection?.facts, allConfirmedFacts: inspection?.all,
    ...(numeric ? { answer: formatConfirmedLookupAnswer(pages, budget.citationOptionIds, normalized.query.filters ?? [],
      { scopeLabel: "本次参考资料中", emptyHint: "当前没有可核验的完整确认档位，可以调整厚度、构造或资料范围再查询。", compact: true,
        totalMatched, totalGroups, readFields: normalized.query.readFields, structured: normalized.structured, readOnlyPageFacts: Boolean(pageFacts), diagnostics: inspection?.diagnostics, extremum: pageFacts ? confirmedFactExtremum(pageFacts, normalized.query) : undefined }) } : {}) };
}

/** 元数据仅取正式标识，数值与表格重读当前确认快照；旧快照 ID 失效就省略引用。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function referencePageLocators(metadata: unknown) {
  const pages = asRecord(metadata)?.referencePages;
  return Array.isArray(pages) ? pages.flatMap(value => {
    const item = asRecord(value); if (!item) return [];
    const page = asRecord(item.page) ?? item;
    return typeof page.pageId === "string" && typeof page.documentId === "string" ? [{ item, pageId: page.pageId, documentId: page.documentId }] : [];
  }).slice(0, REFERENCE_PAGE_LIMIT) : [];
}

export function restoreReferencePageMatches(current: ReferencePageBlock, stored: Record<string, unknown>): ReferencePageBlock | null {
  const storedPage = asRecord(stored.page) ?? stored;
  if (storedPage.versionId != null && storedPage.versionId !== current.page.versionId) return null;
  const oldMatches = Array.isArray(stored.matches) ? stored.matches : [];
  const matches: ReferencePageMatch[] = oldMatches.flatMap(value => {
    const item = asRecord(value); if (!item || typeof item.optionId !== "string" || item.pageId !== current.page.pageId) return [];
    if (item.confirmedRevision != null && item.confirmedRevision !== current.renderModel?.confirmedRevision) return [];
    const construction = current.renderModel?.constructions.find(row => row.constructionId === item.constructionId);
    const option = construction?.options.find(row => row.optionId === item.optionId);
    if (!construction || !option) return [];
    const fieldKeys = THERMAL_PAGE_FIELDS.filter(key => Array.isArray(item.fieldKeys) && item.fieldKeys.includes(key) && option[key] != null);
    if (!fieldKeys.length) return [];
    const summary = { constructionCode: construction.constructionCode ?? undefined, systemType: construction.systemName ?? undefined,
      thicknessMm: option.thicknessMm ?? undefined, productThermalResistance: option.productThermalResistance ?? undefined,
      totalThermalResistance: option.totalThermalResistance ?? undefined, kValue: option.kValue ?? undefined,
      lambda: construction.material?.lambda ?? undefined, alpha: construction.material?.alpha ?? undefined };
    return [{ pageId: current.page.pageId, constructionId: construction.constructionId, optionId: option.optionId, fieldKeys,
      ...(current.renderModel?.confirmedRevision ? { confirmedRevision: current.renderModel.confirmedRevision } : {}),
      ...(typeof item.answerOffset === "number" && Number.isSafeInteger(item.answerOffset) && item.answerOffset >= 0 ? { answerOffset: item.answerOffset } : {}),
      summary, highlights: buildHighlights({ id: option.optionId, ...summary }, construction.sourceColumns) }];
  });
  if (oldMatches.some(value => typeof asRecord(value)?.optionId === "string") && !matches.length) return null;
  if (matches.length) return { ...current, matches, summary: matches[0]!.summary, highlights: matches[0]!.highlights,
    ...(stored.answerStyle === "THERMAL_SOLUTIONS" ? { answerStyle: "THERMAL_SOLUTIONS" as const,
      primaryFieldKeys: THERMAL_PAGE_FIELDS.filter(key => Array.isArray(stored.primaryFieldKeys) && stored.primaryFieldKeys.includes(key)) } : {}) };
  // 老消息仅有图片：保留原页入口，不通过旧 summary 数字推测当前档位。
  return current.page.imageUrl ? current : null;
}

export async function hydrateMessageReferencePages(app: FastifyInstance, messages: readonly { id: string; metadata: unknown }[], projectId: string | null) {
  const locators = messages.flatMap(message => referencePageLocators(message.metadata).map(locator => ({ ...locator, messageId: message.id })));
  const readable = await readConsumableReferencePages(app, locators.map(locator => locator.pageId), projectId);
  const pages = await Promise.all(readable.map(row => toReferencePageBlock(app, row)));
  const result = new Map<string, ReferencePageBlock[]>();
  for (const locator of locators) {
    const page = pages.find(item => item.page.pageId === locator.pageId && item.page.documentId === locator.documentId);
    if (!page) continue;
    const restored = restoreReferencePageMatches(page, locator.item);
    if (restored) result.set(locator.messageId, [...(result.get(locator.messageId) ?? []), restored]);
  }
  return result;
}

export function resolveConfirmedReferenceAnswer(answer: string, pages: readonly ReferencePageBlock[]) {
  const stream = new KnowledgeReferenceCitationStream();
  const text = stream.push(answer, true);
  return { text, pages: stream.resolve(pages).map(page => page.renderModel?.schemaVersion === 2 ? page : { ...page, answerStyle: "THERMAL_SOLUTIONS" as const }) };
}

export async function persistMessageReferencePages(app: FastifyInstance, references: readonly unknown[], projectId: string | null) {
  const locators = referencePageLocators({ referencePages: references });
  const rows = await readConsumableReferencePages(app, locators.map(locator => locator.pageId), projectId);
  return locators.flatMap(locator => {
    const row = rows.find(item => item.page.id === locator.pageId && item.document.id === locator.documentId);
    if (!row) return [];
    const renderModel = readableRenderModel(row.page.id, row.page.metadata, visiblePageLabel(row.page));
    const current: ReferencePageBlock = { type: "REFERENCE_PAGE", page: { documentId: row.document.id, pageId: row.page.id,
      documentTitle: row.document.title, versionId: row.page.versionId, pageNumber: row.page.physicalPageNumber, imageUrl: "" },
      renderModel, matches: [], summary: {}, highlights: [] };
    const hasMatches = Array.isArray(locator.item.matches) && locator.item.matches.length > 0;
    const restored = hasMatches ? restoreReferencePageMatches(current, locator.item) : undefined;
    if (hasMatches && !restored) return [];
    // 白名单投影，既兼容历史平铺结构也避免持久化临时URL或工具内部数据。
    return [{ documentId: locator.documentId, pageId: locator.pageId, documentTitle: row.document.title, docNumber: row.document.docNumber,
      versionId: row.page.versionId,
      pageLabel: row.page.pageLabel, physicalPageNumber: row.page.physicalPageNumber,
      pageImageObjectKey: row.page.pageImageObjectKey, renderModel,
      ...(locator.item.answerStyle === "THERMAL_SOLUTIONS" ? { answerStyle: "THERMAL_SOLUTIONS" as const } : {}),
      primaryFieldKeys: THERMAL_PAGE_FIELDS.filter(key => Array.isArray(locator.item.primaryFieldKeys) && locator.item.primaryFieldKeys.includes(key)),
      summary: restored?.summary ?? {}, highlights: restored?.highlights ?? [], matches: restored?.matches ?? [] }];
  });
}
