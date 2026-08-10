import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  collectThermalSetViolations,
  createThermalRow,
  createThermalSetNextVersion,
  updateThermalRow,
  validateThermalSet
} from "./thermal.service.js";

/** drizzle 链式最小桩（同 thermal-apply.test.ts）：rows 按调用顺序消耗 */
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

describe("createThermalSetNextVersion 派生新版本", () => {
  const publishedSet = {
    id: "set-1", code: "ATLAS-2026", version: 1, status: "PUBLISHED", name: "图集 X",
    description: null, atlasDocumentId: null, evidenceSource: "图集 X", evidenceRef: null,
    evidenceLevel: "A", effectiveAt: null, expiresAt: null, changeNote: null,
    createdById: "u-0", updatedById: "u-0"
  };

  it("复制全部参考行到新 DRAFT 版本（历史快照不漂移）", async () => {
    const newSet = { ...publishedSet, id: "set-2", version: 2, status: "DRAFT" };
    const rows = [
      { id: "row-1", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20, productThermalResistance: 2.31, totalThermalResistance: 3.15, kValue: 0.35, rawThickness: "20mm", rawProductResistance: "2.31", rawTotalResistance: "3.15", rawKValue: "0.35", evidenceSource: "图集 X", evidenceRef: "P12", evidenceLevel: "A", createdById: "u-0", updatedById: "u-0" },
      { id: "row-2", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 25, productThermalResistance: 2.89, totalThermalResistance: 3.73, kValue: 0.3, rawThickness: "25mm", rawProductResistance: "2.89", rawTotalResistance: "3.73", rawKValue: "0.3", evidenceSource: "图集 X", evidenceRef: "P13", evidenceLevel: "A", createdById: "u-0", updatedById: "u-0" }
    ];
    const { db, insertCalls } = makeDb([
      [publishedSet],      // 1. requireRow
      [{ max: 1 }],        // 2. nextVersionNumber
      [newSet],            // 3. insert 父集 returning
      [rows[0], rows[1]],  // 4. copyThermalRows: select 旧集行
      [],                  // 5. copyThermalRows: insert 批量（then）
      []                   // 6. 审计
    ]);
    const created = await createThermalSetNextVersion(app(db), request, actor, "set-1", "依据新版图集修订");
    expect(created).toMatchObject({ id: "set-2", code: "ATLAS-2026", version: 2, status: "DRAFT" });

    // 父集：version+1、DRAFT、业务字段保留
    expect(insertCalls[0]).toMatchObject({ code: "ATLAS-2026", version: 2, status: "DRAFT", changeNote: "依据新版图集修订" });
    // 子行批量复制：setId 指向新集，业务字段原样
    const copied = insertCalls[1] as Array<Record<string, unknown>>;
    expect(copied).toHaveLength(2);
    expect(copied[0]).toMatchObject({
      setId: "set-2", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20,
      rawThickness: "20mm", kValue: 0.35, evidenceSource: "图集 X", evidenceRef: "P12"
    });
    expect(copied[0]).not.toHaveProperty("id");
  });

  it("源集无行时不执行子表插入", async () => {
    const newSet = { ...publishedSet, id: "set-2", version: 2, status: "DRAFT" };
    const { db, insertCalls } = makeDb([
      [publishedSet],
      [{ max: 1 }],
      [newSet],
      [],  // select 旧集行（空）
      []   // 审计
    ]);
    const created = await createThermalSetNextVersion(app(db), request, actor, "set-1");
    expect(created).toMatchObject({ id: "set-2", version: 2 });
    expect(insertCalls.filter((call) => Array.isArray(call))).toEqual([]);
  });
});

describe("参考行状态守卫", () => {
  it("集状态 PUBLISHED 时新增行抛 409 状态冲突", async () => {
    const { db } = makeDb([
      [{ id: "set-1", code: "ATLAS-2026", version: 3, status: "PUBLISHED" }]
    ]);
    await expect(createThermalRow(app(db), request, actor, "set-1", {
      schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20,
      productThermalResistance: 2.31, totalThermalResistance: 3.15, kValue: 0.35,
      evidenceSource: "图集 X", evidenceRef: "P12"
    })).rejects.toThrow("当前状态（PUBLISHED）不允许执行该操作");
  });

  it("更新不存在的参考行抛 404", async () => {
    const { db } = makeDb([
      []  // select rows limit
    ]);
    await expect(updateThermalRow(app(db), request, actor, "row-missing", { kValue: 0.3 }))
      .rejects.toThrow("图集热工参考行不存在");
  });
});

describe("collectThermalSetViolations / validateThermalSet", () => {
  const row = {
    id: "row-1", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1",
    thicknessMm: 20, productThermalResistance: 2.31, totalThermalResistance: 3.15,
    kValue: 0.35, evidenceSource: "图集 X", evidenceRef: "P12"
  };

  it("方案已发布且生效、厚度在区间内、数值与证据齐全 -> 无违规", async () => {
    const now = new Date();
    const { db } = makeDb([
      [row],
      [{ id: "scheme-1", status: "PUBLISHED", effectiveAt: new Date(now.getTime() - 86400000), expiresAt: null }],
      [{ id: "opt-1", schemeId: "scheme-1", productSpecId: "spec-1", minThickness: 15, maxThickness: 30 }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectThermalSetViolations(app(db), "set-1");
    expect(violations).toEqual([]);
  });

  it("方案未发布 -> 违规提示引用未发布方案", async () => {
    const { db } = makeDb([
      [row],
      [{ id: "scheme-1", status: "DRAFT", effectiveAt: null, expiresAt: null }],
      [],
      []
    ]);
    const violations = await collectThermalSetViolations(app(db), "set-1");
    expect(violations[0]).toMatchObject({ field: "rows.schemeId", message: expect.stringContaining("未发布或已失效") });
  });

  it("厚度超出方案区间 -> 违规提示区间范围", async () => {
    const { db } = makeDb([
      [row],
      [{ id: "scheme-1", status: "PUBLISHED", effectiveAt: null, expiresAt: null }],
      [{ id: "opt-1", schemeId: "scheme-1", productSpecId: "spec-1", minThickness: 25, maxThickness: 50 }],
      [{ effectiveAt: null, expiresAt: null }]
    ]);
    const violations = await collectThermalSetViolations(app(db), "set-1");
    expect(violations[0]).toMatchObject({ field: "rows.thicknessMm", message: expect.stringContaining("[25, 50]mm") });
  });

  it("validateThermalSet 遇空集直接抛 THERMAL_STRUCTURE_INVALID", async () => {
    const { db } = makeDb([
      []  // select rows（空）
    ]);
    await expect(validateThermalSet(app(db), "set-1"))
      .rejects.toThrow("参考集没有任何参考行，无法提交审核");
  });
});