import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import {
  formatComparisonRuleContext,
  loadApprovedComparisonRules,
  logComparisonRuleUsage
} from "./material-compare.service.js";

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
        return { then: (resolve: (v: unknown) => void) => Promise.resolve(next()).then(resolve) };
      }
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const app = (db: any) => ({ db }) as unknown as FastifyInstance;
const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;

const material = (id: string, category: string, name: string, model: string) => ({
  id, versionId: "v-1", category, name, model,
  density: 40, densityUnit: "kg/m³", testConditions: "23℃，RH50%",
  description: null, evidenceSource: null, evidenceRef: null, evidenceLevel: "A",
  effectiveAt: null, expiresAt: null, createdById: null, updatedById: null,
  createdAt: new Date(), updatedAt: new Date()
});

const publishedVersion = {
  id: "v-1", code: "VICP-VS-EPS-2026", version: 1, status: "PUBLISHED",
  name: "VICP 对比 EPS", effectiveAt: null, expiresAt: null, updatedAt: new Date()
};

const rule = {
  id: "r-1", versionId: "v-1", dimensionId: "d-1",
  dimensionName: "保温", subIndicatorName: "导热系数",
  vicpMaterialId: "m-1", competitorMaterialId: "m-2",
  benchmarkType: "SAME_THICKNESS", benchmarkDesc: "同厚度 50mm 对比",
  vicpValue: 0.032, vicpUnit: "W/(m·K)",
  competitorValue: 0.042, competitorUnit: "W/(m·K)",
  advantageText: "导热系数低于竞品 24%",
  applicability: "适用于外墙外保温系统的 XPS 对比场景",
  mandatoryDisclosure: "数值以第三方检测报告为准，项目设计需复核热工计算",
  forbiddenWording: "不得使用'绝对保温'等绝对化用语",
  sortOrder: 0, createdById: null, updatedById: null,
  createdAt: new Date(), updatedAt: new Date(),
  ruleCode: "VICP-VS-EPS-2026", ruleVersion: 1,
  vicpMaterial: material("m-1", "VICP", "VICP 保温板", "V-50"),
  competitorMaterial: material("m-2", "EPS", "EPS 板", "E-50"),
  evidence: [{
    id: "e-1", versionId: "v-1", ruleId: "r-1", materialId: null,
    side: "VICP", source: "VICP 产品检测报告", pageRef: "P12", clauseRef: null,
    evidenceLevel: "A", quote: null, createdById: null, createdAt: new Date(), updatedAt: new Date()
  }]
};

describe("loadApprovedComparisonRules", () => {
  it("只读已发布规则并按 limit 截断", async () => {
    const rule2 = {
      ...rule, id: "r-2", ruleCode: "VICP-VS-EPS-2026", ruleVersion: 1,
      vicpMaterialId: "m-3", competitorMaterialId: "m-4",
      vicpMaterial: material("m-3", "VICP", "VICP 保温板", "V-100"),
      competitorMaterial: material("m-4", "XPS", "XPS 板", "X-50")
    };
    const { db } = makeDb([
      [publishedVersion],
      [rule, rule2],
      [
        rule.vicpMaterial, rule.competitorMaterial,
        rule2.vicpMaterial, rule2.competitorMaterial
      ],
      [rule.evidence[0], { ...rule.evidence[0], id: "e-2", ruleId: "r-2" }]
    ]);
    const loaded = await loadApprovedComparisonRules(app(db), { limit: 1 });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("r-1");
    expect(loaded[0]).toMatchObject({ ruleCode: "VICP-VS-EPS-2026", ruleVersion: 1 });
  });

  it("无已发布版本时返回空数组", async () => {
    const { db } = makeDb([[]]);
    const loaded = await loadApprovedComparisonRules(app(db), {});
    expect(loaded).toEqual([]);
  });
});

describe("formatComparisonRuleContext", () => {
  it("空规则返回空字符串", () => {
    expect(formatComparisonRuleContext([])).toBe("");
  });

  it("完整规则渲染出维度/基准/数值/适用条件/必要披露/证据", () => {
    const text = formatComparisonRuleContext([rule as any]);
    expect(text).toContain("【已审核材料对比规则");
    expect(text).toContain("维度：保温（导热系数）");
    expect(text).toContain("比较基准：同厚度 50mm 对比");
    expect(text).toContain("VICP（VICP 保温板（V-50），密度 40kg/m³，测试条件：23℃，RH50%）：0.032 W/(m·K)");
    expect(text).toContain("竞品（EPS 板（E-50）");
    expect(text).toContain("VICP 优势（须按此口径表述）：导热系数低于竞品 24%");
    expect(text).toContain("适用条件（必须输出）：适用于外墙外保温系统的 XPS 对比场景");
    expect(text).toContain("必要披露与风险提示（必须输出）：数值以第三方检测报告为准");
    expect(text).toContain("证据：");
    expect(text).toContain("《VICP 产品检测报告》第P12页（证据等级 A，VICP 侧）");
  });

  it("竞品侧数值缺失时提示不得生成对方负面结论", () => {
    const partialRule = { ...rule, competitorValue: null, competitorUnit: null } as any;
    const text = formatComparisonRuleContext([partialRule]);
    expect(text).toContain("竞品侧定量数据缺失：只陈述 VICP 自身已验证表现，不得生成对方负面结论");
  });
});

describe("logComparisonRuleUsage", () => {
  it("批量写入使用日志并保存规则快照", async () => {
    const { db, insertCalls } = makeDb([
      [] // insert values await
    ]);
    await logComparisonRuleUsage(app(db), actor, {
      conversationId: "conv-1",
      messageId: "msg-1",
      rules: [rule as any]
    });
    const values = insertCalls[0] as Array<Record<string, unknown>>;
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      conversationId: "conv-1",
      messageId: "msg-1",
      ruleId: "r-1",
      ruleCode: "VICP-VS-EPS-2026",
      versionId: "v-1",
      ruleVersion: 1
    });
    const snapshot = values[0]!.ruleSnapshot as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      ruleId: "r-1",
      versionCode: "VICP-VS-EPS-2026",
      ruleVersion: 1,
      dimensionName: "保温",
      vicpValue: 0.032,
      mandatoryDisclosure: "数值以第三方检测报告为准，项目设计需复核热工计算",
      usedBy: { userId: "u-1" }
    });
  });

  it("无规则时不写入日志", async () => {
    const { db, insertCalls } = makeDb([]);
    await logComparisonRuleUsage(app(db), actor, { conversationId: "conv-1", rules: [] });
    expect(insertCalls).toEqual([]);
  });
});