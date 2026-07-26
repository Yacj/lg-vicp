import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
  REPORT_GENERATION: "report-generation",
  MAINTENANCE: "maintenance"
} as const;

export interface AppQueues {
  documentProcessing: Queue;
  reportGeneration: Queue;
  maintenance: Queue;
}

export function createQueues(redis: Redis): AppQueues {
  const defaults = {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 2000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 }
    }
  };

  return {
    documentProcessing: new Queue(QUEUE_NAMES.DOCUMENT_PROCESSING, defaults),
    reportGeneration: new Queue(QUEUE_NAMES.REPORT_GENERATION, defaults),
    maintenance: new Queue(QUEUE_NAMES.MAINTENANCE, defaults)
  };
}

export async function closeQueues(queues: AppQueues): Promise<void> {
  await Promise.all([
    queues.documentProcessing.close(),
    queues.reportGeneration.close(),
    queues.maintenance.close()
  ]);
}
