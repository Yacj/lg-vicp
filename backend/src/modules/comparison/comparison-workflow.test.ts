import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { collectComparisonViolations, copyComparisonChildren, validateComparison } from "./comparison.service.js";

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
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: (v: unknown) => void) => Promise.resolve(next()).then(resolve) };
      }
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const app = (db: any) => ({ db }) as unknown as FastifyInstance;

describe("copyComparisonChildren 派生新版本复制", () => {
  const oldMaterials = [
    { id: "m-1", versionId: "v-1", category: "VICP", name: "VICP 板", model: "V-50", density: 40, densityUnit: "kg/m³", testConditions: "23℃", description: null, evidenceSource: "检测报告", evidenceRef: null, evidenceLevel: "A", effectiveAt: null, expiresAt: null, createdById: "u-0", updatedById: "u-0" },
    { id: "m-2", versionId: "v-1", category: "EPS", name: "EPS 板", model: "E-50", density: 18, densityUnit: "kg/m³", testConditions: null, description: null, evidenceSource: "检测报告", evidenceRef: null, evidenceLevel: "A", effectiveAt: null, expiresAt: null, createdById: "u-0", updatedById: "u-0" }
  ];
  const oldRules = [{
    id: "r-1", versionId: "v-1", dimensionId: "d-1", dimensionName: "保温", subIndicatorName: "导热系数",
    vicpMaterialId: "m-1", competitorMaterialId: "m-2",
    benchmarkType: "SAME_THICKNESS", benchmarkDesc: "同厚度 50mm",
    vicpValue: 0.032, vicpUnit: "W/(m·K)", competitorValue: 0.042, competitorUnit: "W/(m·K)",
    advantageText: "x", applicability: "y", mandatoryDisclosure: "z", forbiddenWording: null,
    sortOrder: 0, createdById: "u-0", updatedById: "u-0"
  }];
  const oldEvidence = [{
    id: "e-1", versionId: "v-1", ruleId: "r-1", materialId: "m-1", side: "VICP",
    source: "检测报告", pageRef: "P12", clauseRef: null, evidenceLevel: "A", quote: null,
    createdById: "u-0", updatedById: "u-0"
  }];

  it("材料/规则/证据全套复制并重映射内部 FK", async () => {
    const { db, insertCalls } = makeDb([
      [oldMaterials[0], oldMaterials[1]], // select 旧材料
      [{ id: "m-1-new" }],                 // insert 材料 1 returning
      [{ id: "m-2-new" }],                 // insert 材料 2 returning
      [oldRules[0]],                       // select 旧规则
      [{ id: "r-1-new" }],                 // insert 规则 returning
      [oldEvidence[0]],                    // select 旧证据
      []                                   // insert 证据（批量，await 消耗）
    ]);
    await copyComparisonChildren(db, { id: "v-1" }, { id: "v-2" });

    // 材料复制：versionId 指向新版本
    expect(insertCalls[0]).toMatchObject({ versionId: "v-2", category: "VICP", density: 40 });
    expect(insertCalls[1]).toMatchObject({ versionId: "v-2", category: "EPS", density: 18 });
    // 规则复制：双方材料 FK 重映射到新材料
    expect(insertCalls[2]).toMatchObject({
      versionId: "v-2",
      vicpMaterialId: "m-1-new",
      competitorMaterialId: "m-2-new",
      dimensionName: "保温",
      benchmarkType: "SAME_THICKNESS"
    });
    // 证据复制：ruleId/materialId FK 重映射
    const copiedEvidence = insertCalls[3] as Array<Record<string, unknown>>;
    expect(copiedEvidence).toHaveLength(1);
    expect(copiedEvidence[0]).toMatchObject({ versionId: "v-2", ruleId: "r-1-new", materialId: "m-1-new", side: "VICP" });
  });

  it("旧版本无任何子行时不执行插入", async () => {
    const { db, insertCalls } = makeDb([
      [],  // select 旧材料（空）
      [],  // select 旧规则（空）
      []   // select 旧证据（空）
    ]);
    await copyComparisonChildren(db, { id: "v-1" }, { id: "v-2" });
    expect(insertCalls).toEqual([]);
  });
});

describe("validateComparison（submit/publish 前置钩子）", () => {
  it("结构违规时抛 COMPARISON_STRUCTURE_INVALID", async () => {
    const { db } = makeDb([[]]); // 无规则
    await expect(validateComparison(app(db), "v-1"))
      .rejects.toThrow("版本没有任何对比规则，无法提交审核");
  });

  it("通过时正常返回", async () => {
    const rule = {
      id: "r-1", versionId: "v-1", dimensionId: "d-1",
      vicpMaterialId: "m-1", competitorMaterialId: "m-2",
      vicpValue: 0.032, vicpUnit: "W/(m·K)", competitorValue: null, competitorUnit: null,
      advantageText: "x", applicability: "y", mandatoryDisclosure: "z"
    };
    const { db } = makeDb([
      [rule],
      [
        { id: "m-1", versionId: "v-1", category: "VICP" },
        { id: "m-2", versionId: "v-1", category: "EPS" }
      ],
      [{ id: "e-1", ruleId: "r-1", side: "VICP" }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    await expect(validateComparison(app(db), "v-1")).resolves.toBeUndefined();
  });
});

describe("collectComparisonViolations 引用完整性", () => {
  it("规则引用的材料查不到时违规", async () => {
    const rule = {
      id: "r-1", versionId: "v-1", dimensionId: "d-1",
      vicpMaterialId: "m-1", competitorMaterialId: "m-2",
      vicpValue: 0.032, vicpUnit: "W/(m·K)", competitorValue: null, competitorUnit: null,
      advantageText: "x", applicability: "y", mandatoryDisclosure: "z"
    };
    const { db } = makeDb([
      [rule],
      [],   // 材料查不到
      [{ id: "e-1", ruleId: "r-1", side: "VICP" }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectComparisonViolations(app(db), "v-1");
    expect(violations.some((v) => v.message.includes("VICP 侧材料缺失或类别不正确"))).toBe(true);
    expect(violations.some((v) => v.message.includes("竞品侧材料缺失或类别不正确"))).toBe(true);
  });
});