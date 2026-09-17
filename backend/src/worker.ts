import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { env } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { cronExecutions } from "./db/schema.js";
import { createRedisConnection } from "./plugins/redis.js";
import { QUEUE_NAMES, createQueues } from "./queues/queues.js";
import { createObjectStorage } from "./storage/index.js";
import { createDocumentProcessor } from "./workers/document.worker.js";
import type { DocumentJobData } from "./workers/document-job-state.js";
import { isTerminalDocumentFailure, reconcileDocumentJobFailure } from "./workers/document-job-state.js";
import { createReportProcessor } from "./workers/report.worker.js";
import { createConversationTitleProcessor } from "./workers/conversation-title.worker.js";
import { createConversationMaintenanceProcessor } from "./workers/ai-conversation-maintenance.worker.js";
import { createThermalImportProcessor } from "./workers/thermal-import.worker.js";
import { createCollectionFetchProcessor } from "./workers/collection-fetch.worker.js";
import { COLLECTION_AUTO_INTERVAL_MS } from "./modules/collection/collection.service.js";
import { runCrawlerSource } from "./modules/knowledge/knowledge-ingest.service.js";
import { runStandardCrawl } from "./modules/standard/standard-crawl.service.js";
import { configureConsoleEncoding } from "./shared/console-encoding.js";

configureConsoleEncoding();

const { db, client } = createDatabase(env);
const redis = createRedisConnection();
redis.on("error", (error) => console.error("Redis 连接异常", error));
await redis.connect();
const storage = createObjectStorage(env);
const queues = createQueues(redis);
try {
  await storage.ensureBucket();
} catch (error) {
  // 启动自检失败（如 OSS 对象级权限 AK 无法读取 bucket 元信息）不阻断 Worker 启动，任务内会重试
  console.warn("对象存储启动自检失败，Worker 继续启动", error);
}

try {
  await queues.collectionFetch.add("scan_sources", {}, {
    repeat: { every: COLLECTION_AUTO_INTERVAL_MS },
    jobId: "collection-auto-scan"
  });
} catch (error) {
  console.warn("注册自动采集扫描任务失败，Worker 继续启动", error);
}

const documentWorker = new Worker<DocumentJobData>(
  QUEUE_NAMES.DOCUMENT_PROCESSING,
  createDocumentProcessor(db, storage),
  { connection: redis, concurrency: 1, lockDuration: 5 * 60 * 1000 }
);

const workers = [
  documentWorker,
  new Worker(QUEUE_NAMES.REPORT_GENERATION, createReportProcessor(db, storage), { connection: redis, concurrency: 1, lockDuration: 10 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.AI_TITLE_GENERATION, createConversationTitleProcessor(db), { connection: redis, concurrency: 2, lockDuration: 2 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.AI_CONVERSATION_MAINTENANCE, createConversationMaintenanceProcessor({ db } as never), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.THERMAL_IMPORT, createThermalImportProcessor(db, storage), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.COLLECTION_FETCH, createCollectionFetchProcessor(db, storage, queues), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.MAINTENANCE, async (job) => {
    const executionId = typeof job.data?.executionId === "string" ? job.data.executionId : undefined;
    if (executionId) await db.update(cronExecutions).set({ status: "RUNNING", startedAt: new Date() }).where(eq(cronExecutions.id, executionId));
    try {
      // 定时任务按 job.name 分发：知识库抓取
      if (job.name === "knowledge_crawler") {
        const sourceId = typeof job.data?.sourceId === "string" ? job.data.sourceId : undefined;
        if (!sourceId) throw new Error("knowledge_crawler 任务缺少 sourceId 参数");
        const result = await runCrawlerSource({ db, storage, queues }, null, sourceId);
        return { message: result.message, sourceName: result.sourceName };
      }
      // 定时任务按 job.name 分发：地方标准站点抓取
      if (job.name === "standard_crawl") {
        const crawlJobId = typeof job.data?.crawlJobId === "string" ? job.data.crawlJobId : undefined;
        if (!crawlJobId) throw new Error("standard_crawl 任务缺少 crawlJobId 参数");
        const stats = await runStandardCrawl({ db, storage }, crawlJobId);
        return { message: `标准抓取完成：新增 ${stats.new}、变更 ${stats.changed}、失败 ${stats.failed}`, crawlJobId };
      }
      if (executionId) await db.update(cronExecutions).set({ status: "SUCCESS", finishedAt: new Date() }).where(eq(cronExecutions.id, executionId));
      return { message: "维护任务执行完成" };
    } catch (error) {
      if (executionId) await db.update(cronExecutions).set({ status: "FAILED", finishedAt: new Date(), errorMessage: error instanceof Error ? error.message : "任务执行失败" }).where(eq(cronExecutions.id, executionId));
      throw error;
    }
  }, { connection: redis, concurrency: 1 })
];

const documentJobStartedAt = new Map<string, number>();

function documentJobDetails(job: Job<DocumentJobData>) {
  const jobId = job.id ?? "unknown";
  const startedAt = job.id ? documentJobStartedAt.get(job.id) : undefined;
  return {
    queue: documentWorker.name,
    jobId,
    attemptsMade: job.attemptsMade,
    configuredAttempts: job.opts.attempts ?? 1,
    durationMs: startedAt === undefined ? null : Date.now() - startedAt,
    nodeVersion: process.version
  };
}

function handleDocumentFailure(job: Job<DocumentJobData> | undefined, error: Error): void {
  const details = job ? {
    ...documentJobDetails(job),
    failedReason: error.message
  } : {
    queue: documentWorker.name,
    jobId: "unknown",
    attemptsMade: null,
    configuredAttempts: 1,
    durationMs: null,
    nodeVersion: process.version,
    failedReason: error.message
  };
  if (job?.id) documentJobStartedAt.delete(job.id);
  console.error("文档队列任务失败", details, error);
  if (!job || !isTerminalDocumentFailure({
    attemptsMade: job.attemptsMade,
    configuredAttempts: job.opts.attempts,
    errorName: error.name,
    failedReason: error.message
  })) return;

  void reconcileDocumentJobFailure(db, job.data, error.message, job.attemptsMade)
    .then((updated) => {
      if (updated) console.info("文档任务终态失败已同步数据库状态", details);
    })
    .catch((reconciliationError: unknown) => {
      console.error("文档任务终态失败状态同步失败", details, reconciliationError);
    });
}

for (const worker of workers) {
  if (worker !== documentWorker) {
    worker.on("completed", (job) => console.info(`队列任务完成：${worker.name}/${job.id}`));
    worker.on("failed", (job, error) => console.error(`队列任务失败：${worker.name}/${job?.id ?? "未知"}`, error));
  }
  worker.on("error", (error) => console.error(`队列 Worker 异常：${worker.name}`, error));
}

documentWorker.on("active", (job) => {
  if (job.id) documentJobStartedAt.set(job.id, Date.now());
  console.info("文档队列任务开始", documentJobDetails(job));
});
documentWorker.on("completed", (job) => {
  const details = documentJobDetails(job);
  if (job.id) documentJobStartedAt.delete(job.id);
  console.info("文档队列任务完成", details);
});
documentWorker.on("stalled", (jobId, previousState) => {
  console.warn("文档队列任务锁续租超时", {
    queue: documentWorker.name,
    jobId,
    previousState,
    nodeVersion: process.version
  });
});
documentWorker.on("failed", handleDocumentFailure);

console.info("文档、报告、维护和图集热工任务 Worker 已启动");

let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shutdownPromise) {
    console.warn(`已在关闭任务 Worker，忽略重复 ${signal}`);
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.info(`收到 ${signal}，等待活动任务完成后关闭 Worker`);
    const workerResults = await Promise.allSettled(workers.map((worker) => worker.close()));
    const connectionResults = await Promise.allSettled([
      redis.quit(),
      client.end({ timeout: 5 })
    ]);
    const failures = [...workerResults, ...connectionResults].filter((result) => result.status === "rejected");

    if (failures.length > 0) {
      console.error("Worker 关闭期间发生异常", failures);
      process.exit(1);
    }

    console.info("任务 Worker 已安全关闭");
    process.exit(0);
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
