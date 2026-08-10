import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { applyThermalImportJob } from "./thermal.service.js";

/**
 * drizzle 链式最小桩（与 construction-workflow.test.ts 同款）：
 * - rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）
 * - insert 无 returning 时走 then（如审计日志）；带 returning 时走 returning
 * - failInsertOn 可选：insert values 匹配时让 then/returning 都 reject 唯一冲突（code 23505），
 *   模拟事务内冲突触发整体回滚
 * - transaction 直接执行回调（回调内的 db 即桩本身）
 */
function makeDb(
  rows: Array<Array<Record<string, unknown>>>,
  options: { failInsertOn?: (values: unknown) => boolean } = {}
): {
  db: any;
  setCalls: Array<Record<string, unknown>>;
  insertCalls: Array<unknown>;
  deleteCalls: Array<unknown>;
} {
  let i = 0;
  const setCalls: Array<Record<string, unknown>> = [];
  const insertCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    returning: async () => next(),
    orderBy: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values);
        return { where: () => chain() };
      }
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push(values);
        if (options.failInsertOn?.(values)) {
          const failure = Promise.reject({ code: "23505" });
          return {
            returning: async () => failure,
            then: (_resolve: (v: unknown) => void, reject: (e: unknown) => void) => failure.then(undefined, reject)
          };
        }
        return {
          returning: async () => next(),
          then: (resolve: (v: unknown) => void) => Promise.resolve(next()).then(resolve)
        };
      }
    }),
    delete: () => ({
      where: (values: unknown) => {
        deleteCalls.push(values);
        return chain();
      }
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, setCalls, insertCalls, deleteCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const jobRow = {
  id: "job-1",
  setCode: "ATLAS-2026",
  name: "图集 X 选用表",
  fileId: "file-1",
  status: "PARSED",
  errorCount: 0,
  rowCount: 2,
  validCount: 2,
  result: [
    { schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20, productThermalResistance: 2.31, totalThermalResistance: 3.15, kValue: 0.35, rawThickness: "20mm", rawProductResistance: "2.31", rawTotalResistance: "3.15", rawKValue: "0.35", evidenceSource: "图集 X", evidenceRef: "P12" },
    { schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 25, productThermalResistance: 2.89, totalThermalResistance: 3.73, kValue: 0.3, rawThickness: "25mm", rawProductResistance: "2.89", rawTotalResistance: "3.73", rawKValue: "0.3", evidenceSource: "图集 X", evidenceRef: "P12" }
  ]
};

describe("applyThermalImportJob 事务应用", () => {
  it("无目标集：创建 DRAFT v1 并批量插入全部有效行", async () => {
    const createdSet = { id: "set-1", code: "ATLAS-2026", version: 1, status: "DRAFT" };
    const updatedJob = { ...jobRow, status: "APPLIED", setId: "set-1" };
    const { db, insertCalls, setCalls } = makeDb([
      [jobRow],      // 1. requireImportJob
      [],            // 2. 查询最新集（无）
      [createdSet],  // 3. insert sets returning
      [],            // 4. 审计（集创建）
      [],            // 5. 查询现有参考行（无）
      [],            // 6. insert rows（批量 added，then）
      [updatedJob],  // 7. update jobs returning
      []             // 8. 审计（导入应用）
    ]);
    const result = await applyThermalImportJob(app(db), request, actor, "job-1", false);
    expect(result).toMatchObject({ applied: 2, updated: 0, skippedRemoved: 0 });
    expect(result.set).toMatchObject({ id: "set-1", code: "ATLAS-2026", version: 1, status: "DRAFT" });

    // 集插入：DRAFT v1，业务字段来自 job；审计日志插在 sets 之后
    expect(insertCalls[0]).toMatchObject({ code: "ATLAS-2026", version: 1, name: "图集 X 选用表", status: "DRAFT", createdById: "u-1" });
    // 行批量插入：setId 指向新集，raw 原样保留
    const rowInserts = insertCalls[2] as Array<Record<string, unknown>>;
    expect(rowInserts).toHaveLength(2);
    expect(rowInserts[0]).toMatchObject({ setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20, rawThickness: "20mm", evidenceLevel: "A" });
    // job 置 APPLIED
    expect(setCalls.at(-1)).toMatchObject({ status: "APPLIED", setId: "set-1", appliedById: "u-1" });
  });

  it("复用最新 DRAFT 集：changed 更新、removed 仅提示不删除、同值行跳过", async () => {
    const draftSet = { id: "set-1", code: "ATLAS-2026", version: 2, status: "DRAFT" };
    const existing = [
      // 与导入第 1 行同键但 K 值不同 -> changed
      { id: "row-a", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20, productThermalResistance: 2.31, totalThermalResistance: 3.15, kValue: 0.4, evidenceSource: "图集 X", evidenceRef: "P12" },
      // 与导入第 2 行同键同值 -> 无变化
      { id: "row-b", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 25, productThermalResistance: 2.89, totalThermalResistance: 3.73, kValue: 0.3, evidenceSource: "图集 X", evidenceRef: "P12" },
      // 不在导入中 -> removed（仅提示）
      { id: "row-c", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 30, productThermalResistance: 3.5, totalThermalResistance: 4.3, kValue: 0.26, evidenceSource: "图集 X", evidenceRef: "P12" }
    ];
    const updatedJob = { ...jobRow, status: "APPLIED", setId: "set-1" };
    const { db, insertCalls, setCalls, deleteCalls } = makeDb([
      [jobRow],
      [draftSet],
      [existing[0], existing[1], existing[2]],
      [],            // update rows（changed，无 returning，then）
      [updatedJob],  // update jobs returning
      []             // 审计
    ]);
    const result = await applyThermalImportJob(app(db), request, actor, "job-1", false);
    // added=0：20mm 键存在（changed）、25mm 键存在（同值跳过），导入无新键
    expect(result).toMatchObject({ applied: 0, updated: 1, skippedRemoved: 1 });
    expect(result.set).toMatchObject({ id: "set-1", version: 2, status: "DRAFT" });

    // 无批量插入（仅审计日志插在事务中）
    expect(insertCalls.filter((call) => Array.isArray(call))).toEqual([]);
    // changed 更新：K 值 0.4 -> 0.35
    const updateCall = setCalls.find((call) => (call as any).kValue !== undefined) as any;
    expect(updateCall).toMatchObject({ kValue: 0.35, evidenceSource: "图集 X", updatedById: "u-1" });
    // removed 不删除
    expect(deleteCalls).toEqual([]);
  });

  it("最新集非 DRAFT（PUBLISHED）：拒绝应用并提示派生新版本", async () => {
    const publishedSet = { id: "set-1", code: "ATLAS-2026", version: 3, status: "PUBLISHED" };
    const { db, insertCalls } = makeDb([
      [jobRow],
      [publishedSet]
    ]);
    await expect(applyThermalImportJob(app(db), request, actor, "job-1", false))
      .rejects.toThrow("请先派生新版本草稿或更换集编码");
    // 未发生任何写入
    expect(insertCalls).toEqual([]);
  });

  it("错误行默认拒绝应用（未显式 ignoreErrors），不产生任何写入", async () => {
    const { db, insertCalls, setCalls } = makeDb([
      [{ ...jobRow, errorCount: 3, rowCount: 5, validCount: 2 }]
    ]);
    await expect(applyThermalImportJob(app(db), request, actor, "job-1", false))
      .rejects.toThrow("需显式确认忽略");
    expect(insertCalls).toEqual([]);
    expect(setCalls).toEqual([]);
  });

  it("ignoreErrors=true 显式跳过错误行后正常应用", async () => {
    const dirtyJob = { ...jobRow, errorCount: 3 };
    const createdSet = { id: "set-1", code: "ATLAS-2026", version: 1, status: "DRAFT" };
    const updatedJob = { ...dirtyJob, status: "APPLIED", setId: "set-1" };
    const { db } = makeDb([
      [dirtyJob],
      [],
      [createdSet],
      [],
      [],
      [],
      [updatedJob],
      []
    ]);
    const result = await applyThermalImportJob(app(db), request, actor, "job-1", true);
    expect(result).toMatchObject({ applied: 2, updated: 0, skippedRemoved: 0 });
  });

  it("唯一冲突（23505）整体回滚并写 APPLY_CONFLICT 错误行", async () => {
    const draftSet = { id: "set-1", code: "ATLAS-2026", version: 1, status: "DRAFT" };
    const { db, insertCalls } = makeDb(
      [
        [jobRow],
        [draftSet],
        []  // select rows：added 全部命中冲突（同键行已存在）
      ],
      { failInsertOn: (values) => Array.isArray(values) }
    );
    await expect(applyThermalImportJob(app(db), request, actor, "job-1", false))
      .rejects.toThrow("参考行唯一约束冲突，导入已整体回滚");
    // 最后一条 insert 是 APPLY_CONFLICT 错误行
    const lastInsert = insertCalls.at(-1) as Record<string, unknown>;
    expect(lastInsert).toMatchObject({ jobId: "job-1", rowNumber: 0, errorType: "APPLY_CONFLICT", message: expect.stringContaining("整个导入已回滚") });
  });
});