import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
  REPORT_GENERATION: "report-generation",
  MAINTENANCE: "maintenance",
  AI_TITLE_GENERATION: "ai-title-generation",
  AI_CONVERSATION_MAINTENANCE: "ai-conversation-maintenance",
  THERMAL_IMPORT: "thermal-import",
  COLLECTION_FETCH: "collection-fetch"
} as const;

export interface AppQueues {
  documentProcessing: Queue;
  reportGeneration: Queue;
  maintenance: Queue;
  aiTitleGeneration: Queue;
  aiConversationMaintenance: Queue;
  thermalImport: Queue;
  collectionFetch: Queue;
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
    maintenance: new Queue(QUEUE_NAMES.MAINTENANCE, defaults),
    aiTitleGeneration: new Queue(QUEUE_NAMES.AI_TITLE_GENERATION, defaults),
    aiConversationMaintenance: new Queue(QUEUE_NAMES.AI_CONVERSATION_MAINTENANCE, defaults),
    thermalImport: new Queue(QUEUE_NAMES.THERMAL_IMPORT, defaults),
    collectionFetch: new Queue(QUEUE_NAMES.COLLECTION_FETCH, defaults)
  };
}

export async function closeQueues(queues: AppQueues): Promise<void> {
  await Promise.all([
    queues.documentProcessing.close(),
    queues.reportGeneration.close(),
    queues.maintenance.close(),
    queues.aiTitleGeneration.close(),
    queues.aiConversationMaintenance.close(),
    queues.thermalImport.close(),
    queues.collectionFetch.close()
  ]);
}
