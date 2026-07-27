import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { env } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { cronExecutions } from "./db/schema.js";
import { createRedisConnection } from "./plugins/redis.js";
import { QUEUE_NAMES } from "./queues/queues.js";
import { createObjectStorage } from "./storage/index.js";
import { createDocumentProcessor } from "./workers/document.worker.js";
import { createReportProcessor } from "./workers/report.worker.js";
import { configureConsoleEncoding } from "./shared/console-encoding.js";

configureConsoleEncoding();

const { db, client } = createDatabase(env);
const redis = createRedisConnection();
redis.on("error", (error) => console.error("Redis 连接异常", error));
await redis.connect();
const storage = createObjectStorage(env);
await storage.ensureBucket();

const workers = [
  new Worker(QUEUE_NAMES.DOCUMENT_PROCESSING, createDocumentProcessor(db, storage), { connection: redis, concurrency: 2, lockDuration: 5 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.REPORT_GENERATION, createReportProcessor(db, storage), { connection: redis, concurrency: 1, lockDuration: 10 * 60 * 1000 }),
  new Worker(QUEUE_NAMES.MAINTENANCE, async (job) => {
    const executionId = typeof job.data?.executionId === "string" ? job.data.executionId : undefined;
    if (executionId) await db.update(cronExecutions).set({ status: "RUNNING", startedAt: new Date() }).where(eq(cronExecutions.id, executionId));
    try {
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

console.info("文档、报告和维护任务 Worker 已启动");

async function shutdown(signal: string) {
  console.info(`收到 ${signal}，正在关闭任务 Worker`);
  await Promise.all(workers.map((worker) => worker.close()));
  await redis.quit();
  await client.end({ timeout: 5 });
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
