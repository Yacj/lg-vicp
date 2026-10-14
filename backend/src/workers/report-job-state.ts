import type { Job, Queue } from "bullmq";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { asyncTasks, auditLogs, reports } from "../db/schema.js";
import { createNotification } from "../modules/notifications/notification.service.js";
import { QUEUE_NAMES } from "../queues/queues.js";

/**
 * BullMQ 重试对用户透明：中间 attempt 失败保持 GENERATING，只有 attempts exhausted 才 FAILED。
 */
export function isTerminalReportAttempt(job: Pick<Job, "attemptsMade" | "opts">): boolean {
  const maxAttempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0
    ? job.opts.attempts
    : 1;
  return job.attemptsMade + 1 >= maxAttempts;
}

/** failed事件的attemptsMade已递增；补偿崩溃/领取前异常，不覆盖完成、审核或新任务。 */
export async function reconcileTerminalReportFailure(db: Database, job: Pick<Job<{ taskId: string; reportId: string }>, "data" | "attemptsMade" | "opts">, error: Error, knownQueueState?: "failed") {
  if (knownQueueState !== "failed" && job.attemptsMade < (job.opts.attempts ?? 1) && error.name !== "UnrecoverableError" && error.message !== "job stalled more than allowable limit") return false;
  const changed = await db.transaction(async tx => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, job.data.reportId)).for("update");
    if (!report || report.deletedAt || report.publishedAt || !["QUEUED", "GENERATING"].includes(report.status)) return null;
    const [task] = await tx.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"),
      eq(asyncTasks.businessId, report.id))).orderBy(desc(asyncTasks.createdAt)).limit(1);
    if (!task || task.id !== job.data.taskId || task.status === "COMPLETED") return null;
    const message = "REPORT_WORKER_TERMINAL_FAILURE：报告任务重试已耗尽或处理中断，请按原快照重试。";
    await tx.update(reports).set({ status: "FAILED", errorMessage: message, updatedAt: new Date() }).where(eq(reports.id, report.id));
    await tx.update(asyncTasks).set({ status: "FAILED", errorMessage: message, attempts: job.attemptsMade,
      finishedAt: new Date(), updatedAt: new Date() }).where(eq(asyncTasks.id, task.id));
    await tx.insert(auditLogs).values({ actorUserId: report.createdById, projectId: report.projectId,
      action: "report.failed", targetType: "report", targetId: report.id,
      afterJson: { taskId: task.id, errorCode: "REPORT_WORKER_TERMINAL_FAILURE" } });
    return report;
  });
  if (changed) await createNotification({ db }, { type: "REPORT_GENERATION_FAILED", title: "报告生成失败",
    content: "报告任务处理异常，请按原快照重试。", targetType: "report", targetId: changed.id,
    projectId: changed.projectId, createdById: changed.createdById }).catch(() => undefined);
  return Boolean(changed);
}

/** Worker启动/周期补偿：只收敛队列已明确FAILED的任务，不猜测缺失job或重新组装快照。 */
export async function reconcileFailedReportTasks(db: Database, queue: Pick<Queue, "getJob">) {
  const tasks = await db.select().from(asyncTasks).where(and(eq(asyncTasks.queueName, QUEUE_NAMES.REPORT_GENERATION),
    eq(asyncTasks.businessType, "report"), inArray(asyncTasks.status, ["QUEUED", "ACTIVE"]))).limit(100);
  let changed = 0;
  for (const task of tasks) {
    const job = await queue.getJob(task.bullJobId ?? task.id);
    if (!job || await job.getState() !== "failed" || job.data.taskId !== task.id || job.data.reportId !== task.businessId) continue;
    if (await reconcileTerminalReportFailure(db, job, new Error(job.failedReason), "failed")) changed++;
  }
  return changed;
}
