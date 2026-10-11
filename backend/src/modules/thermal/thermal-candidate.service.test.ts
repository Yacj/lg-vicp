import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  createCandidateSelection,
  listCandidateSelections,
  queryThermalCandidates
} from "./thermal-candidate.service.js";

/**
 * drizzle 链式最小桩（与 construction-workflow.test.ts 同款，扩展 innerJoin/offset）：
 * - rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）
 * - transaction 直接执行回调（回调内的 db 即桩本身），记录每次 insert values 用于断言
 * - queryThermalCandidates 查询顺序：
 *   限值解析 select（可选）-> listPublishedThermalSets select -> 行 join select
 * - createCandidateSelection 查询顺序：
 *   project select（可选）-> 候选行校验 select -> tx：insert selections(returning) -> 审计 insert
 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): {
  db: any;
  insertCalls: Array<Record<string, unknown>>;
} {
  let i = 0;
  const insertCalls: Array<Record<string, unknown>> = [];
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    offset: () => chain(),
    orderBy: () => chain(),
    returning: async () => next(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const from = () => ({
    innerJoin: () => from(),
    leftJoin: () => from(),
    where: () => chain(),
    orderBy: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({ from }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          returning: async () => next(),
          then: (resolve: () => void) => Promise.resolve().then(resolve)
        };
      }
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const setRow = {
  id: "set-1", code: "ATLAS-2024", version: 2, name: "图集", status: "PUBLISHED",
  priority: 0, buildingTypes: ["住宅"]
};

const row25 = {
  rowId: "r-25", setId: "set-1", setCode: "ATLAS-2024", setVersion: 2, setPriority: 0,
  setBuildingTypes: ["住宅"],
  schemeId: "sch-1", schemeCode: "A1-1", schemeVersion: 1,
  systemId: "sys-1", systemCode: "EW-EXT", systemName: "外墙外保温系统",
  substrateMaterial: "钢筋混凝土", substrateThickness: 200, atlasPage: "P12",
  productSpecId: "sp-1", specCode: "VICP-I-25", specVersion: 1, specClass: "I",
  thicknessMm: 25, productThermalResistance: 1.5, totalThermalResistance: 4.2, kValue: 0.25,
  evidenceSource: "《VICP外墙保温系统建筑构造图集》", evidenceRef: "P12 表3"
};

const row30 = { ...row25, rowId: "r-30", thicknessMm: 30, totalThermalResistance: 4.6, kValue: 0.22 };

const limitRow = {
  id: "lim-1", regionCode: "BJ", regionName: "北京", basisCode: "GB50176-2016",
  basisName: "民用建筑热工设计规范", clauseRef: "3.4.1", limitKValue: 0.25, version: 1
};

describe("候选查询 queryThermalCandidates", () => {
  const a13 = { ...row25, rowId: "a1-3", schemeCode: "A1-3", thicknessMm: 18,
    productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303, sourcePageId: "page-22", sourcePageLabel: "22" };

  it.each(["TOTAL_R", "PRODUCT_R", "K"] as const)("多标准下新指标 %s 不错误要求旧 targetK", async (metric) => {
    const { db } = makeDb([[limitRow, { ...limitRow, id: "lim-2" }], [setRow], [a13]]);
    const result = await queryThermalCandidates(app(db), request, actor, { regionCode: "BJ", metric,
      targetValue: metric === "K" ? 0.3 : metric === "TOTAL_R" ? 3.3 : 2.9, neighborTolerance: 1 });
    expect(result.missingConditions).not.toContain("targetK");
    expect(result.limitCandidates).toHaveLength(2);
  });

  it("filters 双条件应用于正式服务，R 查询不附加地区 K；响应保留容差 metadata", async () => {
    const { db } = makeDb([[limitRow], [setRow], [a13, { ...a13, rowId: "both", kValue: 0.295, totalThermalResistance: 3.39 }]]);
    const result = await queryThermalCandidates(app(db), request, actor, { regionCode: "BJ", filters: [
      { metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }, { metric: "TOTAL_R", targetValue: 3.3, mode: "MIN_LIMIT" }
    ], neighborTolerance: 1 });
    expect(result.candidates.map((c) => c.candidateId)).toEqual(["both"]);
    expect(result.filters).toHaveLength(2);
    expect(result.candidates[0]?.compliant).toBeNull();
    const empty = makeDb([[]]);
    const adjusted = await queryThermalCandidates(app(empty.db), request, actor, { metric: "TOTAL_R", targetValue: 3.3, tolerance: 5, neighborTolerance: 1 });
    expect(adjusted).toMatchObject({ requestedTolerance: 5, effectiveTolerance: 0.2, toleranceAdjusted: true });
    expect(adjusted.notes.join("")).toContain("允许的最大范围");
  });

  it("新规格正式查询返回它的产品目录，不用旧目录限制新规格", async () => {
    const { db } = makeDb([[setRow], [{ ...a13, productSpecId: "spec-B18", catalogProductId: "product-B" },
      { ...a13, rowId: "old", productSpecId: "spec-A18", catalogProductId: "product-A" }]]);
    const result = await queryThermalCandidates(app(db), request, actor, { productSpecId: "spec-B18", neighborTolerance: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ productSpec: { id: "spec-B18" }, catalogProductId: "product-B" });
  });

  it.each([
    ["TOTAL_R", 3.3, "APPROX", true], ["TOTAL_R", 3.3, "MIN_LIMIT", false],
    ["PRODUCT_R", 2.9, "APPROX", true], ["PRODUCT_R", 2.9, "MIN_LIMIT", false]
  ] as const)("正式服务 %s %s %s", async (metric, targetValue, mode, found) => {
    const { db } = makeDb([[setRow], [a13]]);
    const result = await queryThermalCandidates(app(db), request, actor, { metric, targetValue, mode, neighborTolerance: 1 });
    expect(result).toMatchObject({ metric, targetValue, lookupMode: mode, kTolerance: null, tolerance: mode === "APPROX" ? 0.05 : null });
    expect(result.candidates).toHaveLength(found ? 1 : 0);
    if (found) expect(result.candidates[0]).toMatchObject({ sourcePageLabel: "22", result: { productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }, ranking: { metric, metricGap: metric === "TOTAL_R" ? 0.003 : 0.02, isClosestToTarget: true } });
  });

  it("新R指标查询不附加地区K过滤，限值仍单独标注合规", async () => {
    const { db } = makeDb([[{ ...limitRow, limitKValue: 0.2 }], [setRow], [a13]]);
    const result = await queryThermalCandidates(app(db), request, actor, { regionCode: "BJ", metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX", neighborTolerance: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.compliant).toBeNull();
    expect(result.lookupMode).toBe("APPROX");
  });

  it("空参考集也返回指标、模式、受控容差，旧R默认下限", async () => {
    const { db } = makeDb([[]]);
    const result = await queryThermalCandidates(app(db), request, actor, { metric: "PRODUCT_R", targetValue: 2.9, tolerance: 5, neighborTolerance: 1 });
    expect(result).toMatchObject({ metric: "PRODUCT_R", targetValue: 2.9, lookupMode: "APPROX", tolerance: 0.2, candidates: [] });
    const old = makeDb([[setRow], [a13]]);
    expect((await queryThermalCandidates(app(old.db), request, actor, { targetResistance: 3.3, neighborTolerance: 1 })).candidates).toEqual([]);
  });

  it("验收 1：200mm 钢筋混凝土 + Ⅰ型 + K≤0.25 → 25/30mm 候选，来源为图集查表", async () => {
    const { db } = makeDb([[setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      substrateMaterial: "200mm钢筋混凝土",
      substrateThickness: 200,
      specClass: "I",
      targetK: 0.25,
      neighborTolerance: 1
    });
    expect(result.calculationSource).toBe("REFERENCE_TABLE");
    expect(result.candidates.map((c) => c.result.thicknessMm)).toEqual([25, 30]);
    expect(result.candidates[0]).toMatchObject({
      matchType: "EXACT",
      scheme: { code: "A1-1", substrateMaterial: "钢筋混凝土" },
      evidence: { ref: "P12 表3" }
    });
    // 未提供地区/限值 → compliant 为空，不伪造判定
    expect(result.candidates[0]!.compliant).toBeNull();
    expect(result.limit).toBeNull();
  });

  it("regionCode 解析限值：targetK 缺省取 limitKValue，候选附合规标注", async () => {
    const { db } = makeDb([[limitRow], [setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      regionCode: "BJ",
      substrateMaterial: "钢筋混凝土",
      neighborTolerance: 1
    });
    expect(result.limit).toMatchObject({ regionCode: "BJ", limitKValue: 0.25 });
    expect(result.limitCandidates).toBeNull();
    expect(result.candidates.map((c) => c.result.thicknessMm)).toEqual([25, 30]);
    expect(result.candidates.every((c) => c.compliant === null)).toBe(true);
  });

  it("多标准并存：limit 置空 + limitCandidates 返回全部 + K 条件标缺失，不隐式选最严格", async () => {
    const secondLimit = { ...limitRow, id: "lim-2", basisCode: "DBJ11-602-2023", limitKValue: 0.3, version: 2 };
    const { db } = makeDb([[limitRow, secondLimit], [setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      regionCode: "BJ",
      substrateMaterial: "钢筋混凝土",
      neighborTolerance: 1
    });
    expect(result.limit).toBeNull();
    expect(result.limitCandidates).toHaveLength(2);
    expect(result.limitCandidates!.map((item) => item.basisCode)).toEqual(["GB50176-2016", "DBJ11-602-2023"]);
    expect(result.notes.join("")).toContain("多标准并存");
    // targetK 未显式给 → K 条件标缺失，合规判定不伪造
    expect(result.missingConditions).toContain("targetK");
    expect(result.candidates.every((c) => c.compliant === null)).toBe(true);
  });

  it("多标准并存但显式给 targetK：K 条件不标缺失，按 targetK 匹配", async () => {
    const secondLimit = { ...limitRow, id: "lim-2", basisCode: "DBJ11-602-2023", limitKValue: 0.3, version: 2 };
    const { db } = makeDb([[limitRow, secondLimit], [setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      regionCode: "BJ",
      substrateMaterial: "钢筋混凝土",
      targetK: 0.25,
      neighborTolerance: 1
    });
    expect(result.limit).toBeNull();
    expect(result.limitCandidates).toHaveLength(2);
    expect(result.missingConditions).not.toContain("targetK");
    expect(result.candidates).toEqual([]);
    expect(result.nearbyCandidates?.map(c => c.result.thicknessMm)).toEqual([25, 30]);
    expect(result.nearbyCandidates?.every(c => c.constraintMatch?.passed === false)).toBe(true);
  });

  it("asOfDate：按项目时点解析生效中限值（参数通路）", async () => {
    const { db } = makeDb([[limitRow], [setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      regionCode: "BJ",
      asOfDate: new Date("2025-06-01"),
      substrateMaterial: "钢筋混凝土",
      neighborTolerance: 1
    });
    expect(result.limit).toMatchObject({ id: "lim-1", limitKValue: 0.25 });
    expect(result.limitCandidates).toBeNull();
  });

  it("没有已发布且生效中的参考集：返回空候选与提示，不报错", async () => {
    const { db } = makeDb([[]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      substrateMaterial: "钢筋混凝土",
      neighborTolerance: 1
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.notes.join("")).toContain("没有已发布");
  });

  it("指定 standardLimitId 未发布且生效：抛错，不静默降级", async () => {
    const { db } = makeDb([[]]);
    await expect(
      queryThermalCandidates(app(db), request, actor, { standardLimitId: "lim-9", neighborTolerance: 1 })
    ).rejects.toThrow("不存在或未发布");
  });

  it("无厚度档且相邻容差 0：返回空候选与相邻提示", async () => {
    const { db } = makeDb([[setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, {
      thicknessMm: 22,
      neighborTolerance: 0
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.notes.join("")).toContain("neighborTolerance");
  });
});

describe("候选确认 createCandidateSelection", () => {
  const candidate = {
    candidateId: "r-25",
    matchType: "EXACT",
    scheme: { id: "sch-1", code: "A1-1" },
    result: { thicknessMm: 25, kValue: 0.25 }
  };
  const query = { substrateMaterial: "钢筋混凝土", targetK: 0.25, neighborTolerance: 1 };

  it("项目可见 + 候选行已发布 → 快照落库并写审计", async () => {
    const record = {
      id: "sel-1", requestId: "req-1", projectId: "p-1",
      queryJson: query, candidateJson: candidate, selectionReason: "满足节能要求",
      selectedById: "u-1", createdAt: new Date(), updatedAt: new Date()
    };
    const { db, insertCalls } = makeDb([
      [{ id: "p-1", createdById: "u-1", visibility: "PRIVATE" }],
      [{ id: "r-25" }],
      [record]
    ]);
    const result = await createCandidateSelection(app(db), request, actor, {
      query: query as any,
      candidate: candidate as any,
      selectionReason: "满足节能要求",
      projectId: "p-1"
    });
    expect(result).toMatchObject({ id: "sel-1", projectId: "p-1", selectionReason: "满足节能要求" });

    // 候选确认表 values：查询与候选全快照 + 操作人
    const selectionInsert = insertCalls[0] as any;
    expect(selectionInsert).toMatchObject({
      requestId: "req-1",
      projectId: "p-1",
      queryJson: query,
      candidateJson: candidate,
      selectionReason: "满足节能要求",
      selectedById: "u-1"
    });
    // 审计记录
    expect(insertCalls[1]).toMatchObject({ action: "thermal.candidate_selected", targetId: "sel-1" });
  });

  it("候选行不在已发布集内：拒绝保存并提示", async () => {
    const { db } = makeDb([[], []]);
    await expect(
      createCandidateSelection(app(db), request, actor, {
        query: query as any,
        candidate: candidate as any
      })
    ).rejects.toThrow("不在已发布且生效中的图集参考集内");
  });

  it("项目不可见：拒绝保存", async () => {
    const normalUser = { id: "u-2", role: "NORMAL_USER", permissionCodes: [] } as any;
    const { db } = makeDb([[{ id: "p-9", createdById: "other", visibility: "PRIVATE" }]]);
    await expect(
      createCandidateSelection(app(db), request, normalUser, {
        query: query as any,
        candidate: candidate as any,
        projectId: "p-9"
      })
    ).rejects.toThrow("不存在或无权查看");
  });
});

describe("候选确认记录分页 listCandidateSelections", () => {
  it("返回分页结果（projectId 筛选）", async () => {
    const record = {
      id: "sel-1", requestId: "req-1", projectId: "p-1",
      queryJson: {}, candidateJson: {}, selectionReason: null,
      selectedById: "u-1", createdAt: new Date(), updatedAt: new Date()
    };
    const { db } = makeDb([[record], [{ value: 1 }]]);
    const result = await listCandidateSelections(app(db), { page: 1, pageSize: 20, projectId: "p-1" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: "sel-1", query: {}, candidate: {} });
  });
});


describe("统一服务偏好与 AI 普通查表标准边界", () => {
  it("软偏好在所有硬条件满足后排序，API 与 Tool 使用相同规则", async () => {
    const { db } = makeDb([[setRow], [row25, row30, { ...row25, rowId: "bad", thicknessMm: 60, kValue: 0.9 }]]);
    const result = await queryThermalCandidates(app(db), request, actor, { targetK: 0.3, neighborTolerance: 0, preferences: { preferThicker: true } });
    expect(result.candidates.map(candidate => candidate.candidateId)).toEqual(["r-30", "r-25"]);
    expect(result.candidates.every(candidate => candidate.constraintMatch?.passed)).toBe(true);
  });
  it("AI 普通查表给地区但未问合规时，不从单个标准插入 K 条件", async () => {
    const { db } = makeDb([[limitRow], [setRow], [row25, row30]]);
    const result = await queryThermalCandidates(app(db), request, actor, { intent: "REFERENCE_LOOKUP", regionCode: "BJ", neighborTolerance: 0 });
    expect(result.filters).toEqual([]); expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every(candidate => candidate.compliant === null)).toBe(true);
  });
});
