import type { Job } from "bullmq";

/**
 * BullMQ 重试对用户透明：中间 attempt 失败保持 GENERATING，只有 attempts exhausted 才 FAILED。
 */
export function isTerminalReportAttempt(job: Pick<Job, "attemptsMade" | "opts">): boolean {
  const maxAttempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0
    ? job.opts.attempts
    : 1;
  return job.attemptsMade + 1 >= maxAttempts;
}
