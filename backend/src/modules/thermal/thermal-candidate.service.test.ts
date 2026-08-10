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
    expect(result.candidates.every((c) => c.compliant === true)).toBe(true);
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
    expect(result.candidates.map((c) => c.result.thicknessMm)).toEqual([25, 30]);
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