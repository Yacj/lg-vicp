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
export const collectionTrendGranularitySchema = z.enum(["day", "month", "year"]);

export const collectionSkillDto = z.object({
  id: z.uuid(),
  name: z.string(),
  keywordsJson: z.array(z.string()),
  instruction: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const collectionSourceDto = z.object({
  id: z.uuid(),
  name: z.string(),
  sourceUrl: z.string(),
  mode: z.literal("AUTO"),
  enabled: z.boolean(),
  skillId: z.uuid().nullable(),
  lastCollectedAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  nextScanAt: z.string().datetime().nullable(),
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
  skillId: z.uuid("采集技能 ID 格式不正确").nullable().optional(),
  enabled: z.boolean().optional()
});

export const updateCollectionSourceBodySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sourceUrl: z.string().trim().url("来源地址格式不正确").max(2000).optional(),
  skillId: z.uuid("采集技能 ID 格式不正确").nullable().optional()
});

export const createCollectionSkillBodySchema = z.object({
  name: z.string().trim().min(1, "技能名称不能为空").max(160),
  keywordsJson: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  instruction: z.string().trim().max(4000).optional(),
  enabled: z.boolean().optional()
});

export const updateCollectionSkillBodySchema = createCollectionSkillBodySchema.partial()
  .refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");

export const collectionSourceParamsSchema = z.object({
  id: z.uuid("采集源 ID 格式不正确")
});

export const collectionSkillParamsSchema = z.object({
  id: z.uuid("采集技能 ID 格式不正确")
});

export const collectionTaskParamsSchema = z.object({
  id: z.uuid("采集任务 ID 格式不正确")
});

export const collectionTaskListQuerySchema = paginationQuerySchema.extend({
  mode: collectionModeSchema.optional(),
  status: collectionTaskStatusSchema.optional(),
  keyword: z.string().trim().max(120).optional()
});

export const collectionRecordListQuerySchema = paginationQuerySchema.extend({
  sourceId: z.uuid().optional(),
  keyword: z.string().trim().max(120).optional()
});

export const collectionTrendQuerySchema = z.object({
  granularity: collectionTrendGranularitySchema.default("day")
});
