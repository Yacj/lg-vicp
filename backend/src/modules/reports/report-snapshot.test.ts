import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { assembleReportSnapshot } from "./report-snapshot.service.js";

/** drizzle 链式最小桩（与 construction-workflow.test.ts 同款） */
function makeDb(rows: Array<Array<Record<string, unknown>>>): { db: any; insertCalls: Array<Record<string, unknown>> } {
  let i = 0;
  const insertCalls: Array<Record<string, unknown>> = [];
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
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: () => void) => Promise.resolve().then(resolve) };
      }
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const projectRow = {
  id: "p-1", name: "某住宅楼外墙保温项目", description: "示范项目", region: "苏州", buildingType: "RESIDENTIAL",
  visibility: "PRIVATE", status: "ACTIVE", createdAt: new Date("2026-01-01")
};

const selectionRow = {
  id: "sel-1", projectId: "p-1", requestId: null, queryJson: { regionCode: "320500", buildingType: "RESIDENTIAL" },
  candidateJson: {
    scheme: { id: "sc-1", schemeCode: "A1-1" }, system: { id: "sys-1", name: "VICP 外墙外保温系统" }, productSpec: { id: "ps-1" },
    evidence: { source: "江苏图集苏 J/T15-2025", ref: "P38" }
  },
  selectionReason: "满足苏州地区限值且经济性最优", selectedById: "u-1", createdAt: new Date("2026-01-10")
};

const templateRow = {
  id: "tpl-1", code: "standard_report", version: 1, name: "标准工程报告", status: "PUBLISHED",
  sectionsJson: [{ key: "enterprise", title: "企业介绍", enabled: true, order: 1, sourceType: "DATA" }]
};

const profileRow = { id: "ep-1", code: "company_profile", version: 3, name: "蓝格节能科技有限公司", status: "PUBLISHED" };

describe("报告快照组装（数值冻结，历史不漂移）", () => {
  it("项目/模板校验通过后冻结章节数据，企业来自已发布读取", async () => {
    const { db } = makeDb([
      [projectRow],
      [selectionRow],
      [templateRow],
      [profileRow]
    ]);
    const { dataJson } = await assembleReportSnapshot(app(db), { projectId: "p-1", selectionId: "sel-1", templateId: "tpl-1" });
    expect(dataJson.project).toMatchObject({ id: "p-1", name: "某住宅楼外墙保温项目" });
    expect(dataJson.enterprise).toMatchObject({ name: "蓝格节能科技有限公司" });
    expect(dataJson.template).toMatchObject({ code: "standard_report", version: 1 });
    expect(dataJson.selection).toMatchObject({ id: "sel-1", selectionReason: "满足苏州地区限值且经济性最优" });
    expect(typeof dataJson.asOfDate).toBe("string");
    // 快照携带模板章节配置（渲染层按配置输出，TEXT 章节文案来自配置）
    expect((dataJson.template as any).sections).toHaveLength(1);
  });

  it("selection 不属于项目时拒绝组装", async () => {
    const { db } = makeDb([[projectRow], [{ ...selectionRow, projectId: "p-other" }]]);
    await expect(assembleReportSnapshot(app(db), { projectId: "p-1", selectionId: "sel-1", templateId: "tpl-1" }))
      .rejects.toThrow("候选方案确认记录不属于当前项目");
  });

  it("模板未发布或已失效时拒绝组装", async () => {
    const { db } = makeDb([[projectRow], [selectionRow], []]);
    await expect(assembleReportSnapshot(app(db), { projectId: "p-1", selectionId: "sel-1", templateId: "tpl-1" }))
      .rejects.toThrow("报告模板未发布或已失效");
  });

  it("热工计算记录按 requestId + 项目归属关联并整份冻结", async () => {
    const calcRow = {
      id: "calc-1", requestId: "req-1", projectId: "p-1", mode: "REFERENCE_TABLE",
      ruleJson: { name: "江苏民用建筑热工设计限值", evidenceSource: "DGJ32/J 23-2016", evidenceRef: "4.2.1" },
      standardJson: { basisName: "苏州地区限值", clauseRef: "表4.2.1-1" },
      resultJson: { kValue: 0.45 }, createdAt: new Date("2026-01-10")
    };
    const selectionWithCalc = { ...selectionRow, requestId: "req-1" };
    const { db } = makeDb([
      [projectRow],
      [selectionWithCalc],
      [templateRow],
      [calcRow],
      [profileRow]
    ]);
    const { dataJson } = await assembleReportSnapshot(app(db), { projectId: "p-1", selectionId: "sel-1", templateId: "tpl-1" });
    expect(dataJson.calcRecords).toHaveLength(1);
    expect((dataJson.calcRecords as any[])[0]).toMatchObject({ mode: "REFERENCE_TABLE", requestId: "req-1" });
    // 来源章节聚合计算记录证据，不吞掉来源与页码
    const sources = dataJson.sources as Array<Record<string, unknown>>;
    expect(sources[0]).toMatchObject({ type: "candidate" });
    expect(sources[1]).toMatchObject({ type: "calc", ruleRef: "4.2.1" });
  });
});