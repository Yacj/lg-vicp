import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  assertRuleReferences,
  batchCreateComparisonRules,
  collectComparisonViolations,
  createComparisonMaterial,
  createComparisonRule,
  createComparisonVersion,
  deleteComparisonMaterial,
  updateComparisonDimension
} from "./comparison.service.js";

/** drizzle 链式最小桩（同 thermal-workflow.test.ts）：rows 按调用顺序消耗 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): {
  db: any;
  insertCalls: Array<unknown>;
} {
  let i = 0;
  const insertCalls: unknown[] = [];
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    returning: async () => next(),
    orderBy: () => chain(),
    offset: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    }),
    update: () => ({
      set: () => ({ where: () => chain() })
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: (v: unknown) => void) => Promise.resolve(next()).then(resolve) };
      }
    }),
    delete: () => ({
      where: () => chain()
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const draftVersion = { id: "v-1", code: "VICP-VS-EPS-2026", version: 1, status: "DRAFT", name: "VICP 对比 EPS" };

describe("createComparisonVersion", () => {
  it("创建 DRAFT v1 版本并写审计", async () => {
    const created = { ...draftVersion, evidenceSource: "检测报告" };
    const { db, insertCalls } = makeDb([
      [],      // assertKeyAvailable（无重复）
      [created], // insert returning
      []       // 审计
    ]);
    const result = await createComparisonVersion(app(db), request, actor, { code: "VICP-VS-EPS-2026", name: "VICP 对比 EPS" });
    expect(result).toMatchObject({ id: "v-1", version: 1, status: "DRAFT" });
    expect(insertCalls[0]).toMatchObject({ code: "VICP-VS-EPS-2026", version: 1, status: "DRAFT", createdById: "u-1" });
  });

  it("同 code 已有记录时拒绝创建", async () => {
    const { db } = makeDb([
      [{ id: "v-9", code: "VICP-VS-EPS-2026" }] // assertKeyAvailable 命中
    ]);
    await expect(createComparisonVersion(app(db), request, actor, { code: "VICP-VS-EPS-2026", name: "X" }))
      .rejects.toThrow("同键记录已存在");
  });
});

describe("材料子表状态守卫", () => {
  it("版本 PUBLISHED 时新增材料抛 409", async () => {
    const { db } = makeDb([
      [{ id: "v-1", status: "PUBLISHED" }]
    ]);
    await expect(createComparisonMaterial(app(db), request, actor, "v-1", {
      category: "VICP", name: "VICP 板", model: "V-50"
    })).rejects.toThrow("当前状态（PUBLISHED）不允许执行该操作");
  });

  it("DRAFT 版本创建材料成功并写入 versionId", async () => {
    const { db, insertCalls } = makeDb([
      [draftVersion],
      [{ id: "m-1", versionId: "v-1", category: "VICP", name: "VICP 板", model: "V-50" }],
      []
    ]);
    const result = await createComparisonMaterial(app(db), request, actor, "v-1", {
      category: "VICP", name: "VICP 板", model: "V-50", density: 40, densityUnit: "kg/m³"
    });
    expect(result).toMatchObject({ id: "m-1", versionId: "v-1" });
    expect(insertCalls[0]).toMatchObject({ versionId: "v-1", category: "VICP", density: 40 });
  });
});

describe("assertRuleReferences 引用校验", () => {
  const dimension = { id: "d-1", name: "保温", enabled: true };
  const base = {
    dimensionId: "d-1",
    vicpMaterialId: "m-1",
    competitorMaterialId: "m-2",
    benchmarkType: "SAME_THICKNESS",
    benchmarkDesc: "同厚度",
    vicpValue: 0.032,
    vicpUnit: "W/(m·K)",
    advantageText: "x",
    applicability: "y",
    mandatoryDisclosure: "z"
  };
  const vicpMaterial = { id: "m-1", versionId: "v-1", category: "VICP" };
  const epsMaterial = { id: "m-2", versionId: "v-1", category: "EPS" };

  it("通过：维度启用、双方材料同版本、类别正确", async () => {
    const { db } = makeDb([
      [dimension],
      [vicpMaterial, epsMaterial]
    ]);
    const refs = await assertRuleReferences(app(db), "v-1", base);
    expect(refs.dimension.name).toBe("保温");
  });

  it("VICP 侧材料类别必须为 VICP", async () => {
    const { db } = makeDb([
      [dimension],
      [{ ...vicpMaterial, category: "EPS" }, epsMaterial]
    ]);
    await expect(assertRuleReferences(app(db), "v-1", base))
      .rejects.toThrow("VICP 侧材料类别必须为 VICP");
  });

  it("竞品侧材料类别不能为 VICP", async () => {
    const { db } = makeDb([
      [dimension],
      [vicpMaterial, { ...epsMaterial, category: "VICP" }]
    ]);
    await expect(assertRuleReferences(app(db), "v-1", base))
      .rejects.toThrow("竞品侧材料类别不能为 VICP");
  });

  it("双方材料必须属于当前版本（跨版本混比拒绝）", async () => {
    const { db } = makeDb([
      [dimension],
      [vicpMaterial, { ...epsMaterial, versionId: "v-9" }]
    ]);
    await expect(assertRuleReferences(app(db), "v-1", base))
      .rejects.toThrow("双方材料必须属于当前版本");
  });

  it("填写竞品侧数值时必须同时填写竞品侧单位", async () => {
    const { db } = makeDb([
      [dimension],
      [vicpMaterial, epsMaterial]
    ]);
    await expect(assertRuleReferences(app(db), "v-1", { ...base, competitorValue: 0.042 }))
      .rejects.toThrow("必须同时填写竞品侧单位");
  });

  it("维度已禁用时拒绝", async () => {
    const { db } = makeDb([
      [{ ...dimension, enabled: false }],
      []
    ]);
    await expect(assertRuleReferences(app(db), "v-1", base))
      .rejects.toThrow("引用的维度已禁用");
  });
});

describe("createComparisonRule 维度名快照", () => {
  it("写入 dimensionName 快照（历史展示不漂移）", async () => {
    const { db, insertCalls } = makeDb([
      [draftVersion],                          // requireEditableVersion
      [{ id: "d-1", name: "保温", enabled: true }], // assertRuleReferences: dimension
      [                                          // assertRuleReferences: materials
        { id: "m-1", versionId: "v-1", category: "VICP" },
        { id: "m-2", versionId: "v-1", category: "EPS" }
      ],
      [{ id: "r-1", versionId: "v-1", dimensionName: "保温" }], // insert returning
      []                                       // 审计
    ]);
    await createComparisonRule(app(db), request, actor, "v-1", {
      dimensionId: "d-1",
      vicpMaterialId: "m-1",
      competitorMaterialId: "m-2",
      benchmarkType: "SAME_THICKNESS",
      benchmarkDesc: "同厚度",
      vicpValue: 0.032,
      vicpUnit: "W/(m·K)",
      competitorValue: 0.042,
      competitorUnit: "W/(m·K)",
      advantageText: "x",
      applicability: "y",
      mandatoryDisclosure: "z"
    });
    expect(insertCalls[0]).toMatchObject({ dimensionName: "保温", versionId: "v-1", competitorValue: 0.042 });
  });
});

describe("deleteComparisonMaterial 引用守卫", () => {
  it("材料已被规则引用时拒绝删除", async () => {
    const { db } = makeDb([
      [{ id: "m-1", versionId: "v-1", category: "VICP", name: "VICP 板", model: "V-50" }],
      [draftVersion],
      [{ id: "r-1", vicpMaterialId: "m-1" }]
    ]);
    await expect(deleteComparisonMaterial(app(db), request, actor, "m-1"))
      .rejects.toThrow("材料已被对比规则引用，不能删除");
  });

  it("未引用时删除成功", async () => {
    const { db, insertCalls } = makeDb([
      [{ id: "m-1", versionId: "v-1", category: "VICP", name: "VICP 板", model: "V-50" }],
      [draftVersion],
      [],   // 无引用
      [],   // delete
      []    // 审计
    ]);
    const result = await deleteComparisonMaterial(app(db), request, actor, "m-1");
    expect(result).toMatchObject({ message: "材料已删除" });
    expect(insertCalls[0]).toMatchObject({ action: "comparison.material_deleted", targetId: "m-1" });
  });
});

describe("updateComparisonDimension 五维守卫", () => {
  it("禁用固定五维抛 COMPARISON_DIMENSION_FIXED", async () => {
    const { db } = makeDb([
      [{ id: "d-1", code: "thermal", parentId: null, name: "保温" }]
    ]);
    await expect(updateComparisonDimension(app(db), request, actor, "d-1", { enabled: false }))
      .rejects.toThrow("五维固定维度不允许删除或禁用");
  });

  it("子指标可禁用", async () => {
    const { db } = makeDb([
      [{ id: "d-2", code: "lambda", parentId: "d-1", name: "导热系数", enabled: true }],
      [{ id: "d-2", code: "lambda", parentId: "d-1", name: "导热系数", enabled: false }],
      []
    ]);
    const result = await updateComparisonDimension(app(db), request, actor, "d-2", { enabled: false });
    expect(result).toMatchObject({ enabled: false });
  });
});

describe("batchCreateComparisonRules", () => {
  it("规则引用不存在的材料 key 时抛结构错误", async () => {
    const { db } = makeDb([
      [draftVersion] // requireEditableVersion
    ]);
    await expect(batchCreateComparisonRules(app(db), request, actor, "v-1", {
      materials: [],
      rules: [{
        vicpMaterialKey: "vicp|VICP 板|V-50",
        competitorMaterialKey: "eps|EPS 板|E-50",
        dimensionId: "d-1",
        benchmarkType: "SAME_THICKNESS",
        benchmarkDesc: "同厚度",
        vicpValue: 0.032,
        vicpUnit: "W/(m·K)",
        advantageText: "x",
        applicability: "y",
        mandatoryDisclosure: "z"
      }]
    })).rejects.toThrow("规则引用的材料 key 不存在");
  });
});

describe("collectComparisonViolations 结构校验", () => {
  const rule = {
    id: "r-1", versionId: "v-1", dimensionId: "d-1",
    vicpMaterialId: "m-1", competitorMaterialId: "m-2",
    vicpValue: 0.032, vicpUnit: "W/(m·K)",
    competitorValue: 0.042, competitorUnit: "W/(m·K)",
    advantageText: "x", applicability: "y", mandatoryDisclosure: "z"
  };
  const vicpMaterial = { id: "m-1", versionId: "v-1", category: "VICP" };
  const epsMaterial = { id: "m-2", versionId: "v-1", category: "EPS" };

  it("版本无规则时提示无法提交审核", async () => {
    const { db } = makeDb([[]]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations[0]).toMatchObject({ field: "rules", message: expect.stringContaining("没有任何对比规则") });
  });

  it("证据齐全、数值与文案完整时无违规", async () => {
    const { db } = makeDb([
      [rule],
      [vicpMaterial, epsMaterial],
      [
        { id: "e-1", ruleId: "r-1", side: "VICP" },
        { id: "e-2", ruleId: "r-1", side: "COMPETITOR" }
      ],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations).toEqual([]);
  });

  it("缺少 VICP 侧证据时违规", async () => {
    const { db } = makeDb([
      [rule],
      [vicpMaterial, epsMaterial],
      [{ id: "e-1", ruleId: "r-1", side: "COMPETITOR" }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations.some((v) => v.message.includes("必须至少有一条 VICP 侧证据"))).toBe(true);
  });

  it("竞品侧数值存在但无竞品侧证据时违规", async () => {
    const { db } = makeDb([
      [rule],
      [vicpMaterial, epsMaterial],
      [{ id: "e-1", ruleId: "r-1", side: "VICP" }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations.some((v) => v.message.includes("必须提供竞品侧证据"))).toBe(true);
  });

  it("生效时间晚于失效时间时违规", async () => {
    const { db } = makeDb([
      [rule],
      [vicpMaterial, epsMaterial],
      [{ id: "e-1", ruleId: "r-1", side: "VICP" }],
      [{ effectiveAt: new Date("2026-12-31"), expiresAt: new Date("2026-01-01") }]
    ]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations.some((v) => v.message.includes("生效时间晚于失效时间"))).toBe(true);
  });
});