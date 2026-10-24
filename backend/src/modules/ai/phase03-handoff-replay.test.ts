import "dotenv/config";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySemanticQuery, type SemanticQuery } from "../thermal/semantic-query.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { queryConfirmedPageFacts } from "../knowledge/confirmed-page-facts.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
const mocks = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), read: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: mocks.history }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read }));
import { readHistoricalConfirmedPage } from "./confirmed-page-reference-read.js";

const frozen = JSON.parse(readFileSync(new URL("../../../tests/fixtures/phase03-handoff/replay.json", import.meta.url), "utf8"));
const snapshots = () => structuredClone(frozen.pages).map((item: any) => ({ ...item, model: buildKnowledgePageRenderModel(item.page.id, item.data)! }));
const substrateDictionary = { aliases: [], entities: [{ field: "substrateMaterial" as const, value: "钢筋混凝土", names: ["钢筋混凝土"] }] };
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); });

describe("阶段02冻结证据回放（非真实模型/DB/H5）", () => {
  it.each([0, 1])("D01 S5-T2第%s次提案：基层200mm不能丢失或变成板厚", attempt => {
    const turn = frozen.turns["S5-T2"], semantic = turn.traces[attempt].proposal.pageQuery;
    const before = structuredClone(semantic);
    const result = applySemanticQuery(turn.message, semantic, substrateDictionary);
    expect(result.unresolved).toEqual([]);
    expect(result.substrateThickness).toBe(200);
    expect(result.thicknessMm).toBeUndefined();
    expect(semantic).toEqual(before);
  });
  it.each([
    { entityText: "300mm", value: 200 }, { entityText: "200mm", value: 300 },
    { entityText: "200mm以内", value: 200 }, { entityText: "200mm", value: 200, operator: "MIN_LIMIT" },
    { entityText: "200mm", value: 200, operation: "EXCLUDE" },
    { entityText: "200mm基层且板厚20mm", value: 200 }, { entityText: "不要200mm", value: 200 }
  ])("D01封闭厚度表示不修正冲突/范围/排除：%j", patch => {
    const semantic = structuredClone(frozen.turns["S5-T2"].traces[1].proposal.pageQuery);
    semantic.constraints = [{ ...semantic.constraints[1], ...patch }];
    const result = applySemanticQuery("200mm钢筋混凝土基层", semantic, substrateDictionary);
    expect(result.unresolved?.length).toBeGreaterThan(0);
    expect(result.substrateThickness).toBeUndefined();
  });
  it.each(["120mm", "200mm", "300.5mm", "200毫米", "２００ｍｍ"])("基层封闭标量%s不改变板厚", literal => {
    const semantic = structuredClone(frozen.turns["S5-T2"].traces[0].proposal.pageQuery);
    semantic.constraints = [{ ...semantic.constraints[1], entityText: literal, evidence: literal }];
    const q = applySemanticQuery(literal, semantic, substrateDictionary);
    expect(q.unresolved).toEqual([]); expect(q.substrateThickness).toBe(Number.parseFloat(literal.normalize("NFKC"))); expect(q.thicknessMm).toBeUndefined();
  });
  it("基层标量只屏蔽对应单位字形，不能隐藏另一项板厚条件", () => {
    const semantic = structuredClone(frozen.turns["S5-T2"].traces[1].proposal.pageQuery);
    const q = applySemanticQuery("200mm钢筋混凝土基层，板厚20mm", semantic, substrateDictionary);
    expect(q.substrateThickness).toBe(200); expect(q.unresolved?.some(item => item.field === "thicknessMm")).toBe(true);
  });
  it("D01已发布编码集合不能被单实体互斥校验拒绝，也不能漏掉第三个对象", () => {
    const turn = frozen.turns["R5-T1"], pageQuery = turn.traces[0].proposal.pageQuery;
    const semantic: SemanticQuery = { ...pageQuery, confidence: .95, unresolved: [], constraints: pageQuery.constraints.map((c: any) => ({ ...c, confidence: .95 })) };
    const dictionary = { aliases: [], entities: ["VICP-OVERALL", "VICP-LAYERED", "OTHER"].map((name, i) => ({ field: "schemeId" as const, value: `scheme-${i}`, names: [name] })) };
    const result = applySemanticQuery(turn.message, semantic, dictionary);
    expect(result.unresolved).toEqual([]);
    expect(result.constructionCodes).toEqual(["VICP-OVERALL", "VICP-LAYERED"]);
    expect(applySemanticQuery(turn.message + "和OTHER", semantic, dictionary).unresolved?.length).toBeGreaterThan(0);
    // 原始低置信提案仍拒绝，不据字典命中直接提高confidence。
    expect(applyDomainPolicy(turn.message, domainTurnSemanticSchema.parse(turn.traces[0].proposal)).intent).toBe("CLARIFY");
  });
  it("D04原发布页缺产品R但有R/K；标题的正式I型只作为只读身份依据", () => {
    const roof = snapshots().filter((s: any) => s.page.physicalPageNumber === 33);
    const before = JSON.stringify(roof);
    const q = { applicationPart: "ROOF" as const, roofForm: "FLAT" as const, specClass: "I" as const, thicknessMm: 20 };
    const rows = queryConfirmedPageFacts(roof, q);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.option.kValue)).toEqual([.28, .28]);
    expect(rows.every(row => row.option.totalThermalResistance === 3.569 && row.option.productThermalResistance == null)).toBe(true);
    expect(queryConfirmedPageFacts(roof, { ...q, specClass: "II" })).toEqual([]);
    expect(queryConfirmedPageFacts(roof, { ...q, filters: [{ metric: "PRODUCT_R", mode: "EXACT", targetValue: 3.2 }] })).toEqual([]);
    expect(JSON.stringify(roof)).toBe(before);
  });
  it.each(["建筑屋面热工计算参考选用表（I型VICP和III型VICP屋面保温系统）", "I型屋面", "建筑屋面热工计算参考选用表（I型VLCP屋面保温系统）"])("型号证据不唯一或不是正式标题%s时不补身份", title => {
    const roof = snapshots().filter((s: any) => s.page.physicalPageNumber === 33);
    roof[0].data.pageTitle = title;
    expect(queryConfirmedPageFacts(roof, { specClass: "I", thicknessMm: 20 })).toEqual([]);
  });
  it.each([false, true])("D05两张原页按45mm成组回读，任一来源失效%s不静默选另一页", async stale => {
    const source = snapshots().filter((s: any) => [5, 6].includes(s.page.physicalPageNumber));
    const conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app" };
    const stored = source.map((s: any) => ({ documentId: s.page.documentId, pageId: s.page.id, versionId: s.page.versionId,
      matches: s.model.constructions.flatMap((c: any) => c.options.filter((o: any) => o.thicknessMm === 45).map((o: any) => ({
        pageId: s.page.id, constructionId: c.constructionId, optionId: o.optionId, confirmedRevision: s.model.confirmedRevision, fieldKeys: ["thicknessMm"], answerOffset: 99 }))) }));
    mocks.history.mockResolvedValue([{ createdAt: new Date(), metadata: { queryScope: conversation, referencePages: stored } }]);
    mocks.read.mockResolvedValue(source.map((s: any) => ({ page: { ...s.page, metadata: { confirmedStructuredData: s.data } }, document: { id: s.page.documentId, title: "冻结发布资料" } })));
    if (stale) mocks.read.mockResolvedValue(source.slice(0, 1).map((s: any) => ({ page: { ...s.page, metadata: { confirmedStructuredData: s.data } }, document: { id: s.page.documentId, title: "冻结发布资料" } })));
    const turn = frozen.turns["R1-T3"], semantic = domainTurnSemanticSchema.parse(turn.traces[0].proposal);
    const ctx: any = { app: { db: {}, log: { warn: vi.fn() } }, user: { id: "u", clientType: "C_APP" }, conversation,
      userMessage: turn.message, taskState: { taskType: "GENERAL" }, domainDecision: applyDomainPolicy(turn.message, semantic) };
    const before = structuredClone(ctx.taskState), result = await readHistoricalConfirmedPage(ctx);
    if (stale) { expect(result).toBeUndefined(); return; }
    expect(result?.referencePages).toHaveLength(2);
    expect(result?.referencePages.flatMap(page => page.matches)).toHaveLength(4);
    expect(result?.referencePages.flatMap(page => page.matches).every(match => match.summary.thicknessMm === 45 && match.answerOffset == null)).toBe(true);
    expect(result?.sources).toHaveLength(2); expect(result?.candidates).toEqual([]); expect(ctx.taskState).toEqual(before);
  });
});
