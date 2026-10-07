/**
 * 知识页面视觉识别 Worker：消费 page-recognition 队列。
 */
import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { runPageRecognitionJob } from "../modules/knowledge/knowledge-page-recognition.service.js";

export type PageRecognitionJobData = {
  pageId: string;
  versionId: string;
  triggeredBy?: string;
  reRecognize?: boolean;
  recognitionRunId?: string;
};

export function createPageRecognitionProcessor(app: Pick<FastifyInstance, "db" | "storage" | "log">) {
  return async (job: Job<PageRecognitionJobData>) => {
    const pageId = job.data?.pageId;
    if (!pageId) throw new Error("page-recognition 任务缺少 pageId");
    // 兼容部署前已入队的旧任务；服务层会原子认领首个 legacy run，其余旧任务变为 STALE。
    const recognitionRunId = job.data?.recognitionRunId ?? `legacy-${job.id ?? pageId}`;
    console.info("page recognition start", {
      jobId: job.id,
      pageId,
      versionId: job.data.versionId,
      reRecognize: Boolean(job.data.reRecognize)
    });
    const result = await runPageRecognitionJob(app, pageId, recognitionRunId);
    console.info("page recognition done", { jobId: job.id, ...result });
    return result;
  };
}
