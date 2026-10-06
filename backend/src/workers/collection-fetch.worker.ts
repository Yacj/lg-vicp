import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { ObjectStorage } from "../storage/index.js";
import type { AppQueues } from "../queues/queues.js";
import { collectionTasks } from "../db/schema.js";
import { runCollectionAgent } from "../modules/collection/collection-agent.service.js";
import { runCollectionTask } from "../modules/collection/collection-fetch.service.js";
import { scanEnabledCollectionSources } from "../modules/collection/collection.service.js";

interface CollectionFetchJobData {
  taskId?: string;
}

export function createCollectionFetchProcessor(
  db: Database,
  storage: ObjectStorage,
  queues: Pick<AppQueues, "collectionFetch" | "documentProcessing">
) {
  return async (job: Job<CollectionFetchJobData>): Promise<Record<string, unknown>> => {
    if (job.name === "scan_sources") {
      const result = await scanEnabledCollectionSources({ db, storage, queues });
      return { message: `自动采集扫描完成：扫描 ${result.scanned} 个来源，入队 ${result.enqueued} 个任务`, ...result };
    }
    const taskId = job.data?.taskId;
    if (!taskId) throw new Error("采集任务缺少 taskId");
    const [task] = await db.select({ mode: collectionTasks.mode }).from(collectionTasks).where(eq(collectionTasks.id, taskId)).limit(1);
    if (task?.mode === "AUTO") {
      const startedAt = new Date();
      await db.update(collectionTasks).set({ status: "RUNNING", startedAt, updatedAt: startedAt }).where(eq(collectionTasks.id, taskId));
      const result = await runCollectionAgent({ db, taskId });
      const finishedAt = new Date();
      await db.update(collectionTasks).set({
        status: result.status === "FAILED" ? "FAILED" : "WAITING_CONFIRM",
        resultMeta: { runId: result.runId, storedCount: result.storedCount, duplicateCount: result.duplicateCount, visitedCount: result.visitedCount },
        errorMessage: result.status === "FAILED" ? result.message : null,
        finishedAt,
        updatedAt: finishedAt
      }).where(eq(collectionTasks.id, taskId));
      return { taskId, ...result };
    }
    const result = await runCollectionTask({ db, storage }, taskId);
    return { taskId, ...result };
  };
}
