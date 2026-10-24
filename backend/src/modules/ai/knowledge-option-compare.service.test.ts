import "dotenv/config";
import { describe, expect, it } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { compareKnowledgeSelections, buildKnowledgeCompareChecks, renderKnowledgeCompare, type KnowledgeCompareItem } from "./knowledge-option-compare.service.js";
import { constructionKey, knowledgeOptionIdentity, optionFingerprint, resolveKnowledgeOption } from "./knowledge-option-identity.js";

/** 仅供只读比较回归：构造两种快照（带/不带版本指纹），不连库、不写状态。 */
const pageData = (options: { revisioned?: boolean, withProductR?: boolean } = {}) => ({
  ...(options.revisioned ? { schemaVersion: 2 } : {}),
  pageTitle: "建筑外墙热工计算参考选用表（Ⅰ型VICP薄抹灰外保温系统）", fullText: "",
  systems: [
    { constructionCode: "A1-3", systemName: "A1-3", baseMaterial: "钢筋混凝土", baseThicknessMm: 200, roofForm: "FLAT", placement: "UPRIGHT",
      options: [{ thicknessMm: 18, ...(options.withProductR === false ? {} : { productThermalResistance: 2.88 }), totalThermalResistance: 3.297, kValue: .303, sourceRowLabel: "18" }], layers: [] },
    { constructionCode: "A1-4", systemName: "A1-4", baseMaterial: "钢筋混凝土", baseThicknessMm: 200, roofForm: "FLAT", placement: "UPRIGHT",
      options: [{ thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.39, kValue: .295, sourceRowLabel: "20" }], layers: [] }
  ]
});

const row = (id: string, options: { revisioned?: boolean, withProductR?: boolean } = {}) => {
  const data = pageData(options);
  return { page: { id, documentId: `doc-${id}`, versionId: `ver-${id}`, pageLabel: "22", physicalPageNumber: 5, metadata: {} },
    document: { id: `doc-${id}`, title: "受控模拟图集", docNumber: "TEST-1" },
    version: { id: `ver-${id}`, version: 2, status: "PUBLISHED", usageMode: "AI_ENABLED" }, data } as never;
};

const deps = (rows: unknown[]) => ({
  readPages: async (_app: unknown, ids: readonly string[]) => (rows as Array<{ page: { id: string } }>).filter(item => ids.includes(item.page.id)),
  toBlock: async (_app: unknown, item: never) => {
    const typed = item as unknown as { page: { id: string, documentId: string, versionId: string, pageLabel: string }, document: { id: string, title: string }, data: unknown };
    return { type: "REFERENCE_PAGE", page: { pageId: typed.page.id, documentId: typed.document.id, documentTitle: typed.document.title,
      pageNumber: 5, physicalPageNumber: 5, pageLabel: typed.page.pageLabel, imageUrl: "" },
    renderModel: buildKnowledgePageRenderModel(typed.page.id, typed.data as never), matches: [], summary: {}, highlights: [] } as never;
  }
});

const fakeApp = {} as never;

describe("知识库只读比较：身份与歧义", () => {
  it("指纹按内容计算，不随档位顺序变化", () => {
    const model = buildKnowledgePageRenderModel("p", pageData({ revisioned: true }) as never)!;
    const [first, second] = model.constructions;
    const a = optionFingerprint(first!.options[0]!);
    const reordered = buildKnowledgePageRenderModel("p", { ...pageData({ revisioned: true }),
      systems: [...(pageData({ revisioned: true }).systems as never[])].reverse() } as never)!;
    expect(optionFingerprint(reordered.constructions[1]!.options[0]!)).toBe(a);
    expect(optionFingerprint(second!.options[0]!)).not.toBe(a);
  });
  it("同编码不同基层不被当成同一构造", () => {
    const model = buildKnowledgePageRenderModel("p", pageData({ revisioned: true }) as never)!;
    const other = { ...model.constructions[0]!, baseMaterial: "加气混凝土砌块" };
    expect(constructionKey(model.constructions[0]!)).not.toBe(constructionKey(other));
  });
  it("同编码同厚度出现多条时显式歧义，不取第一条", () => {
    const data = pageData({ revisioned: true });
    data.systems.push({ ...data.systems[0]!, baseMaterial: "混凝土空心砌块" } as never);
    const model = buildKnowledgePageRenderModel("p", data as never)!;
    expect(resolveKnowledgeOption(model, { constructionCode: "A1-3", thicknessMm: 18 })).toMatchObject({ status: "AMBIGUOUS" });
  });
  it("选择声明的快照指纹与当前快照不一致时拒绝比较", () => {
    const model = buildKnowledgePageRenderModel("p", pageData({ revisioned: true }) as never)!;
    expect(resolveKnowledgeOption(model, { constructionCode: "A1-3", thicknessMm: 18, confirmedRevision: "0".repeat(24) }))
      .toMatchObject({ status: "STALE_REVISION" });
  });
  it("快照无指纹时不能把客户端声明当作已核对", () => {
    const model = buildKnowledgePageRenderModel("p", pageData() as never)!;
    expect(model.confirmedRevision).toBeUndefined();
    expect(resolveKnowledgeOption(model, { constructionCode: "A1-3", thicknessMm: 18, confirmedRevision: "a".repeat(24) }))
      .toMatchObject({ status: "REVISION_UNVERIFIABLE" });
  });
});

describe("知识库只读比较：边界与口径", () => {
  it("比较只返回只读结果，不产生候选/方案状态字段", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }, { pageId: "p1", constructionCode: "A1-4", thicknessMm: 20 }] });
    expect(result.comparisonOnly).toBe(true);
    expect(result.confirmable).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(Object.keys(result)).not.toContain("candidates");
    expect(Object.keys(result)).not.toContain("solutionCandidates");
    expect(result.answer).toContain("不构成正式候选");
    expect(result.answer).toContain("未确认、未冻结快照");
  });
  it("逐项核对指标口径、单位、基层、厚度、来源与版本", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }, { pageId: "p1", constructionCode: "A1-4", thicknessMm: 20 }] });
    expect(result.checks.map(check => check.key)).toEqual(["METRIC_SCOPE", "UNIT", "BASE", "THICKNESS", "SOURCE", "VERSION"]);
    expect(result.checks.find(check => check.key === "VERSION")?.status).toBe("SAME");
    expect(result.checks.find(check => check.key === "UNIT")?.detail).toContain("W/(m²·K)");
  });
  it("缺产品层热阻时保持缺失，不插值、不换算", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true, withProductR: false })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }, { pageId: "p1", constructionCode: "A1-4", thicknessMm: 20 }] });
    expect(result.checks.find(check => check.key === "METRIC_SCOPE")?.status).toBe("MISSING");
    expect(result.items[0]?.productThermalResistance).toBeNull();
    expect(result.answer).toContain("不插值");
  });
  it("厚度不存在时列出可选厚度，不临时插值", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 19 }, { pageId: "p1", constructionCode: "A1-4", thicknessMm: 20 }] });
    expect(result.failures[0]).toMatchObject({ status: "THICKNESS_NOT_FOUND" });
    expect(result.failures[0]?.message).toContain("18");
    expect(result.items).toHaveLength(1);
  });
  it("页不可读时明确失败，不用其他页顶替", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }, { pageId: "p2", constructionCode: "A1-4", thicknessMm: 20 }] });
    expect(result.failures[0]).toMatchObject({ status: "PAGE_NOT_READABLE" });
    expect(result.answer).toContain("没有足够的可比较档位");
  });
  it("重复选择同一条档位不凑数", async () => {
    const result = await compareKnowledgeSelections(fakeApp, { projectId: null, deps: deps([row("p1", { revisioned: true })]),
      selections: [{ pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }, { pageId: "p1", constructionCode: "A1-3", thicknessMm: 18 }] });
    expect(result.items).toHaveLength(1);
    expect(result.answer).toContain("没有足够的可比较档位");
  });
  it("无版本指纹的快照在版本项标为缺失，不声称已核对版本", () => {
    const model = buildKnowledgePageRenderModel("p", pageData() as never)!;
    const item: KnowledgeCompareItem = { identity: knowledgeOptionIdentity({ pageId: "p", documentId: "d", versionId: "v", revision: "",
      construction: model.constructions[0]!, option: model.constructions[0]!.options[0]! }), constructionLabel: "A1-3",
      baseMaterial: "钢筋混凝土", baseThicknessMm: 200, roofForm: "FLAT", thicknessMm: 18, productThermalResistance: 2.88,
      totalThermalResistance: 3.297, kValue: .303, source: { documentId: "d", documentTitle: "受控模拟图集", versionId: "v", pageLabel: "22", pageNumber: 5 } };
    const checks = buildKnowledgeCompareChecks([item, { ...item, thicknessMm: 20 }]);
    expect(checks.find(check => check.key === "VERSION")?.status).toBe("MISSING");
    expect(renderKnowledgeCompare([item, { ...item, thicknessMm: 20 }], checks)).toContain("未带版本指纹");
  });
});
