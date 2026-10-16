import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import type { ReferencePageBlock } from "../ai/reference-page.js";
import { budgetKnowledgeTestReferences, formatConfirmedLookupAnswer, formatKnowledgeTestReferences, KnowledgeReferenceCitationStream, loadKnowledgeTestReferences, matchConfirmedPageOptions } from "./knowledge-test-reference.js";
import { normalizeConversationLookupQuery } from "../ai/tools/thermal-lookup.js";
import { prioritizeKnowledgeReferenceContext } from "../ai/ai-context-builder.js";
import { estimateTokens } from "../../shared/prompt-assembly.js";

const snapshot: PageRecognitionResult = {
  pageTitle: "通用热工协议测试页", pageLabel: "22", fullText: "机器提取文本不参与定位", notes: ["原页备注"],
  systems: ["A1-3", "A1-4"].map(constructionCode => ({ constructionCode, systemName: "测试保温系统",
    layers: [
      { order: 1, name: "基层", thicknessMm: 240, lambda: 1.1, alpha: 1, rValue: 0.218 },
      { order: 2, name: "保温产品", thicknessMm: null, lambda: 0.005, alpha: 1.25, rValue: null },
      { order: 3, name: "抹面胶浆", thicknessMm: 5, lambda: 0.93, alpha: 1, rValue: 0.005 }
    ], options: [
      { thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 },
      { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 },
      { thicknessMm: 25, productThermalResistance: null, totalThermalResistance: null, kValue: null, rValue: 123 }
    ]
  }))
};
const model = buildKnowledgePageRenderModel("page", snapshot)!;
const page: ReferencePageBlock = { type: "REFERENCE_PAGE", page: { documentId: "doc", pageId: "page", documentTitle: "测试资料", pageNumber: 6, pageLabel: "22", imageUrl: "https://example.com/original.png" }, renderModel: model, matches: [], highlights: [], summary: {} };
const optionId = model.constructions[0]!.options[0]!.optionId;

describe("已确认页面模型与回答引用", () => {
  it("只问K和基层时只投影所问列，引用不夹带产品R或整体R；模型仍保留完整表", () => {
    const answer = formatConfirmedLookupAnswer([page], [optionId], [], { readOnlyPageFacts: true, readFields: ["kValue", "baseMaterial"] });
    expect(answer).toContain("传热系数 K **0.303**");
    expect(answer).not.toContain("**2.880");
    expect(answer).not.toContain("**3.297");
    expect(answer).toContain(`[[KP:${optionId}:thicknessMm,kValue]]`);
    expect(page.renderModel!.constructions[0]!.options[0]!.totalThermalResistance).toBe(3.297);
  });
  it("只读做法说明分别引用热工材料与简图文字，不再把简图行混入热工顺序", () => {
    const annotated = structuredClone(page);
    const construction = annotated.renderModel!.constructions[0]!;
    construction.diagramNotes = ["3. 隔汽层：按工程设计"];
    construction.layers.push({ name: "单独的简图注记", sourceRegion: "DIAGRAM", order: 9, layerId: "diagram-9" });
    const answer = formatConfirmedLookupAnswer([annotated], [optionId], [], { readOnlyPageFacts: true, readFields: ["layers"] });
    expect(answer).toContain("构造简图原文说明：3. 隔汽层：按工程设计");
    expect(answer).not.toContain("单独的简图注记");
    expect(answer).toContain("基层（240mm）");
    expect(answer).toContain(`[[KP:${optionId}:thicknessMm]]`);
  });
  it("旧确认字段中整个体系名为构造编码时只读兼容，描述文字不猜编号，快照不修改", () => {
    const legacy = structuredClone(snapshot);
    legacy.pageTitle = "III型VICP薄抹灰外保温系统";
    legacy.systems[0]!.constructionCode = undefined;
    legacy.systems[0]!.systemName = "外墙G3-1";
    const before = structuredClone(legacy);
    const projected = buildKnowledgePageRenderModel("legacy", legacy)!;
    expect(projected.constructions[0]).toMatchObject({ constructionCode: "外墙G3-1", systemName: legacy.pageTitle });
    expect(legacy).toEqual(before);
    const copy = structuredClone(legacy); copy.systems[0]!.systemName = "关于外墙G3-1的描述";
    expect(buildKnowledgePageRenderModel("legacy", copy)!.constructions[0]!.constructionCode).toBeUndefined();
  });
  it("保留同页全部构造、全部档位、后续层及备注，标识绑定快照且不改变原数据", () => {
    const before = JSON.stringify(snapshot);
    expect(model.constructions).toHaveLength(2);
    expect(model.constructions[0]!.options).toHaveLength(3);
    expect(model.constructions[0]!.layers[1]!.variable).toBe(true);
    expect(model.constructions[0]!.layers[2]!.name).toBe("抹面胶浆");
    expect(model.notes).toEqual(["原页备注"]);
    expect(buildKnowledgePageRenderModel("page", snapshot)).toEqual(model);
    expect(buildKnowledgePageRenderModel("other-page", snapshot)!.constructions[0]!.options[0]!.optionId).not.toBe(optionId);
    const changed = structuredClone(snapshot); changed.systems[0]!.options![0]!.kValue = 0.300;
    expect(buildKnowledgePageRenderModel("page", changed)!.constructions[0]!.options[0]!.optionId).not.toBe(optionId);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("不补算双R/K，不把旧rValue当总R；单厚度不强行标可变层", () => {
    expect(model.constructions[0]!.options[2]!.totalThermalResistance).toBeNull();
    const single = structuredClone(snapshot); single.systems[0]!.options = [single.systems[0]!.options![0]!];
    expect(buildKnowledgePageRenderModel("page", single)!.constructions[0]!.layers.some(layer => layer.variable)).toBe(false);
    expect(buildKnowledgePageRenderModel("page", null)).toBeNull();
  });
  it("每字符切流仍隐藏全部定位标记，中文偏移准确，数值相同只标指定构造", () => {
    const stream = new KnowledgeReferenceCitationStream();
    const text = `外墙A1-3 18mm，R₀=3.297，K=0.303。[[KP:${optionId}:thicknessMm,totalThermalResistance,kValue]]\n\n其他构造 K=0.303。`;
    const visible = [...text].map(character => stream.push(character)).join("") + stream.push("", true);
    expect(visible).not.toContain("[[KP");
    const blocks = stream.resolve([page]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.renderModel).toBe(model);
    expect(blocks[0]!.matches).toHaveLength(1);
    expect(blocks[0]!.matches[0]).toMatchObject({ optionId, constructionId: model.constructions[0]!.constructionId, fieldKeys: ["thicknessMm", "totalThermalResistance", "kValue"], answerOffset: visible.indexOf("\n") });
    expect(blocks[0]!.matches[0]!.summary).toMatchObject({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
  });
  it("多个引用分别携带回答位置和正式标识；越界、过期、缺失字段和非法字段都不能高亮", () => {
    const stream = new KnowledgeReferenceCitationStream();
    const other = model.constructions[1]!.options[0]!.optionId;
    stream.push(`第一段[[KP:${optionId}:kValue]]\n\n第二段[[KP:${other}:totalThermalResistance]]`);
    stream.push(`[[KP:foreign-id:kValue]][[KP:${model.constructions[0]!.options[2]!.optionId}:kValue]][[KP:${optionId}:lambda,wrong]]`, true);
    expect(stream.resolve([page])[0]!.matches).toHaveLength(2);
    expect(stream.resolve([{ ...page, renderModel: buildKnowledgePageRenderModel("page", { ...snapshot, notes: ["变更"] }) }])).toEqual([]);
  });
  it("普通文本不改写；中断引用标记不泄漏；未引用的原页不返回为命中", () => {
    const stream = new KnowledgeReferenceCitationStream();
    expect(stream.push("普通文字[[", false)).toBe("普通文字");
    expect(stream.push("说明", true)).toBe("[[说明");
    expect(stream.resolve([page])).toEqual([]);
    expect(stream.push(`正文[[KP:${optionId}:kValue`, true)).toBe("正文");
  });
  it("档位上下文来自完整已确认快照，不从全文或候选草稿生成事实", () => {
    const context = formatKnowledgeTestReferences([page]);
    expect(context).toContain(optionId);
    expect(context).toContain("A1-4");
    expect(context).not.toContain(snapshot.fullText);
    expect(formatKnowledgeTestReferences([])).toBe("");
  });
  it("长机器文本不能挤掉档位；预算只保留完整记录，未发送的ID不能引用", () => {
    const budgeted = budgetKnowledgeTestReferences([page], undefined, 200);
    expect(budgeted.citationOptionIds.length).toBeGreaterThan(0);
    expect(budgeted.citationOptionIds.length).toBeLessThan(6);
    for (const line of budgeted.context.split("\n").slice(1)) expect(() => JSON.parse(line)).not.toThrow();
    const context = prioritizeKnowledgeReferenceContext("旧文本 K=0.188。".repeat(1000), budgeted.context, 200);
    expect(context.startsWith(budgeted.context)).toBe(true);
    expect(estimateTokens(context)).toBeLessThanOrEqual(200);
    const stream = new KnowledgeReferenceCitationStream();
    stream.push(`引用[[KP:${model.constructions[1]!.options[1]!.optionId}:kValue]]`, true);
    expect(stream.resolve([page], budgeted.citationOptionIds)).toEqual([]);
  });
  it("明确K目标复用近似/精确/上限/多条件语义；不会把远离目标或错厚度的行当命中", () => {
    const input = [{ page: { id: "page", versionId: "version" }, data: snapshot, model }];
    expect(matchConfirmedPageOptions(input, "传热系数0.3的方案有么").map(row => row.result.thicknessMm)).toEqual([18, 18]);
    expect(matchConfirmedPageOptions(input, "传热系数正好等于0.3")).toEqual([]);
    expect(matchConfirmedPageOptions(input, "传热系数不超过0.3").map(row => row.result.kValue)).toEqual([0.277, 0.277]);
    expect(matchConfirmedPageOptions(input, "传热系数0.3，厚度20mm")).toEqual([]);
    expect(matchConfirmedPageOptions(input, "传热系数0.3，总热阻不低于4")).toEqual([]);
    expect(matchConfirmedPageOptions(input, "A1-4传热系数0.3").map(row => row.scheme.code)).toEqual(["A1-4"]);
  });
  it("回答和高亮同源；正文确定性引用、完整表格保留其他构造和非命中行", () => {
    const ids = matchConfirmedPageOptions([{ page: { id: "page", versionId: "version" }, data: snapshot, model }], "传热系数0.3").map(row => row.candidateId);
    const answer = formatConfirmedLookupAnswer([page], ids, normalizeConversationLookupQuery({}, "传热系数0.3").query.filters);
    const stream = new KnowledgeReferenceCitationStream();
    const visible = stream.push(answer, true);
    expect(visible).toContain("18mm"); expect(visible).toContain("整构造传热阻（源文符号待核）=3.297"); expect(visible).toContain("K=0.303");
    expect(visible).not.toContain("[[KP:"); expect(visible).not.toContain("20mm");
    expect(stream.resolve([page], ids)[0]!.matches).toHaveLength(2);
    expect(stream.resolve([page], ids)[0]!.renderModel?.constructions[0]!.options).toHaveLength(3);
    expect(formatConfirmedLookupAnswer([], [], normalizeConversationLookupQuery({}, "传热系数正好0.3").query.filters)).toContain("未找到");
  });
  it("客户端文案保留查询指标、正式行标识和工程选用说明，旧页缺符号证据保守退化", () => {
    const filters = normalizeConversationLookupQuery({}, "传热系数0.3").query.filters;
    const answer = formatConfirmedLookupAnswer([page], [optionId], filters, { compact: true });
    expect(answer).toContain("有，以下参考方案");
    expect(answer).toContain("18mm"); expect(answer).toContain("K=0.303");
    expect(answer).not.toContain("已确认记录"); expect(answer).not.toContain("产品层热阻 R=");
    expect(answer).toContain("工程选用"); expect(answer).toContain(`[[KP:${optionId}:`);
    const resistance = formatConfirmedLookupAnswer([page], [optionId], normalizeConversationLookupQuery({}, "总热阻3.3").query.filters, { compact: true });
    expect(resistance).toContain("源文符号待核"); expect(resistance).toContain("3.297"); expect(resistance).not.toContain("R₀=");
    expect(formatConfirmedLookupAnswer([page], [optionId], filters)).toContain("产品层热阻 R=2.880");
  });
});

describe("版本检索原页权限范围", () => {
  it("无原页定位或属于其他版本的命中不加载全局页面", async () => {
    const select = vi.fn();
    const app = { db: { select } } as never;
    expect(await loadKnowledgeTestReferences(app, "version", "标题", [])).toEqual({ context: "", pages: [] });
    expect(await loadKnowledgeTestReferences(app, "version", "标题", [{ versionId: "other", pageId: "page" }] as never)).toEqual({ context: "", pages: [] });
    expect(select).not.toHaveBeenCalled();
  });
  it("只消费 confirmedStructuredData；无原图仍能返回完整表格", async () => {
    const storage = { createDownloadUrl: vi.fn() };
    const app = { db: { select: () => ({ from: () => ({ where: async () => [
      { id: "confirmed", versionId: "version", documentId: "doc", physicalPageNumber: 6, pageLabel: "22", metadata: { confirmedStructuredData: snapshot } },
      { id: "draft", versionId: "version", documentId: "doc", physicalPageNumber: 7, metadata: { draftStructuredData: snapshot } }
    ] }) }) }, storage } as never;
    const result = await loadKnowledgeTestReferences(app, "version", "标题", [ { versionId: "version", pageId: "confirmed" }, { versionId: "version", pageId: "draft" } ] as never);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.page.imageUrl).toBe("");
    expect(result.pages[0]!.renderModel!.constructions).toHaveLength(2);
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it("数值查询搜索同版本全部确认档位，避免文本topN漏掉目标页；不消费未确认草稿", async () => {
    const app = { db: { select: () => ({ from: () => ({ where: async () => [
      { id: "confirmed", versionId: "version", documentId: "doc", physicalPageNumber: 6, pageLabel: "22", metadata: { confirmedStructuredData: snapshot } },
      { id: "draft", versionId: "version", documentId: "doc", physicalPageNumber: 7, metadata: { draftStructuredData: snapshot } }
    ] }) }) }, storage: { createDownloadUrl: vi.fn() } } as never;
    const result = await loadKnowledgeTestReferences(app, "version", "标题", [], "传热系数0.3方案有么");
    expect(result.authoritative).toBe(true); expect(result.pages).toHaveLength(1);
    expect(result.answer).toContain("18mm"); expect(result.citationOptionIds).toHaveLength(2);
    expect(result.context).not.toContain("20mm"); expect(result.pages[0]!.renderModel!.constructions[0]!.options).toHaveLength(3);
    const exact = await loadKnowledgeTestReferences(app, "version", "标题", [], "传热系数正好等于0.3");
    expect(exact.answer).toContain("未找到"); expect(exact.pages).toEqual([]);
  });
});
