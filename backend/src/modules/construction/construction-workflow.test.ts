import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { submitForReview } from "../masterdata/md-workflow.service.js";
import {
  createConstructionLayer,
  createSchemeNextVersion,
  deleteConstructionScheme
} from "./construction.service.js";

/**
 * drizzle 链式最小桩（与 md-workflow.test.ts 同款，扩展 delete/orderBy）：
 * - rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）
 * - transaction 直接执行回调（回调内的 db 即桩本身），记录每次 set / insert values 用于断言
 * - createSchemeNextVersion 查询顺序：
 *   requireRow(limit) -> nextVersionNumber(max) -> insert scheme(returning)
 *   -> layers select -> insert layers -> options select -> insert options
 *   -> documents select -> insert documents -> 审计日志 insert
 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): {
  db: any;
  setCalls: Array<Record<string, unknown>>;
  insertCalls: Array<Record<string, unknown>>;
} {
  let i = 0;
  const setCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
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
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: () => void) => Promise.resolve().then(resolve) };
      }
    }),
    delete: () => ({
      where: () => chain()
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, setCalls, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const schemeRow = {
  id: "row-1", systemId: "sys-1", schemeCode: "A1-1", version: 1, status: "PUBLISHED",
  name: "外墙外保温", substrateMaterial: "钢筋混凝土", createdById: "u-old", publishedById: "u-old"
};

const layerRow = {
  schemeId: "row-1", layerOrder: 1, layerType: "PRODUCT_LAYER", layerName: "XPS 保温板",
  materialId: "mat-1", thickness: 30
};
const optionRow = {
  schemeId: "row-1", productSpecId: "ps-1", minThickness: 10, maxThickness: 40, defaultThickness: 30
};
const docRow = {
  targetType: "SCHEME", targetId: "row-1", knowledgeDocumentId: "kd-1", atlasPage: "P12"
};

describe("构造方案 new-version（子表同事务复制）", () => {
  it("派生 DRAFT 新行（version+1）并复制层/产品选项/文档，schemeId 指向新行", async () => {
    const newRow = { ...schemeRow, id: "row-2", version: 2, status: "DRAFT" };
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [{ max: 1 }],
      [newRow],
      [layerRow],
      [optionRow],
      [docRow]
    ]);
    const result = await createSchemeNextVersion(app(db), request, actor, "row-1", "v2 修订层序");
    expect(result).toMatchObject({ version: 2, status: "DRAFT", schemeCode: "A1-1", systemId: "sys-1" });

    // 1) 父行插入：系统列不复制，version+1，状态 DRAFT
    const schemeInsert = insertCalls[0] as any;
    expect(schemeInsert).toMatchObject({ version: 2, status: "DRAFT", schemeCode: "A1-1", createdById: "u-1", updatedById: "u-1", changeNote: "v2 修订层序" });
    expect(schemeInsert.id).toBeUndefined();
    expect(schemeInsert.publishedById).toBeUndefined();

    // 2) 构造层复制：schemeId -> 新行，业务字段原样保留（values 为批量插入数组）
    const layerInsert = insertCalls[1] as Array<Record<string, unknown>>;
    expect(layerInsert[0]).toMatchObject({ schemeId: "row-2", layerOrder: 1, layerType: "PRODUCT_LAYER", layerName: "XPS 保温板", materialId: "mat-1", thickness: 30 });
    expect(layerInsert[0]!.id).toBeUndefined();

    // 3) 产品选项复制
    const optionInsert = insertCalls[2] as Array<Record<string, unknown>>;
    expect(optionInsert[0]).toMatchObject({ schemeId: "row-2", productSpecId: "ps-1", minThickness: 10, maxThickness: 40, defaultThickness: 30 });

    // 4) 方案文档复制：targetId 指向新行
    const docInsert = insertCalls[3] as Array<Record<string, unknown>>;
    expect(docInsert[0]).toMatchObject({ targetType: "SCHEME", targetId: "row-2", knowledgeDocumentId: "kd-1", atlasPage: "P12" });
  });
});

describe("构造模块注册的实体复用通用状态机", () => {
  it("submit：构造方案 DRAFT -> PENDING_REVIEW（经 registerVersionedEntity 注册后直接可用）", async () => {
    const draftRow = { ...schemeRow, status: "DRAFT" };
    const { db, setCalls } = makeDb([[draftRow], [{ ...draftRow, status: "PENDING_REVIEW" }]]);
    const result = await submitForReview(app(db), request, actor, "constructionScheme", "row-1");
    expect(result.status).toBe("PENDING_REVIEW");
    expect(setCalls[0]).toMatchObject({ status: "PENDING_REVIEW", submittedById: "u-1" });
  });
});

describe("构造子表状态守卫", () => {
  it("父方案已发布时禁止新增构造层", async () => {
    const { db } = makeDb([[{ ...schemeRow, status: "PUBLISHED" }]]);
    await expect(createConstructionLayer(app(db), request, actor, "row-1", {
      layerOrder: 1, layerType: "FIXING_LAYER", layerName: "砂浆找平层"
    })).rejects.toThrow("不允许执行该操作");
  });

  it("父方案不存在时新增构造层抛 404", async () => {
    const { db } = makeDb([]);
    await expect(createConstructionLayer(app(db), request, actor, "missing", {
      layerOrder: 1, layerType: "FIXING_LAYER", layerName: "砂浆找平层"
    })).rejects.toThrow("构造方案不存在");
  });

  it("deleteConstructionScheme：仅 DRAFT 可删，PUBLISHED 被拒", async () => {
    const { db } = makeDb([[{ ...schemeRow, status: "PUBLISHED" }]]);
    await expect(deleteConstructionScheme(app(db), request, actor, "row-1"))
      .rejects.toThrow("不允许执行该操作");
  });
});