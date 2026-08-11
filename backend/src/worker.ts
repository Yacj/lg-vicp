import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { env } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { cronExecutions } from "./db/schema.js";
import { createRedisConnection } from "./plugins/redis.js";
import { QUEUE_NAMES, createQueues } from "./queues/queues.js";
import { createObjectStorage } from "./storage/index.js";
import { createDocumentProcessor } from "./workers/document.worker.js";
import { createReportProcessor } from "./workers/report.worker.js";
import { createConversationTitleProcessor } from "./workers/conversation-title.worker.js";
import { createThermalImportProcessor } from "./workers/thermal-import.worker.js";
import { runCrawlerSource } from "./modules/knowledge/knowledge-ingest.service.js";
import { runStandardCrawl } from "./modules/standard/standard-crawl.service.js";
import { configureConsoleEncoding } from "./shared/console-encoding.js";

configureConsoleEncoding();

const { db, client } = createDatabase(env);
const redis = createRedisConnection();
redis.on("error", (error) => console.error("Redis 连接异常", error));
await redis.connect();
const storage = createObjectStorage(env);
try {
  await storage.ensureBucket();
} catch (error) {
  // 启动自检失败（如 OSS 对象级权限 AK 无法读取 bucket 元信息）不阻断 Worker 启动，任务内会重试
  console.warn("对象存储启动自检失败，Worker 继续启动", error);
}

const workers = [
  new Worker(QUEUE_NAMES.DOCUMENT_PROCESSING, createDocumentProcessor(db, storage), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.REPORT_GENERATION, createReportProcessor(db, storage), { connection: redis, concurrency: 1, lockDuration: 10 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.AI_TITLE_GENERATION, createConversationTitleProcessor(db), { connection: redis, concurrency: 2, lockDuration: 2 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.THERMAL_IMPORT, createThermalImportProcessor(db, storage), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.MAINTENANCE, async (job) => {
    const executionId = typeof job.data?.executionId === "string" ? job.data.executionId : undefined;
    if (executionId) await db.update(cronExecutions).set({ status: "RUNNING", startedAt: new Date() }).where(eq(cronExecutions.id, executionId));
    try {
      // 定时任务按 job.name 分发：知识库抓取
      if (job.name === "knowledge_crawler") {
        const sourceId = typeof job.data?.sourceId === "string" ? job.data.sourceId : undefined;
        if (!sourceId) throw new Error("knowledge_crawler 任务缺少 sourceId 参数");
        const queues = createQueues(redis);
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

for (const worker of workers) {
  worker.on("completed", (job) => console.info(`队列任务完成：${worker.name}/${job.id}`));
  worker.on("failed", (job, error) => console.error(`队列任务失败：${worker.name}/${job?.id ?? "未知"}`, error));
  worker.on("error", (error) => console.error(`队列 Worker 异常：${worker.name}`, error));
}

console.info("文档、报告、维护和图集热工任务 Worker 已启动");

async function shutdown(signal: string) {
  console.info(`收到 ${signal}，正在关闭任务 Worker`);
  await Promise.all(workers.map((worker) => worker.close()));
  await redis.quit();
  await client.end({ timeout: 5 });
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
