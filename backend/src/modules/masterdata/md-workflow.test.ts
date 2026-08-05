import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { MdError } from "../../shared/md-errors.js";
import {
  approveEntity,
  createNextVersion,
  disableEntity,
  publishEntity,
  rejectEntity,
  submitForReview,
  transitionMdStatus
} from "./md-workflow.service.js";

/**
 * drizzle 链式最小桩：
 * - rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）
 * - select().from().where().limit() / where()（thenable）/ where().returning() 均消耗一个条目
 * - transaction 直接执行回调（回调内的 db 即桩本身），记录每次 set / insert values 用于断言
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
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, setCalls, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const draftRow = { id: "row-1", code: "XPS-01", version: 1, status: "DRAFT", name: "示例" };
const pendingRow = { id: "row-1", code: "XPS-01", version: 1, status: "PENDING_REVIEW", name: "示例" };

describe("主数据版本化实体状态机", () => {
  it("submit：DRAFT -> PENDING_REVIEW，写入 submittedById", async () => {
    const { db, setCalls } = makeDb([[draftRow], [pendingRow]]);
    const result = await submitForReview(app(db), request, actor, "productSeries", "row-1");
    expect(result.status).toBe("PENDING_REVIEW");
    expect(setCalls[0]).toMatchObject({ status: "PENDING_REVIEW", submittedById: "u-1" });
  });

  it("approve：PENDING_REVIEW -> APPROVED，记录审核意见", async () => {
    const { db, setCalls } = makeDb([[pendingRow], [{ ...pendingRow, status: "APPROVED", approvalNote: "同意" }]]);
    const result = await approveEntity(app(db), request, actor, "productSeries", "row-1", "同意");
    expect(result.status).toBe("APPROVED");
    expect(setCalls[0]).toMatchObject({ status: "APPROVED", approvedById: "u-1", approvalNote: "同意" });
  });

  it("reject：PENDING_REVIEW -> REJECTED，驳回原因落库", async () => {
    const { db, setCalls } = makeDb([[pendingRow], [{ ...pendingRow, status: "REJECTED", rejectReason: "证据不足" }]]);
    const result = await rejectEntity(app(db), request, actor, "productSeries", "row-1", "证据不足");
    expect(result.status).toBe("REJECTED");
    expect(setCalls[0]).toMatchObject({ status: "REJECTED", rejectedById: "u-1", rejectReason: "证据不足" });
  });

  it("publish：APPROVED -> PUBLISHED，同键其他 PUBLISHED 行先置 DISABLED", async () => {
    const approvedRow = { ...pendingRow, status: "APPROVED" };
    const { db, setCalls } = makeDb([[approvedRow], [], [{ ...approvedRow, status: "PUBLISHED" }]]);
    const result = await publishEntity(app(db), request, actor, "productSeries", "row-1");
    expect(result.status).toBe("PUBLISHED");
    // before 回调的同键互斥更新（第一个 set），随后才是主更新
    expect(setCalls[0]).toMatchObject({ status: "DISABLED" });
    expect(setCalls[1]).toMatchObject({ status: "PUBLISHED", publishedById: "u-1" });
  });

  it("disable：PUBLISHED -> DISABLED", async () => {
    const publishedRow = { ...pendingRow, status: "PUBLISHED" };
    const { db, setCalls } = makeDb([[publishedRow], [{ ...publishedRow, status: "DISABLED" }]]);
    const result = await disableEntity(app(db), request, actor, "productSeries", "row-1");
    expect(result.status).toBe("DISABLED");
    expect(setCalls[0]).toMatchObject({ status: "DISABLED" });
  });

  it("非法状态转换抛出 MD_STATUS_CONFLICT（DRAFT 直接发布被拒）", async () => {
    const { db } = makeDb([[draftRow]]);
    await expect(publishEntity(app(db), request, actor, "productSeries", "row-1"))
      .rejects.toThrow(MdError);
    const { db: db2 } = makeDb([[draftRow]]);
    await expect(publishEntity(app(db2), request, actor, "productSeries", "row-1"))
      .rejects.toThrow("不允许执行该操作");
  });

  it("行不存在抛出 MD_ENTITY_NOT_FOUND", async () => {
    const { db } = makeDb([]);
    await expect(submitForReview(app(db), request, actor, "productSeries", "missing"))
      .rejects.toThrow("产品系列不存在");
  });

  it("new-version：PUBLISHED 派生 DRAFT 新行，version+1，系统列不复制", async () => {
    const publishedRow = {
      id: "row-1", code: "XPS-01", version: 1, status: "PUBLISHED", name: "XPS 板",
      createdById: "u-old", submittedById: "u-old", publishedById: "u-old", changeNote: "v1"
    };
    const { db, insertCalls } = makeDb([
      [publishedRow],
      [{ max: 1 }],
      [{ id: "row-2", ...publishedRow, version: 2, status: "DRAFT" }]
    ]);
    const result = await createNextVersion(app(db), request, actor, "productSeries", "row-1", "升级密度参数");
    expect(result).toMatchObject({ version: 2, status: "DRAFT", code: "XPS-01", name: "XPS 板" });
    const inserted = insertCalls[0] as any;
    expect(inserted).toMatchObject({ version: 2, status: "DRAFT", createdById: "u-1", updatedById: "u-1" });
    expect(inserted.id).toBeUndefined();
    expect(inserted.submittedById).toBeUndefined();
    expect(inserted.publishedById).toBeUndefined();
  });
});

describe("主数据非版本化实体状态机（证书/附件）", () => {
  it("transitionMdStatus：DRAFT -> PENDING_REVIEW", async () => {
    const certRow = { id: "cert-1", certName: "ISO9001", status: "DRAFT" };
    const { db, setCalls } = makeDb([[certRow], [{ ...certRow, status: "PENDING_REVIEW" }]]);
    const result = await transitionMdStatus(
      app(db), request, actor,
      { table: {} as any, idColumn: {} as any, statusColumn: {} as any, kind: "md_enterprise_certificate", label: "企业证书" },
      "cert-1",
      ["DRAFT", "REJECTED"], "PENDING_REVIEW", AUDIT_ACTIONS.MD_ENTITY_SUBMITTED,
      { submittedById: actor.id, submittedAt: new Date() }
    );
    expect(result.status).toBe("PENDING_REVIEW");
    expect(setCalls[0]).toMatchObject({ status: "PENDING_REVIEW", submittedById: "u-1" });
  });
});