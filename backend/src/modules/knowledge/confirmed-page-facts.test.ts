import "dotenv/config";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import { applySemanticQuery, type SemanticQuery } from "../thermal/semantic-query.js";
import { queryConfirmedPageFacts, confirmedFactExtremum } from "./confirmed-page-facts.js";
import { loadKnowledgeTestReferences, KnowledgeReferenceCitationStream } from "./knowledge-test-reference.js";
import { loadPublishedKnowledgeReferences, restoreReferencePageMatches } from "../ai/ai-reference-pages.service.js";
import { currentConfirmedPageLookup } from "../ai/confirmed-page-lookup-state.js";
import { validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { parseSemanticQuery } from "../ai/semantic-query.service.js";
import { groundedPageAttribute } from "../../shared/confirmed-page-query.js";
import { applyDomainPolicy } from "../ai/ai-domain-policy.js";
import { domainSemanticFixture } from "../ai/domain-semantic.fixture.js";

export const atlasSnapshots = () => [89, 90, 75].map(p => {
  const data = JSON.parse(readFileSync(new URL(`../../../tests/fixtures/complex-atlas/page-${p}.json`, import.meta.url), "utf8")).data as PageRecognitionResult;
  const page = { id: `page-${p}`, versionId: "version", documentId: "document", pageLabel: String(p), physicalPageNumber: p };
  return { page, data, model: buildKnowledgePageRenderModel(page.id, data)! };
});
export function atlasApp() {
  const rows = atlasSnapshots().map(s => ({ page: { ...s.page, pageImageObjectKey: `fixture/${s.page.id}.png`, pageLabelSource: "MANUAL", pageLabelVerified: true, metadata: { confirmedStructuredData: s.data } },
    document: { id: "document", title: "人工图集基线Fixture", status: "ACTIVE", deletedAt: null, currentVersionId: "version", projectId: null as string | null },
    version: { id: "version", status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null } }));
  const app: any = { db: { select: (selection: any) => {
    const result = !selection ? rows.map(r => r.page) : Object.keys(selection).join() === "id" ? rows.map(r => ({ id: r.page.id })) : rows;
    const chain: any = { from: () => chain, innerJoin: () => chain, where: () => Promise.resolve(result) }; return chain;
  } }, storage: { createDownloadUrl: vi.fn(async () => "https://fixture.invalid/original?signature=temporary") }, log: { warn: vi.fn() } };
  return { app, rows };
}
const query = (patch: ThermalQueryState = {}): ThermalQueryState => ({ intent: "REFERENCE_LOOKUP", parserSource: "LLM", ...patch });
const semantic = (constraints: SemanticQuery["constraints"], queryMode: SemanticQuery["queryMode"] = "NEW_QUERY"): SemanticQuery => ({ queryMode, intent: "REFERENCE_LOOKUP", constraints, preferences: [], unresolved: [], confidence: .99 });
const entity = (field: any, entityText: string, evidence = entityText, operation: any = "SET"): SemanticQuery["constraints"][number] => ({ type: "ENTITY", field, entityText, evidence, operation, resolvedText: null, metric: null, operator: null, value: null, hard: true, confidence: .99 });

describe("确认图集只读事实（人工源图Fixture，非真实模型或DB）", () => {
  it("同页标题的体系名称可作为证据，构造原标签不必重复VICP；其他体系仍不匹配", () => {
    expect(queryConfirmedPageFacts(atlasSnapshots(), query({systemHint:"VICP",roofForm:"SLOPED",specClass:"I",thicknessMm:20}))).toHaveLength(2);
    expect(queryConfirmedPageFacts(atlasSnapshots(), query({systemHint:"不存在的体系",roofForm:"SLOPED",thicknessMm:20}))).toHaveLength(0);
  });
  it.each([
    [89, "UPRIGHT", 20, 5.225, .191], [89, "INVERTED", 20, 5.198, .192], [89, "UPRIGHT", 25, 6.025, .166], [89, "INVERTED", 25, 5.998, .167],
    [90, "UPRIGHT", 20, 5.369, .186], [90, "INVERTED", 20, 5.369, .186], [90, "UPRIGHT", 25, 6.169, .162], [90, "INVERTED", 25, 6.169, .162],
    [75, "C1-3", 20, 6.916, .145], [75, "C1-4", 20, 7.540, .133], [75, "C1-3", 25, 8.516, .117], [75, "C1-4", 25, 9.140, .109]
  ])("%s %s %smm精确绑定确认构造和R/K", (p, group, thickness, r, k) => {
    const rows = queryConfirmedPageFacts(atlasSnapshots(), query({ pageLabel: String(p), thicknessMm: Number(thickness),
      ...(p === 75 ? { schemeCode: String(group) } : { placement: group as "UPRIGHT" | "INVERTED" }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.option).toMatchObject({ totalThermalResistance: r, kValue: k, productThermalResistance: null });
    expect(rows[0]!.option.optionId).toContain(rows[0]!.construction.constructionId);
  });
  it("保留六构造38档、同值双身份，v2不回填完整产品R或假编号", () => {
    const snapshots = atlasSnapshots(), before = JSON.stringify(snapshots);
    const rows = queryConfirmedPageFacts(snapshots, query());
    expect(rows).toHaveLength(38);
    expect(new Set(rows.map(r => r.construction.constructionId)).size).toBe(6);
    const flat = queryConfirmedPageFacts(snapshots, query({ applicationPart: "ROOF", roofForm: "FLAT", thicknessMm: 20 }));
    expect(flat).toHaveLength(2); expect(flat[0]!.option.kValue).toBe(flat[1]!.option.kValue);
    expect(flat[0]!.option.optionId).not.toBe(flat[1]!.option.optionId);
    expect(flat.every(r => r.construction.constructionCode == null)).toBe(true);
    expect(JSON.stringify(snapshots)).toBe(before);
  });
  it("属性由语义字段逐项grounding；型号不等于防水等级；追问保留型号/坡屋面", () => {
    const text = "I型坡屋面正置和倒置20mm参数";
    const first = applySemanticQuery(text, semantic([entity("specClass", "I型"), entity("applicationPart", "坡屋面"), entity("roofForm", "坡屋面"),
      { ...entity(null, "20mm"), type: "THICKNESS", field: null, entityText: null, value: 20, operator: "EXACT" }]), { entities: [], aliases: [] });
    expect(first.unresolved).toEqual([]); expect(queryConfirmedPageFacts(atlasSnapshots(), first)).toHaveLength(2);
    const next = applySemanticQuery("改成25厚，只看倒置", semantic([entity("placement", "倒置"),
      { ...entity(null, "25厚"), type: "THICKNESS", field: null, entityText: null, value: 25, operator: "EXACT" }], "REFINE_QUERY"), { entities: [], aliases: [] }, first);
    expect(next).toMatchObject({ specClass: "I", roofForm: "SLOPED", placement: "INVERTED", thicknessMm: 25 });
    expect(queryConfirmedPageFacts(atlasSnapshots(), next)[0]!.option.kValue).toBe(.167);
    expect(applySemanticQuery("I型", semantic([entity("waterproofGrade", "I型")]), { entities: [], aliases: [] }).unresolved?.length).toBeGreaterThan(0);
    expect(applySemanticQuery("Ⅰ 型", semantic([entity("specClass", "Ⅰ 型")]), { entities: [], aliases: [] }).specClass).toBe("I");
    expect(groundedPageAttribute("waterproofGrade", "Ⅰ 级防水")).toBe("I级防水");
    expect(groundedPageAttribute("waterproofGrade", "一级防水")).toBe("I级防水");
    const multi = applySemanticQuery("I型和II型", semantic([entity("specClass", "II型", "II型", "APPEND"), entity("specClass", "I型")]), { entities: [], aliases: [] });
    expect(multi.specClasses).toEqual(["I", "II"]);
    expect(queryConfirmedPageFacts(atlasSnapshots(), { ...multi, applicationPart: "ROOF", thicknessMm: 20 })).toHaveLength(4);
  });
  it("新会话倒置25厚并列不同型号；未知防水/产品R不猜；正式候选缺属性也不能满足", () => {
    expect(queryConfirmedPageFacts(atlasSnapshots(), query({ placement: "INVERTED", thicknessMm: 25 }))).toHaveLength(2);
    expect(queryConfirmedPageFacts(atlasSnapshots(), query({ waterproofGrade: "I级防水" }))).toHaveLength(0);
    expect(queryConfirmedPageFacts(atlasSnapshots(), query({ filters: [{ metric: "PRODUCT_R", mode: "MIN_LIMIT", targetValue: 1 }] }))).toHaveLength(0);
    expect(validateCandidateAgainstQueryState({ thicknessMm: 20 }, query({ placement: "INVERTED" })).passed).toBe(false);
    const fallback = atlasSnapshots(); fallback[0]!.page = { ...fallback[0]!.page, pageLabelVerified: false } as any;
    expect(queryConfirmedPageFacts(fallback, query({ pageLabel: "89" }))).toHaveLength(0);
  });
  it("完整集合确定性比较、同厚度不串基层；缺字段不给极值", () => {
    const q = query({ applicationPart: "EXTERNAL_WALL", thicknessMm: 20, preferences: { preferLowerK: true } });
    const rows = queryConfirmedPageFacts(atlasSnapshots(), q);
    expect(rows[0]!.construction.constructionCode).toBe("C1-4");
    expect(confirmedFactExtremum(rows, q)).toMatchObject({ metric: "K", value: .133, tiedCount: 1 });
    expect(confirmedFactExtremum(rows, query({ preferences: { preferHigherR: true, higherRMetric: "PRODUCT_R" } }))).toBeUndefined();
  });
  it("B/C共用同一RenderModel及来源语义，不产生solutionCandidates；原图签名不影响全表", async () => {
    const { app } = atlasApp(); const q = query({ pageLabel: "90", thicknessMm: 20 });
    const b = await loadKnowledgeTestReferences(app, "version", "人工图集基线Fixture", [], "II型平屋面20mm", q);
    const c = await loadPublishedKnowledgeReferences(app, [{ documentId: "document", versionId: "version", pageId: "page-90" }] as any, null, "II型平屋面20mm", q);
    expect(b.readOnlyPageFacts).toBe(true); expect(c.solutionCandidates).toBeUndefined();
    expect(b.pages[0]!.renderModel).toEqual(c.pages[0]!.renderModel);
    const stream = new KnowledgeReferenceCitationStream(); const answer = stream.push(c.answer!, true); const pages = stream.resolve(c.pages);
    expect(answer).toContain("传热阻 R"); expect(answer).not.toContain("R₀"); expect(answer).not.toContain("产品层热阻");
    expect(pages[0]!.matches).toHaveLength(2); expect(pages[0]!.renderModel!.constructions.flatMap(r => r.options)).toHaveLength(12);
    expect(pages[0]!.renderModel!.notes).toHaveLength(4);
    expect(pages[0]!.matches[0]!.confirmedRevision).toBe(pages[0]!.renderModel!.confirmedRevision);
    expect(restoreReferencePageMatches(pages[0]!, { matches: pages[0]!.matches.map(m => ({ ...m, confirmedRevision: "stale" })) })).toBeNull();
    expect(app.db.insert).toBeUndefined(); expect(app.db.update).toBeUndefined();
  });
  it("B端只对v2确认页调用语义扩展；旧版本复用原路径，失败提案不读取数值", async () => {
    const { app, rows } = atlasApp(); const resolve = vi.fn(async () => query({ pageLabel: "90", thicknessMm: 20 }));
    expect((await loadKnowledgeTestReferences(app, "version", "Fixture", [], "参数", resolve)).totalMatched).toBe(2);
    expect(resolve).toHaveBeenCalledTimes(1);
    for (const row of rows) delete row.page.metadata.confirmedStructuredData.schemaVersion;
    resolve.mockClear(); await loadKnowledgeTestReferences(app, "version", "Fixture", [], "参数", resolve);
    expect(resolve).not.toHaveBeenCalled();
    const failed = await loadKnowledgeTestReferences(app, "version", "Fixture", [], "参数", query({ unresolved: [{ field: "query", reason: "待澄清" }] }));
    expect(failed.pages).toEqual([]); expect(failed.answer).toBe("待澄清");
  });
  it.each(["DRAFT", "DISABLED", "BROWSE_ONLY", "PROJECT", "STALE_VERSION"])("%s不得读取发布事实或签名", async state => {
    const { app, rows } = atlasApp();
    for (const row of rows) {
      if (state === "PROJECT") row.document.projectId = "private";
      else if (state === "STALE_VERSION") row.document.currentVersionId = "other";
      else if (state === "BROWSE_ONLY") row.version.usageMode = state;
      else row.version.status = state;
    }
    const result = await loadPublishedKnowledgeReferences(app, [{ versionId: "version", pageId: "page-90" }] as any, null, "参数", query({ pageLabel: "90" }));
    expect(result.pages).toEqual([]); expect(app.storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it("只读追问状态绑定本人同端同会话项目及24h，不产生Candidate授权", () => {
    const conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app" };
    const value = { query: query({ roofForm: "SLOPED" }), conversationId: "c", userId: "u", projectId: null, clientApp: "c_app", createdAt: new Date().toISOString() };
    expect(currentConfirmedPageLookup(value, conversation)?.query.roofForm).toBe("SLOPED");
    expect(currentConfirmedPageLookup(value, { ...conversation, userId: "other" })).toBeUndefined();
    expect(currentConfirmedPageLookup(value, { ...conversation, clientApp: "b_admin" })).toBeUndefined();
    expect(currentConfirmedPageLookup(value, conversation, Date.now() + 25 * 3600000)).toBeUndefined();
  });
  it("现有Domain提案直接复用语义校验，不调用第二个模型；编号集合不受提案顺序影响", async () => {
    const message = "C1-3与C1-4";
    const proposed = semantic([entity("schemeCode", "C1-4", "C1-4", "APPEND"), entity("schemeCode", "C1-3")]);
    const ctx: any = { app: {}, conversation: { id: "c", userId: "u", projectId: null, clientApp: "c_app" },
      userMessage: message, domainDecision: { mutation: "QUERY", semantic: { pageQuery: proposed, relation: "NEW" } } };
    const resolved = await parseSemanticQuery(ctx, {}, { entities: [], aliases: [] });
    expect(resolved.needsClarification).toBe(false);
    expect(resolved.query.constructionCodes).toEqual(["C1-3", "C1-4"]);
    expect(resolved.query.schemeCode).toBeUndefined();
    expect(queryConfirmedPageFacts(atlasSnapshots(), { ...resolved.query, thicknessMm: 20 })).toHaveLength(2);
    expect(applySemanticQuery(message, semantic([entity("schemeCode", "C1-3"), entity("schemeCode", "C1-4")]), { entities: [], aliases: [] }).unresolved?.length).toBeGreaterThan(0);
    ctx.domainDecision.semantic.pageQuery = { ...proposed, intent: "THERMAL" };
    expect((await parseSemanticQuery(ctx, {}, { entities: [], aliases: [] })).needsClarification).toBe(true);
    const wrongScope = domainSemanticFixture("先整理参考建议", "SOLUTION_ADVICE", { pageQuery: proposed });
    expect(applyDomainPolicy("先整理参考建议", wrongScope).policyReason).toBe("PAGE_QUERY_SCOPE_INVALID");
  });
});
