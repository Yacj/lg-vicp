import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { resolveStructuredReferenceQuery } from "./structured-reference-query.js";
import { structuredReferenceFixture } from "./structured-reference.fixture.js";
import { formatConfirmedLookupAnswer, KnowledgeReferenceCitationStream, loadKnowledgeTestReferences, matchConfirmedPageOptions } from "../knowledge/knowledge-test-reference.js";
import { loadPublishedKnowledgeReferences, resolveConfirmedReferenceAnswer } from "./ai-reference-pages.service.js";
import { parseSemanticQuery } from "./semantic-query.service.js";
import type { ReferencePageBlock } from "./reference-page.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: vi.fn(async () => ({ projectId: null })) }));

const message = "Ⅲ型 VICP 薄抹灰，45mm 厚，不同基层传热系数有什么区别？";
function fixtureApp(change: Record<string, unknown> = {}) {
  const snapshots = structuredReferenceFixture();
  const rows = snapshots.map(({ page }) => ({ page, document: { id: page.documentId, title: "模拟图集", projectId: null,
    status: "ACTIVE", deletedAt: null, currentVersionId: page.versionId, insulationSystemId: null },
    version: { id: page.versionId, status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null, ...change } }));
  const where = vi.fn((condition: any) => {
    const sql = new PgDialect().sqlToQuery(condition);
    // 验证生产查询实际绑定了哪些版本/页面，避免mock把单页查询也返回两页。
    return rows.filter(row => (!sql.sql.includes('"knowledge_pages"."version_id"') || sql.params.includes(row.page.versionId))
      && (!sql.sql.includes('"knowledge_pages"."id"') || sql.params.includes(row.page.id)));
  });
  const sign = vi.fn(async () => "https://fixture.test/signed");
  const app = { db: { select: (fields: any) => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: async (condition: any) => {
      const selected = where(condition);
      return fields?.id ? selected.map(row => ({ id: row.page.id })) : fields?.page ? selected : selected.map(row => row.page);
    } }; return chain;
  } }, log: { warn: vi.fn() }, storage: { createDownloadUrl: sign } } as any;
  return { app, rows, sign, where };
}
const hits = [{ documentId: "fixture-document", versionId: "fixture-version", pageId: "fixture-page-5" }] as any;

describe("跨页结构化热工参考数据", () => {
  it.each([message, "Ⅲ型 45mm 哪种基层的 K 最低？", "同样45mm，不同基层K有什么区别？"])("判定为数据查询：%s", text => {
    const last = { query: { specClass: "III" as const, thicknessMm: 45, schemeCode: "A3-2", targetK: 0.294 }, candidates: [] };
    expect(resolveStructuredReferenceQuery(text, last)).toMatchObject({ queryKind: "REFERENCE_COMPARISON" });
    const spec = resolveStructuredReferenceQuery(text, last)!;
    expect(spec.query.schemeCode).toBeUndefined(); expect(spec.query.filters).toEqual([]); expect(spec.query.targetK).toBeUndefined();
  });
  it.each(["K 和 R₀ 的区别？", "传热系数 K 是什么意思？", "不同材料有什么区别？", "Ⅲ型45mm不同构造施工有什么区别？"])("概念问答不扩页：%s", text => {
    expect(resolveStructuredReferenceQuery(text)).toBeNull();

  });
  it("序号比较/原页只读，计算仍要求明确授权，不完整问题澄清", () => {
    expect(domainDecision("COMPARE_CANDIDATES", "第一个和第三个比较").intent).toBe("COMPARE_CANDIDATES");
    expect(domainDecision("REFERENCE_VIEW", "A3-2的原页给我看看").intent).toBe("REFERENCE_VIEW");
    expect(domainDecision("THERMAL_CALCULATE", "帮我算55mm A3-2的K").intent).toBe("THERMAL_CALCULATE");
    expect(domainDecision("CLARIFY", "45mm不同基层K有什么区别").intent).toBe("CLARIFY");
  });
  it("四个45mm档位跨两页，各参数和optionId原子绑定", async () => {
    const { app } = fixtureApp();
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    expect(result).toMatchObject({ authoritative: true, totalMatched: 4, totalGroups: 4 });
    expect(result.solutionCandidates?.map(row => [row.schemeCode, row.thicknessMm, row.totalThermalResistance, row.kValue, row.sourcePageId])).toEqual([
      ["A3-1", 45, 3.313, 0.302, "fixture-page-5"], ["A3-2", 45, 3.398, 0.294, "fixture-page-5"],
      ["外墙A3-3", 45, 3.416, 0.293, "fixture-page-6"], ["外墙A3-4", 45, 4.040, 0.248, "fixture-page-6"]
    ]);
    const resolved = resolveConfirmedReferenceAnswer(result.answer!, result.pages);
    expect(resolved.text).toContain("共 4 条、4 种基层，当前展示 4 条");
    expect(resolved.text).toContain("R₀=4.040"); expect(resolved.text).not.toContain("0.999"); expect(resolved.text).not.toContain("[[KP:");
    expect(resolved.pages.map(page => [page.page.pageLabel, page.matches.length])).toEqual([["5", 2], ["6", 2]]);
    for (const candidate of result.solutionCandidates!) {
      const page = resolved.pages.find(page => page.page.pageId === candidate.sourcePageId)!;
      expect(page.matches.find(match => match.optionId === candidate.optionId)?.summary.kValue).toBe(candidate.kValue);
    }
  });
  it("构造编号存于systemName时，只使用同页确认标题核验体系，不能用标题覆盖另一明确体系", async () => {
    const { app, rows } = fixtureApp();
    rows.forEach(row => row.page.metadata.confirmedStructuredData.systems.forEach(system => {
      system.systemName = `外墙${system.constructionCode!.replace(/^外墙/, "")}`;
    }));
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    expect(result.totalMatched).toBe(4); expect(result.solutionCandidates).toHaveLength(4);
    expect(result.solutionCandidates!.every(candidate => candidate.systemName === "Ⅲ型VICP薄抹灰外保温系统")).toBe(true);
    rows[1]!.page.metadata.confirmedStructuredData.systems[0]!.systemName = "Ⅲ型外贴聚苯板保温系统";
    expect((await loadPublishedKnowledgeReferences(app, hits, null, message)).totalMatched).toBe(3);
  });
  it("最低K限定于四构造，A3-4和带外墙/全半角/空白编码均可命中；18mm不受比较影响", async () => {
    const { app } = fixtureApp();
    const result = await loadPublishedKnowledgeReferences(app, hits, null, "Ⅲ型 45mm 哪种基层的 K 最低？");
    expect(result.solutionCandidates?.[0]).toMatchObject({ schemeCode: "外墙A3-4", kValue: 0.248 });
    expect(result.answer).toContain("在本次已匹配范围内，外墙A3-4 的传热系数 K最低");
    for (const code of ["A3-4", "外墙A3-4", "ａ３－４", "A3 - 4"]) {
      const query = await loadPublishedKnowledgeReferences(app, hits, null, `Ⅲ型 ${code} 45mm 的总热阻是多少？`);
      expect(query.totalMatched).toBe(1); expect(query.answer).toContain("4.040");
    }
    const single = await loadPublishedKnowledgeReferences(app, hits, null, "Ⅲ型 A3-2 18mm 是多少？");
    expect(single.totalMatched).toBe(1); expect(single.answer).toContain("0.626"); expect(single.answer).toContain("1.598");
  });
  it("B测试与C使用同一匹配语义；B只扩指定版本", async () => {
    const { app, where } = fixtureApp();
    const result = await loadKnowledgeTestReferences(app, "fixture-version", "模拟图集", hits, message);
    expect(result).toMatchObject({ totalMatched: 4, totalGroups: 4 });
    expect(result.citationOptionIds).toEqual(matchConfirmedPageOptions(structuredReferenceFixture(), message).map(row => row.candidateId));
    expect(where).toHaveBeenCalledTimes(1);
    expect((await loadKnowledgeTestReferences(app, "other-version", "模拟", hits, message)).totalMatched).toBe(0);
  });
  it("同会话解除单构造及旧目标，仅继承明确的体系/相同厚度，不访问模型/目录", async () => {
    const last = { query: { systemHint: "Ⅲ型VICP薄抹灰外保温系统", specClass: "III", schemeCode: "A3-2", thicknessMm: 45,
      targetK: 0.294, filters: [{ metric: "K", targetValue: 0.294, mode: "EXACT" }] }, candidates: [] };
    const resolution = await parseSemanticQuery({ app: {}, conversation: {}, taskState: { lastReferenceLookup: last }, userMessage: "相同厚度不同基层比较" } as any);
    expect(resolution).toMatchObject({ needsClarification: false, parserSource: "FAST_PATH" });
    expect(resolution.query.schemeCode).toBeUndefined(); expect(resolution.query.filters).toEqual([]);
    const { app } = fixtureApp();
    const result = await loadPublishedKnowledgeReferences(app, hits, null, "相同厚度不同基层比较", resolution.query);
    expect(result.solutionCandidates).toHaveLength(4);
    const fresh = resolveStructuredReferenceQuery("新话题，45mm不同基层K有什么区别", last)!;
    expect(fresh.needsClarification).toBe(true); expect(fresh.query.systemHint).toBeUndefined(); expect(fresh.query.specClass).toBeUndefined();
    const minimum = resolveStructuredReferenceQuery("Ⅲ型45mm哪种基层K最低", last)!;
    expect(minimum.query.systemHint).toBe(last.query.systemHint); expect(minimum.query.schemeCode).toBeUndefined(); expect(minimum.query.filters).toEqual([]);
    expect((await loadPublishedKnowledgeReferences(app, hits, null, "Ⅲ型45mm哪种基层K最低", minimum.query)).totalMatched).toBe(4);
  });
  it("第二个原页使用本轮实际显示的候选及revision，不重查档位或修改旧选择", async () => {
    const { app, where } = fixtureApp();
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    const state = { taskType: "GENERAL", lastReferenceLookup: { query: result.query, candidates: result.solutionCandidates,
      selectedCandidateIds: [result.solutionCandidates![3]!.id], candidateQueryRevision: 2, projectId: null, createdAt: new Date().toISOString() } };
    const before = JSON.stringify(state);
    where.mockClear();
    const read = await resolveReferenceQueryWithoutAgent({ app, conversation: { id: "c", projectId: null }, user: { id: "u" },
      domainDecision: domainDecision("REFERENCE_VIEW", "第二个原页"), taskState: state, userMessage: "第二个原页", candidateQueryRevision: 2 } as any);
    expect(read.facts.candidates[0]).toMatchObject({ schemeCode: "A3-2", thicknessMm: 45, kValue: 0.294 });
    expect(read.referencePages[0]?.matches[0]?.optionId).toBe(result.solutionCandidates![1]!.optionId);
    expect(where).toHaveBeenCalledTimes(1); expect(JSON.stringify(state)).toBe(before);
  });
  it.each([{ status: "DRAFT" }, { status: "DISABLED" }, { usageMode: "BROWSE_ONLY" }, { expiryDate: "2000-01-01" }, { effectiveDate: "2999-01-01" }])("无效来源不贡献匹配或签名：%j", async change => {
    const { app, sign } = fixtureApp(change);
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    expect(result.totalMatched).toBe(0); expect(result.pages).toEqual([]); expect(sign).not.toHaveBeenCalled();
  });
  it("跨项目、换版和只有OCR的资料不可形成正式事实", async () => {
    for (const reason of ["project", "version", "ocr"]) {
      const { app, rows, sign } = fixtureApp();
      rows.forEach(row => {
        if (reason === "project") (row.document as any).projectId = "other-project";
        if (reason === "version") row.document.currentVersionId = "new-version";
        if (reason === "ocr") (row.page as any).metadata = { fullText: "K=0.294 R0=3.398" };
      });
      const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
      expect(result.totalMatched).toBe(0); expect(result.answer).toContain("未找到"); expect(sign).not.toHaveBeenCalled();
    }
  });
  it("错体系/错厚度/缺字段排除；复合事实去重，同编号不同基层仍保留", () => {
    const snapshots = structuredReferenceFixture();
    const extra = structuredClone(snapshots[0]!);
    extra.page.id = "duplicate-page";
    extra.model = buildModel(extra);
    const duplicate = matchConfirmedPageOptions([...snapshots, extra], message);
    expect(duplicate).toHaveLength(4);
    extra.data.systems[0]!.baseMaterial = "另一个基层";
    extra.data.systems[1]!.specClass = "I";
    extra.model = buildModel(extra);
    expect(matchConfirmedPageOptions([...snapshots, extra], message)).toHaveLength(5);
    extra.data.systems[0]!.options![0]!.totalThermalResistance = null;
    extra.model = buildModel(extra);
    expect(matchConfirmedPageOptions([...snapshots, extra], message)).toHaveLength(4);
  });
  it("不同体系同为A1-3，正式名称/型号约束不允许混入外贴聚苯板", () => {
    const snapshots = structuredReferenceFixture();
    const extra = structuredClone(snapshots[0]!);
    snapshots[0]!.data.systems[0]!.constructionCode = "A1-3";
    snapshots[0]!.model = buildModel(snapshots[0]!);
    extra.page.id = "different-system";
    extra.data.systems = [{ ...extra.data.systems[0]!, constructionCode: "A1-3", systemName: "Ⅲ型外贴聚苯板保温系统", specClass: "III" }];
    extra.model = buildModel(extra);
    expect(matchConfirmedPageOptions([...snapshots, extra], message)).toHaveLength(4);
    extra.data.systems[0]!.systemName = "I型VICP薄抹灰外保温系统"; extra.data.systems[0]!.specClass = "I"; extra.model = buildModel(extra);
    expect(matchConfirmedPageOptions([...snapshots, extra], message)).toHaveLength(4);
    extra.data.systems[0]!.specClass = undefined; extra.model = buildModel(extra);
    expect(matchConfirmedPageOptions([...snapshots, extra], "Ⅲ型45mm哪种基层K最低")).toHaveLength(4);
  });
  it("相同K也分别绑定各自optionId，缺字段有排除诊断", async () => {
    const { app, rows } = fixtureApp();
    rows[0]!.page.metadata.confirmedStructuredData.systems[1]!.options![0]!.kValue = 0.302;
    rows[1]!.page.metadata.confirmedStructuredData.systems[0]!.options![0]!.productThermalResistance = null;
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    expect(result.matchingDiagnostics?.excludedMissingCoreFields).toBe(1);
    const refs = resolveConfirmedReferenceAnswer(result.answer!, result.pages).pages;
    const sameK = refs.flatMap(page => page.matches).filter(match => match.summary.kValue === 0.302);
    expect(sameK).toHaveLength(2); expect(new Set(sameK.map(match => match.optionId)).size).toBe(2);
    expect(sameK.map(match => match.summary.constructionCode)).toEqual(["A3-1", "A3-2"]);
  });
  it("真实匹配超过展示上限，先计全部22项再截断，候选与正文实际展示一致", async () => {
    const { app, rows } = fixtureApp();
    rows.forEach((row, index) => {
      const data = row.page.metadata.confirmedStructuredData;
      for (let n = 0; n < 9; n++) data.systems.push({ ...structuredClone(data.systems[0]!), constructionCode: `B${index + 1}-${n + 1}`, baseMaterial: `模拟基层${index}-${n}` });
    });
    const result = await loadPublishedKnowledgeReferences(app, hits, null, message);
    expect(result.totalMatched).toBe(22); expect(result.totalGroups).toBe(22);
    expect(result.solutionCandidates!.length).toBeLessThanOrEqual(12);
    expect(result.answer).toContain("共 22 条、22 种基层"); expect(result.answer).toContain("其余匹配项未全部展示");
    const refs = resolveConfirmedReferenceAnswer(result.answer!, result.pages).pages;
    expect(refs.flatMap(page => page.matches)).toHaveLength(result.solutionCandidates!.length);
  });
  it("显示预算与总数分开，截断不宣称全量；相同K的引用不串optionId", () => {
    const snapshots = structuredReferenceFixture();
    const pages: ReferencePageBlock[] = snapshots.map(({ page, model }) => ({ type: "REFERENCE_PAGE", page: { pageId: page.id,
      documentId: page.documentId, documentTitle: "模拟", pageNumber: page.physicalPageNumber, pageLabel: page.pageLabel, imageUrl: "" }, renderModel: model, matches: [], summary: {}, highlights: [] }));
    const ids = matchConfirmedPageOptions(snapshots, message).map(row => row.candidateId);
    const answer = formatConfirmedLookupAnswer(pages, ids.slice(0, 3), [], { totalMatched: 4, totalGroups: 4, structured: resolveStructuredReferenceQuery(message) });
    expect(answer).toContain("共 4 条、4 种基层，当前展示 3 条"); expect(answer).toContain("其余匹配项未全部展示");
    const stream = new KnowledgeReferenceCitationStream(); stream.push(answer, true);
    expect(stream.resolve(pages).flatMap(page => page.matches.map(match => match.optionId))).toEqual(ids.slice(0, 3));
  });
});

import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
function buildModel(snapshot: ReturnType<typeof structuredReferenceFixture>[number]) { return buildKnowledgePageRenderModel(snapshot.page.id, snapshot.data)!; }
