import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThermalTool, thermalInput } from "./thermal-calculate.tool.js";
import { matchThermalCandidates, type CandidateRow } from "../../thermal/thermal-candidate-matcher.js";
import { normalizeThermalLookupQuery } from "../../thermal/thermal-lookup-mode.js";
import { parseConversationTaskState, type LastReferenceLookup } from "../conversation-task.js";
import type { ToolRuntimeContext } from "./tool-runtime.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("../../thermal/thermal-candidate.service.js", () => ({ queryThermalCandidates: mocks.query }));
vi.mock("../ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));
vi.mock("./tool-runtime.js", () => ({ runRegisteredTool: async (_ctx: unknown, _name: unknown, _args: unknown, _options: unknown, run: () => unknown) => run() }));

const real: CandidateRow = {
  rowId: "a1-3", setId: "set", setCode: "ATLAS", setVersion: 1, setPriority: 0, setBuildingTypes: [],
  schemeId: "scheme-i", schemeCode: "A1-3", schemeVersion: 1,
  systemId: "system-i", systemCode: "EW-I", systemName: "I型 VICP薄抹灰外保温系统",
  substrateMaterial: "蒸压灰砂砖", substrateThickness: 240, atlasPage: "22",
  productSpecId: "spec-i-18", specCode: "I-18", specVersion: 1, specClass: "I", thicknessMm: 18,
  productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303,
  evidenceSource: "正式图集", evidenceRef: "第22页", sourcePageId: "page-22", sourcePageLabel: "22"
};
let publishedRows: CandidateRow[];

function context(message: string, last?: LastReferenceLookup): ToolRuntimeContext {
  const pageQuery: any = {
    from: () => pageQuery, innerJoin: () => pageQuery, where: () => pageQuery,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([{
      pageId: "page-22", documentId: "doc", documentTitle: "正式图集", pageNumber: 22, physicalPageNumber: 22,
      pageLabel: "22", pageImageObjectKey: "pages/22.png", versionId: "v1", currentVersionId: "v1",
      versionStatus: "PUBLISHED", documentStatus: "ACTIVE", documentDeletedAt: null, effectiveDate: null, expiryDate: null
    }]).then(resolve)
  };
  return {
    app: { db: { select: () => pageQuery }, storage: { createDownloadUrl: vi.fn(async () => "https://example.test/page-22") }, log: { warn: vi.fn() } },
    request: {}, user: { id: "u" }, conversation: { id: "c", projectId: null },
    userMessage: message, taskState: { taskType: "GENERAL", lastReferenceLookup: last }, onEvent: vi.fn()
  } as unknown as ToolRuntimeContext;
}

async function execute(ctx: ToolRuntimeContext, input: Record<string, unknown> = {}) {
  const tool = createThermalTool(ctx);
  return await tool.execute!(thermalInput.parse({ operation: "LOOKUP_CANDIDATES", ...input }), { toolCallId: "call", messages: [] }) as any;
}

beforeEach(() => {
  mocks.query.mockReset(); mocks.save.mockReset(); publishedRows = [real];
  mocks.query.mockImplementation(async (_app, _request, _user, input) => {
    const lookup = normalizeThermalLookupQuery(input);
    return { calculationSource: "REFERENCE_TABLE", ...lookup, lookupMode: lookup.mode,
      kTolerance: lookup.metric === "K" ? lookup.tolerance : null,
      candidates: matchThermalCandidates(publishedRows, input, { neighborTolerance: input.neighborTolerance }).candidates,
      notes: [], missingConditions: [], limit: null, limitCandidates: null };
  });
});

describe("thermal Tool 最终收口回归", () => {
  it("销售20mm以内近似K命中A1-3，原页和双R及范围经过保存与二次归一", async () => {
    const ctx = context("客户想做薄一点，20mm以内有没有K 0.3左右的？");
    const result = await execute(ctx, { thicknessMm: 20 });
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ thicknessMm: undefined, thicknessMax: 20, filters: [{ metric: "K", mode: "APPROX", targetValue: 0.3 }] });
    expect(result.data).toMatchObject({ found: true, thicknessMax: 20, preferThinner: true });
    expect(result.data.candidates[0]).toMatchObject({ id: "a1-3", thicknessMm: 18, kValue: 0.303, productThermalResistance: 2.88, totalThermalResistance: 3.297, sourcePageId: "page-22", sourcePageLabel: "22" });
    expect(result.data.instruction).toContain("厚度不超过 20mm");
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify(ctx.taskState))).lastReferenceLookup!;
    expect(restored.query).toMatchObject({ thicknessMax: 20, preferThinner: true });
    await execute(context("把刚才的原页打开", restored));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(ctx.onEvent).toHaveBeenCalledWith("reference_pages", expect.anything());
  });

  it("设计院范围+K+总R全AND，真实A1-3不能冒充命中", async () => {
    const result = await execute(context("厚度控制在18到25mm，K不应大于0.3，总热阻不低于3.3。"));
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ thicknessMin: 18, thicknessMax: 25, filters: [
      { metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }, { metric: "TOTAL_R", mode: "MIN_LIMIT", targetValue: 3.3 }
    ] });
    expect(result.data.found).toBe(false);
    expect(result.data.instruction).toContain("厚度 18～25mm");
  });

  it("厚度放宽必须重查完整发布数据；取消厚度也重查，随后指代复用", async () => {
    publishedRows = [{ ...real, rowId: "thick", thicknessMm: 25 }];
    const first = context("20mm以内K0.3左右");
    expect((await execute(first)).data.found).toBe(false);
    const second = context("放宽到25mm", first.taskState?.lastReferenceLookup);
    expect((await execute(second)).data.candidates[0].id).toBe("thick");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1]?.[3]).toMatchObject({ thicknessMax: 25, thicknessMm: undefined, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
    const third = context("不限制厚度了", second.taskState?.lastReferenceLookup);
    expect((await execute(third, { thicknessMm: 25 })).data.found).toBe(true);
    expect(mocks.query.mock.calls[2]?.[3]).toMatchObject({ thicknessMm: undefined, thicknessMin: undefined, thicknessMax: undefined });
    await execute(context("刚才那个总R多少", third.taskState?.lastReferenceLookup));
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it("真实多轮增改删，空结果也保存未改条件，后续新增发布行可命中", async () => {
    const first = context("K不超过0.3，总R不低于3.3，20mm以内");
    await execute(first);
    const second = context("总R改成3.5以上，厚度放宽到25", first.taskState?.lastReferenceLookup);
    await execute(second);
    expect(second.taskState?.lastReferenceLookup?.query).toMatchObject({ thicknessMax: 25, filters: [
      { metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }, { metric: "TOTAL_R", targetValue: 3.5, mode: "MIN_LIMIT" }
    ] });
    publishedRows = [{ ...real, rowId: "new-published", thicknessMm: 30, kValue: 0.285, totalThermalResistance: 3.51 }];
    const third = context("不限制厚度了，K条件保留", second.taskState?.lastReferenceLookup);
    expect((await execute(third)).data.candidates[0].id).toBe("new-published");
    const fourth = context("不限制总R了", third.taskState?.lastReferenceLookup);
    await execute(fourth);
    expect(fourth.taskState?.lastReferenceLookup?.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }]);
    expect(fourth.taskState?.lastReferenceLookup?.query.filters).toHaveLength(1);
  });

  it("尽量薄按全部满足硬条件后的厚度升序取前12条，不能编造上限", async () => {
    publishedRows = Array.from({ length: 14 }, (_, index) => ({ ...real, rowId: String(index), thicknessMm: 40 - index, kValue: 0.3 }));
    publishedRows.push({ ...real, rowId: "thin", thicknessMm: 18 });
    publishedRows.push({ ...real, rowId: "bad-k", thicknessMm: 10, kValue: 0.6 });
    const ctx = context("尽量薄，K0.3左右");
    const result = await execute(ctx);
    expect(result.data.candidates).toHaveLength(12);
    expect(result.data.candidates[0].id).toBe("thin");
    expect(result.data.candidates.map((item: any) => item.thicknessMm)).toEqual([18, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ thicknessMm: undefined, thicknessMin: undefined, thicknessMax: undefined });
  });

  it("Tool厚度范围schema保持单一object，拒绝范围倒置和混合精确档", () => {
    expect(thermalInput.safeParse({ operation: "LOOKUP_CANDIDATES", thicknessMin: 18, thicknessMax: 25 }).success).toBe(true);
    expect(thermalInput.safeParse({ operation: "LOOKUP_CANDIDATES", thicknessMin: 25, thicknessMax: 18 }).success).toBe(false);
    expect(thermalInput.safeParse({ operation: "LOOKUP_CANDIDATES", thicknessMm: 20, thicknessMax: 25 }).success).toBe(false);
  });
  it("自然语言双条件覆盖模型单条件，未全部满足时无命中；发布新行后重新查询", async () => {
    const first = context("有没有K不应大于0.3且总热阻不得低于3.3的薄抹灰方案？");
    const result = await execute(first, { metric: "K", targetValue: 0.3, lookupMode: "MIN_LIMIT" });
    expect(result.data.found).toBe(false);
    expect(result.data.filters).toMatchObject([{ metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", mode: "MIN_LIMIT" }]);
    expect(result.data.instruction).toContain("同时满足全部条件");
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify(first.taskState)));
    expect(restored.lastReferenceLookup?.query.filters).toHaveLength(2);
    publishedRows = [{ ...real, rowId: "both", kValue: 0.295, totalThermalResistance: 3.39, productThermalResistance: 2.95 }];
    const next = await execute(context("18mm的呢？", restored.lastReferenceLookup), { thicknessMm: 18 });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(next.data.found).toBe(true);
    expect(next.data.candidates[0]).toMatchObject({ id: "both", kValue: 0.295, totalThermalResistance: 3.39 });
    const followup = await execute(context("刚才那个方案K和总R是多少？", first.taskState?.lastReferenceLookup));
    expect(followup.data.needsClarification).toBeUndefined();
  });

  it("多指标目标缺失时澄清，不把模型猜测当正式条件", async () => {
    const result = await execute(context("K≤0.3且总热阻要够大"), { metric: "K", targetValue: 0.3 });
    expect(result.data.needsClarification).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("Tool filters 能表达 AND，模型自由容差无效；用户 clamp 元信息经 Tool 与历史完整保留", async () => {
    const result = await execute(context("查已有参考档位"), { filters: [
      { metric: "PRODUCT_R", targetValue: 2.9, tolerance: 5 }, { metric: "K", targetValue: 0.3, mode: "MAX_LIMIT", tolerance: 5 }
    ] });
    expect(result.data.found).toBe(false);
    expect(mocks.query.mock.calls[0]?.[3].filters).toMatchObject([{ tolerance: 0.05 }, { tolerance: undefined }]);
    const ctx = context("总R3.3±5且K0.3±0.01");
    const adjusted = await execute(ctx);
    expect(adjusted.data).toMatchObject({ requestedTolerance: 5, effectiveTolerance: 0.2, toleranceAdjusted: true });
    expect(adjusted.data.filters).toMatchObject([{ requestedTolerance: 5, effectiveTolerance: 0.2, toleranceAdjusted: true }, { requestedTolerance: 0.01, effectiveTolerance: 0.01 }]);
    expect(adjusted.data.notes.join("")).toContain("允许的最大范围");
    expect(adjusted.data.instruction).toContain("标明实际采用的范围");
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify(ctx.taskState)));
    await execute(context("18mm的呢？", restored.lastReferenceLookup), { thicknessMm: 18, tolerance: 5 });
    expect(mocks.query.mock.calls[2]?.[3].filters).toMatchObject([{ requestedTolerance: 5, tolerance: 0.2, toleranceSource: "USER" }, { tolerance: 0.01 }]);
  });

  it("第二轮只传新 productSpecId 时不保留旧 catalogProductId", async () => {
    const newSpec = "11111111-1111-4111-8111-111111111111";
    const last: LastReferenceLookup = { query: { productSpecId: "old-spec", catalogProductId: "old-product", metric: "K", targetValue: 0.3, mode: "APPROX" }, candidates: [], createdAt: new Date().toISOString() };
    await execute(context("换这个规格", last), { productSpecId: newSpec });
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ productSpecId: newSpec, catalogProductId: undefined });
  });
  it.each([
    ["薄抹灰 K 0.3左右有方案吗？", "K", 0.3, "APPROX", true],
    ["薄抹灰 K 不超过0.3", "K", 0.3, "MAX_LIMIT", false],
    ["薄抹灰总热阻3.3左右有方案吗？", "TOTAL_R", 3.3, "APPROX", true],
    ["总热阻不低于3.3的薄抹灰方案", "TOTAL_R", 3.3, "MIN_LIMIT", false],
    ["I型产品层热阻2.9左右有什么方案？", "PRODUCT_R", 2.9, "APPROX", true]
  ] as const)("A—E %s", async (message, metric, targetValue, mode, found) => {
    const ctx = context(message);
    const result = await execute(ctx, { targetK: 0.3, lookupMode: "MAX_LIMIT", kTolerance: 5 });
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ metric, targetValue, mode });
    expect(result.data.found).toBe(found);
    expect(ctx.taskState?.lastReferenceLookup?.query).toMatchObject({ metric, targetValue, mode });
    if (found) {
      expect(result.data.candidates[0]).toMatchObject({ productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303, sourcePageLabel: "22" });
      expect(ctx.onEvent).toHaveBeenCalledWith("reference_pages", expect.objectContaining({ referencePages: expect.any(Array) }));
    } else {
      expect(ctx.taskState?.lastReferenceLookup?.candidates).toEqual([]);
      expect(result.data.instruction).toContain("继续检索知识库");
    }
  });

  it("F：18mm追问保留总R目标并重新查询；G：切指标读取上轮top12以外新数据", async () => {
    const first = context("总热阻3.3左右");
    await execute(first);
    const second = context("18mm的呢？", first.taskState?.lastReferenceLookup);
    await execute(second, { thicknessMm: 18 });
    expect(mocks.query.mock.calls[1]?.[3]).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX", thicknessMm: 18 });
    const k = context("K0.3左右");
    await execute(k);
    publishedRows = [{ ...real, rowId: "outside-previous-top12", totalThermalResistance: 4.197, kValue: 0.24 }];
    const switched = context("不限制K了，那总热阻4.2左右呢？", k.taskState?.lastReferenceLookup);
    const result = await execute(switched);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(result.data.candidates[0].id).toBe("outside-previous-top12");
    expect(result.data.metric).toBe("TOTAL_R");
  });

  it("H/I：换体系、型号传给正式查询的旧依赖ID已清除", async () => {
    const previous = context("K0.3左右");
    await execute(previous);
    const last = previous.taskState!.lastReferenceLookup!;
    last.query = { ...last.query, systemId: "sys-old", schemeId: "scheme-old", schemeCode: "A1-3", specClass: "I", productSpecId: "spec-old", catalogProductId: "catalog-old" };
    await execute(context("那屋面系统呢？", last));
    const changedSystem = mocks.query.mock.calls[1]![3];
    expect(changedSystem.schemeId).toBeUndefined(); expect(changedSystem.schemeCode).toBeUndefined(); expect(changedSystem.productSpecId).toBeUndefined();
    await execute(context("Ⅱ型呢？", last));
    const changedSpec = mocks.query.mock.calls[2]![3];
    expect(changedSpec.specClass).toBe("II"); expect(changedSpec.productSpecId).toBeUndefined(); expect(changedSpec.catalogProductId).toBeUndefined();
  });

  it("J：其他体系回退先说明未命中，双R、原页、fallback标志往返保留", async () => {
    publishedRows = [{ ...real, systemName: "屋面保温系统" }];
    const ctx = context("薄抹灰 K0.3左右");
    const result = await execute(ctx);
    expect(result.data).toMatchObject({ found: true, isFallback: true, matchedSystemHint: false });
    expect(result.data.instruction).not.toContain("第一行直接回答有");
    expect(result.data.instruction).toContain("第一句说明没有找到");
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify(ctx.taskState)));
    expect(restored.lastReferenceLookup).toMatchObject({ isFallback: true, matchedSystemHint: false, candidates: [{ sourcePageLabel: "22", productThermalResistance: 2.88, totalThermalResistance: 3.297 }] });
  });

  it("用户原页/参数指代可复用；普通相同查询仍重新核对正式发布数据", async () => {
    const first = context("K0.3左右");
    await execute(first);
    await execute(context("刚才那个方案总R是多少？", first.taskState?.lastReferenceLookup));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    publishedRows = [];
    const result = await execute(context("K0.3左右", first.taskState?.lastReferenceLookup));
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(result.data.found).toBe(false);
  });

  it("模糊传热阻系数首次必须澄清，不能依赖模型猜测", async () => {
    const result = await execute(context("传热阻系数0.303有方案吗？"), { metric: "K", targetValue: 0.303 });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(result.data.needsClarification).toBe(true);
  });

  it("模型5的容差无效；用户±0.01有效；用户±5被限制且历史仅继承已确认容差", async () => {
    await execute(context("K0.3左右"), { kTolerance: 5 });
    expect(mocks.query.mock.calls[0]?.[3].tolerance).toBe(0.02);
    const ctx = context("K=0.3±0.01");
    await execute(ctx, { tolerance: 5 });
    expect(mocks.query.mock.calls[1]?.[3].tolerance).toBe(0.01);
    await execute(context("18mm的呢？", ctx.taskState?.lastReferenceLookup), { thicknessMm: 18, tolerance: 5 });
    expect(mocks.query.mock.calls[2]?.[3].tolerance).toBe(0.01);
    await execute(context("总R3.3上下5"));
    expect(mocks.query.mock.calls[3]?.[3].tolerance).toBe(0.2);
  });

  it("旧Tool同时给K和总R时保留两项硬条件", async () => {
    const result = await execute(context("查已有参考档位"), { targetK: 0.3, targetR: 3.3, lookupMode: "APPROX" });
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({ metric: "K", targetValue: 0.3, targetResistance: 3.3 });
    expect(result.data.found).toBe(false);
  });
});
