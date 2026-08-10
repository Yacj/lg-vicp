import type { Job } from "bullmq";
import type { Database } from "../db/client.js";
import type { ObjectStorage } from "../storage/index.js";
import { runStandardCrawl } from "../modules/standard/standard-crawl.service.js";

/**
 * 地方标准站点抓取 Worker（maintenance 队列，job.name = standard_crawl）。
 * - 幂等：作业已 SUCCESS 直接跳过（BullMQ 重试安全）。
 * - 抓取管线（列表解析/原文入库/提取/PDF/变更检测）在 standard-crawl.service.ts，
 *   此处只做参数校验与编排。
 * - 失败由 BullMQ 按 attempts=3 指数退避重试，作业状态在管线内维护。
 */

interface StandardCrawlJobData {
  crawlJobId: string;
}

export function createStandardCrawlProcessor(db: Database, storage: ObjectStorage) {
  return async (job: Job<StandardCrawlJobData>): Promise<Record<string, unknown>> => {
    const { crawlJobId } = job.data;
    if (!crawlJobId) throw new Error("standard_crawl 任务缺少 crawlJobId 参数");
    const stats = await runStandardCrawl({ db, storage }, crawlJobId);
    return {
      crawlJobId,
      new: stats.new,
      changed: stats.changed,
      failed: stats.failed,
      message: `标准抓取完成：新增 ${stats.new}、变更 ${stats.changed}、失败 ${stats.failed}`
    };
  };
}