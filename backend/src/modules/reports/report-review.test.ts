import "dotenv/config";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  approveTemplateReport,
  assertPublishable,
  rejectTemplateReport,
  submitTemplateReportForReview
} from "./report-review.service.js";

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

const reportRow = {
  id: "r-1", projectId: "p-1", reportType: "TEMPLATE", status: "READY",
  contentJson: null, createdById: "u-1", createdAt: new Date()
};

describe("模板报告审核流转（READY -> PENDING_REVIEW -> APPROVED/REJECTED）", () => {
  it("submit：READY -> PENDING_REVIEW，同事务写统一审核记录与审计", async () => {
    const pendingRow = { ...reportRow, status: "PENDING_REVIEW" };
    const { db, setCalls, insertCalls } = makeDb([
      [reportRow],
      [pendingRow],
      [],
      [{ id: "pr-1" }]
    ]);
    const result = await submitTemplateReportForReview(app(db), request, actor, "r-1");
    expect(result.status).toBe("PENDING_REVIEW");
    expect(setCalls[0]).toMatchObject({ status: "PENDING_REVIEW", submittedById: "u-1" });
    // 统一审核记录：insert(professional_reviews) -> 审计 insert(audit_logs)
    expect((insertCalls[0] as any)).toMatchObject({ entityType: "report", entityId: "r-1", status: "PENDING_REVIEW" });
    expect((insertCalls[1] as any)).toMatchObject({ action: "report.submitted_for_review", targetId: "r-1" });
  });

  it("approve：PENDING_REVIEW -> APPROVED，记录审核意见", async () => {
    const reviewRow = { ...reportRow, status: "PENDING_REVIEW" };
    const approvedRow = { ...reportRow, status: "APPROVED", approvalNote: "同意发布" };
    const { db, setCalls } = makeDb([
      [reviewRow],
      [approvedRow],
      [],
      [{ id: "pr-2" }]
    ]);
    const result = await approveTemplateReport(app(db), request, actor, "r-1", "同意发布");
    expect(result.status).toBe("APPROVED");
    expect(setCalls[0]).toMatchObject({ status: "APPROVED", approvalNote: "同意发布", approvedById: "u-1" });
  });

  it("reject：PENDING_REVIEW -> REJECTED，驳回原因必填且写入", async () => {
    const reviewRow = { ...reportRow, status: "PENDING_REVIEW" };
    const rejectedRow = { ...reportRow, status: "REJECTED", rejectReason: "热工计算章节数据不完整" };
    const { db, setCalls, insertCalls } = makeDb([
      [reviewRow],
      [rejectedRow],
      [],
      [{ id: "pr-3" }]
    ]);
    const result = await rejectTemplateReport(app(db), request, actor, "r-1", "热工计算章节数据不完整");
    expect(result.status).toBe("REJECTED");
    expect(setCalls[0]).toMatchObject({ status: "REJECTED", rejectReason: "热工计算章节数据不完整" });
    expect((insertCalls[0] as any)).toMatchObject({ status: "REJECTED", comment: "热工计算章节数据不完整" });
  });

  it("状态守卫：非 READY 报告不可提交审核", async () => {
    const { db } = makeDb([[{ ...reportRow, status: "DRAFT" }]]);
    await expect(submitTemplateReportForReview(app(db), request, actor, "r-1"))
      .rejects.toThrow("只有已生成完成的模板报告可以提交审核");
  });

  it("AI 会话报告（非 TEMPLATE）不可进入模板审核流", async () => {
    const { db } = makeDb([[{ ...reportRow, reportType: "energy_design", status: "READY" }]]);
    await expect(submitTemplateReportForReview(app(db), request, actor, "r-1"))
      .rejects.toThrow("只有模板报告需要审核");
  });
});

describe("发布门控（模板报告必须 APPROVED，AI 报告 READY 即可）", () => {
  it("TEMPLATE + APPROVED 可发布；TEMPLATE + READY 被拒", () => {
    expect(() => assertPublishable({ reportType: "TEMPLATE", status: "APPROVED" })).not.toThrow();
    expect(() => assertPublishable({ reportType: "TEMPLATE", status: "READY" })).toThrow("模板报告需经审核通过后才能发布");
  });

  it("AI 会话报告 READY 可发布，DRAFT 被拒（行为保持现状）", () => {
    expect(() => assertPublishable({ reportType: "energy_design", status: "READY" })).not.toThrow();
    expect(() => assertPublishable({ reportType: "energy_design", status: "DRAFT" })).toThrow("报告尚未生成完成，不能发布");
  });
});