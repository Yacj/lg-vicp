import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  approveReview,
  getReviewDetail,
  listReviewQueue,
  rejectReview
} from "./review-center.service.js";
import { upsertProfessionalReview } from "./professional-review.js";

/** drizzle 链式最小桩（与 construction-workflow.test.ts 同款） */
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

describe("统一审核记录 upsert（单一写入点）", () => {
  it("首次 submit 插入 PENDING_REVIEW 记录并写提交人", async () => {
    const { db, insertCalls } = makeDb([
      [],
      [{ id: "pr-1" }]
    ]);
    const id = await upsertProfessionalReview({
      db: db as any, entityType: "construction_scheme", entityId: "sc-1",
      entityVersion: 2, status: "PENDING_REVIEW", actorUserId: "u-1", requestId: "req-1"
    });
    expect(id).toBe("pr-1");
    expect(insertCalls[0]).toMatchObject({
      entityType: "construction_scheme", entityId: "sc-1", entityVersion: 2,
      status: "PENDING_REVIEW", submittedById: "u-1", reviewedById: null
    });
  });

  it("再次提交走 update：不覆盖 reviewedById，仅刷新提交人与状态", async () => {
    const { db, setCalls } = makeDb([
      [{ id: "pr-1" }]
    ]);
    await upsertProfessionalReview({
      db: db as any, entityType: "construction_scheme", entityId: "sc-1",
      status: "PENDING_REVIEW", actorUserId: "u-2", requestId: "req-2"
    });
    expect(setCalls[0]).toMatchObject({ status: "PENDING_REVIEW", submittedById: "u-2" });
    expect(setCalls[0].reviewedById).toBeUndefined();
  });
});

describe("审核中心队列读取", () => {
  it("队列项补充实体中文名（label），按 entityType/status 过滤", async () => {
    const record = { entityType: "report", entityId: "r-1", status: "PENDING_REVIEW", entityVersion: null, updatedAt: new Date() };
    const { db } = makeDb([
      [record],
      [{ value: 1 }]
    ]);
    const result = await listReviewQueue(app(db), { page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ entityType: "report", label: "模板报告" });
  });

  it("详情返回记录 + 实体数据预览", async () => {
    const record = { entityType: "report", entityId: "r-1", status: "PENDING_REVIEW", updatedAt: new Date() };
    const reportRow = { id: "r-1", reportType: "TEMPLATE", status: "PENDING_REVIEW" };
    const { db } = makeDb([
      [record],
      [reportRow]
    ]);
    const detail = await getReviewDetail(app(db), "report", "r-1");
    expect(detail.record.label).toBe("模板报告");
    expect(detail.entity).toMatchObject({ id: "r-1", status: "PENDING_REVIEW" });
  });
});

describe("审核决议委托（无审核分叉）", () => {
  it("approve 委托报告审核服务完成 APPROVED 流转", async () => {
    const pendingRecord = { entityType: "report", entityId: "r-1", status: "PENDING_REVIEW", updatedAt: new Date() };
    const reportRow = { id: "r-1", projectId: "p-1", reportType: "TEMPLATE", status: "PENDING_REVIEW" };
    const approvedRow = { ...reportRow, status: "APPROVED" };
    const { db, setCalls } = makeDb([
      [pendingRecord],
      [reportRow],
      [approvedRow],
      [],
      [{ id: "pr-2" }]
    ]);
    const result = await approveReview(app(db), request, actor, "report", "r-1", "同意");
    expect(result.status).toBe("APPROVED");
    expect(setCalls[0]).toMatchObject({ status: "APPROVED", approvedById: "u-1" });
  });

  it("reject 委托并写入驳回原因", async () => {
    const pendingRecord = { entityType: "report", entityId: "r-1", status: "PENDING_REVIEW", updatedAt: new Date() };
    const reportRow = { id: "r-1", projectId: "p-1", reportType: "TEMPLATE", status: "PENDING_REVIEW" };
    const rejectedRow = { ...reportRow, status: "REJECTED" };
    const { db, setCalls } = makeDb([
      [pendingRecord],
      [reportRow],
      [rejectedRow],
      [],
      [{ id: "pr-3" }]
    ]);
    const result = await rejectReview(app(db), request, actor, "report", "r-1", "数据不完整");
    expect(result.status).toBe("REJECTED");
    expect(setCalls[0]).toMatchObject({ status: "REJECTED", rejectReason: "数据不完整" });
  });

  it("不支持的实体类型直接拒绝（未注册委托）", async () => {
    const { db } = makeDb([]);
    await expect(approveReview(app(db), request, actor, "unknown_entity", "x-1"))
      .rejects.toThrow("该实体类型不在统一审核范围内");
  });

  it("记录不在待审核状态时拒绝决议", async () => {
    const { db } = makeDb([[{ entityType: "report", entityId: "r-1", status: "APPROVED", updatedAt: new Date() }]]);
    await expect(approveReview(app(db), request, actor, "report", "r-1"))
      .rejects.toThrow("该实体当前不在待审核状态");
  });
});