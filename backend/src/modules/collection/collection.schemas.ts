import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

export const collectionModeSchema = z.enum(["MANUAL", "AUTO"]);
export const collectionTaskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "WAITING_CONFIRM",
  "COMPLETED",
  "FAILED"
]);

export const collectionSourceDto = z.object({
  id: z.uuid(),
  name: z.string(),
  sourceUrl: z.string(),
  mode: z.literal("AUTO"),
  enabled: z.boolean(),
  lastCollectedAt: z.string().datetime().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const collectionTaskDto = z.object({
  id: z.uuid(),
  sourceId: z.uuid().nullable(),
  name: z.string(),
  sourceUrl: z.string(),
  mode: collectionModeSchema,
  status: collectionTaskStatusSchema,
  resultFileId: z.uuid().nullable(),
  resultMeta: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  importedKnowledgeDocumentId: z.uuid().nullable()
});

export const createManualCollectionBodySchema = z.object({
  name: z.string().trim().min(1, "采集名称不能为空").max(160),
  sourceUrl: z.string().trim().url("来源地址格式不正确").max(2000),
  remark: z.string().trim().max(500).optional()
});

export const createCollectionSourceBodySchema = z.object({
  name: z.string().trim().min(1, "采集源名称不能为空").max(160),
  sourceUrl: z.string().trim().url("来源地址格式不正确").max(2000),
  enabled: z.boolean().optional()
});

export const updateCollectionSourceBodySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sourceUrl: z.string().trim().url("来源地址格式不正确").max(2000).optional()
});

export const collectionSourceParamsSchema = z.object({
  id: z.uuid("采集源 ID 格式不正确")
});

export const collectionTaskParamsSchema = z.object({
  id: z.uuid("采集任务 ID 格式不正确")
});

export const collectionTaskListQuerySchema = paginationQuerySchema.extend({
  mode: collectionModeSchema.optional(),
  status: collectionTaskStatusSchema.optional(),
  keyword: z.string().trim().max(120).optional()
});
