import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { normalizeConversationLookupQuery, compactCandidateResult } from "./tools/thermal-lookup.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import type { LastReferenceLookup } from "./conversation-task.js";

/**
 * 阶段2：多轮一致性回归。
 *
 * 真实失败链：`保温0.3的材料有么` →（澄清）→ `产品热阻` → `不，我指K` → `不超过0.3`。
 * 修复前：语义层已经给出 K 0.3 的完整条件，却被上一轮的 PRODUCT_R 0.3 覆盖回去，
 * 于是「不超过0.3」落到 PRODUCT_R 上，最终回答按产品层热阻说「没有档位」，
 * 用户看到的却是「资料里没有 0.3 左右的材料」——指标被静默改写。
 *
 * 本文件锁定的不变量：
 * 1. 本轮明确给出的完整指标条件是权威条件，历史条件不得覆盖它；
 * 2. 用户只换指标、不给数值时，必须澄清，不得把旧目标值搬到新指标上；
 * 3. 只改厚度时保留指标条件（不能因为换厚度就把 K 条件丢掉）；
 * 4. 问原页属于属性追问，不得改变任何正式查询条件；
 * 5. 手动表单 API 与 AI 工具取到的数值必须逐位相同（同一个 Service，不做二次取整）。
 */

const last = (query: LastReferenceLookup["query"]): LastReferenceLookup => ({
  query, candidates: [], createdAt: "2026-10-17T00:00:00Z"
});

/** 第 2 轮之后的会话状态：产品层热阻 R≈0.3（用户当时选了「产品热阻」）。 */
const productRState = () => last({
  filters: [{ metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" }],
  metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX"
});

describe("指标纠正链：保温0.3 → 产品热阻 → 不我指K → 不超过0.3", () => {
  it("语义层补出的 K 0.3 不会被上一轮的 PRODUCT_R 覆盖", () => {
    const next = normalizeConversationLookupQuery(
      { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      "不，我指K",
      productRState()
    );
    expect(next.needsClarification).toBe(false);
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "APPROX" }]);
    expect(next.query.filters).toHaveLength(1);
  });

  it("接着「不超过0.3」只改语义为上限，指标仍是 K", () => {
    const corrected = normalizeConversationLookupQuery(
      { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      "不，我指K",
      productRState()
    );
    const limited = normalizeConversationLookupQuery({}, "不超过0.3", last(corrected.query));
    expect(limited.needsClarification).toBe(false);
    expect(limited.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }]);
  });

  it("只换指标不给数值时必须澄清，不得把旧目标值搬到新指标上", () => {
    // 「那总热阻呢？」没有数值：不能凭空认为用户要 R₀≈0.3。
    const next = normalizeConversationLookupQuery({}, "那总热阻呢？", productRState());
    expect(next.needsClarification).toBe(true);
    expect(next.query.filters?.some((filter) => filter.metric === "TOTAL_R" && filter.targetValue === 0.3)).not.toBe(true);
  });

  it("语义层只给指标名、没给数值时仍要澄清（不能凭历史值补全）", () => {
    const next = normalizeConversationLookupQuery({ metric: "K" }, "不，我指K", productRState());
    expect(next.needsClarification).toBe(true);
  });

  it("「A 或者 B」的关系歧义不被条件补全掩盖", () => {
    const next = normalizeConversationLookupQuery(
      { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      "K0.3或者产品热阻0.3",
      productRState()
    );
    expect(next.needsClarification).toBe(true);
  });
});

describe("换厚度不丢指标条件", () => {
  const kState = () => last({
    filters: [{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }],
    metric: "K", targetValue: 0.3, mode: "MAX_LIMIT"
  });

  it.each(["55mm能算吗", "那55mm的呢", "55mm"])("%s：厚度改为 55mm，K≤0.3 仍保留", (message) => {
    const next = normalizeConversationLookupQuery({}, message, kState());
    expect(next.needsClarification).toBe(false);
    expect(next.query.thicknessMm).toBe(55);
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }]);
  });

  it("问原页/刚才那个属于属性追问，不改变正式查询条件", () => {
    const next = normalizeConversationLookupQuery({}, "刚才那页的原页给我", kState());
    expect(next.attributeQuestion).toBe(true);
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }]);
    expect(next.query.thicknessMm).toBeUndefined();
  });
});

/**
 * 同一组已发布输入：手动表单 HTTP API 与 AI 小格 Tool 必须拿到同一组数值。
 * 两者都调用 queryThermalCandidates，本测试锁定「Tool 层不得二次取整/改写」。
 */
function makeDb(rows: Array<Array<Record<string, unknown>>>) {
  let index = 0;
  const next = () => rows[index++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    offset: () => chain(),
    orderBy: () => chain(),
    returning: async () => next(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const from = () => ({ innerJoin: () => from(), leftJoin: () => from(), where: () => chain(), orderBy: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve) });
  return { db: { select: () => ({ from }), transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(null) } };
}

const app = (db: any) => ({ db }) as unknown as FastifyInstance;
const request = { ip: "127.0.0.1", headers: {}, id: "req-phase2" } as FastifyRequest;
const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const setRow = { id: "set-1", code: "ATLAS-2024", version: 2, name: "图集", status: "PUBLISHED", priority: 0, buildingTypes: ["住宅"] };

/** 甲方 Excel 分层案例的图集侧对照行（产品整体 R=5.0，芯材 R=4.8，R₀=5.3068，K=0.1884） */
const excelRow = {
  rowId: "r-35", setId: "set-1", setCode: "ATLAS-2024", setVersion: 2, setPriority: 0, setBuildingTypes: ["住宅"],
  schemeId: "sch-1", schemeCode: "A1-1", schemeVersion: 1,
  systemId: "sys-1", systemCode: "EW-EXT", systemName: "外墙外保温系统",
  substrateMaterial: "钢筋混凝土", substrateThickness: 200, atlasPage: "P12",
  productSpecId: "sp-1", specCode: "VICP-I-35", specVersion: 1, specClass: "I",
  thicknessMm: 35, productThermalResistance: 5, totalThermalResistance: 5.3068, kValue: 0.1884,
  evidenceSource: "《VICP外墙保温系统建筑构造图集》", evidenceRef: "P12 表3"
};

describe("手动表单与 AI 工具数值一致", () => {
  it("同一行数据经 Tool 压缩后，三个指标逐位不变", async () => {
    const { db } = makeDb([[setRow], [excelRow]]);
    const service = await queryThermalCandidates(app(db), request, actor, {
      metric: "PRODUCT_R", targetValue: 5, mode: "APPROX", neighborTolerance: 0
    });
    expect(service.candidates).toHaveLength(1);
    const raw = service.candidates[0]!;
    const tool = compactCandidateResult(raw);
    expect(tool.productThermalResistance).toBe(raw.result.productThermalResistance);
    expect(tool.totalThermalResistance).toBe(raw.result.totalThermalResistance);
    expect(tool.kValue).toBe(raw.result.kValue);
    expect(tool.thicknessMm).toBe(raw.result.thicknessMm);
    // 甲方原值口径：不能被压缩层改写成 4.8 或 5.31。
    expect(tool.productThermalResistance).toBe(5);
    expect(tool.totalThermalResistance).toBe(5.3068);
    expect(tool.kValue).toBe(0.1884);
  });

  it("同一行的产品层 R 与总热阻 R₀ 是两个字段，工具不得互换", async () => {
    const { db } = makeDb([[setRow], [excelRow]]);
    const service = await queryThermalCandidates(app(db), request, actor, {
      metric: "TOTAL_R", targetValue: 5.3068, mode: "APPROX", neighborTolerance: 0
    });
    const tool = compactCandidateResult(service.candidates[0]!);
    expect(tool.productThermalResistance).not.toBe(tool.totalThermalResistance);
    const facts = buildAllowedAnswerFacts({}, [tool], "详细参数");
    // 事实模板必须分别标注两个指标，不得把产品 R 说成 R₀。
    expect(facts.canonicalAnswers[0]).toContain("产品层热阻 R=5");
    expect(facts.canonicalAnswers[0]).toContain("总热阻 R₀=5.3068");
  });
});
