import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { files, thermalImportErrors, thermalImportJobs } from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";
import {
  createDefaultThermalImportDeps,
  parseThermalWorkbook,
  IMPORT_TEMPLATE_VERSION
} from "../modules/thermal/thermal-import.service.js";

/**
 * 图集热工参考选用表解析 Worker。
 * - 幂等：job 已 PARSED/APPLIED 直接跳过（BullMQ 重试安全）。
 * - 解析+匹配逻辑在 thermal-import.service.ts（纯函数 + 注入已发布取数），此处只做编排。
 * - 重试前清空该 job 的 errors 行再写，避免重复累积。
 * - 解析失败置 FAILED + errorMessage，不吞异常（BullMQ 会按 attempts 重试）。
 */

interface ThermalImportJobData {
  jobId: string;
}

export function createThermalImportProcessor(db: Database, storage: ObjectStorage) {
  return async (job: Job<ThermalImportJobData>): Promise<Record<string, unknown>> => {
    const { jobId } = job.data;
    if (!jobId) throw new Error("图集热工导入任务缺少 jobId 参数");

    const [existing] = await db.select().from(thermalImportJobs).where(eq(thermalImportJobs.id, jobId)).limit(1);
    if (!existing) throw new Error(`图集热工导入作业不存在：${jobId}`);
    if (existing.status === "PARSED" || existing.status === "APPLIED") {
      return { message: "该导入作业已解析完成，跳过重复执行", jobId, status: existing.status };
    }

    const [file] = await db.select().from(files).where(eq(files.id, existing.fileId)).limit(1);
    if (!file) throw new Error(`图集热工导入文件不存在：${existing.fileId}`);

    await db.update(thermalImportJobs).set({ status: "PARSING", updatedAt: new Date() }).where(eq(thermalImportJobs.id, jobId));
    await db.update(files).set({ status: "PARSING", updatedAt: new Date() }).where(eq(files.id, file.id));

    try {
      const buffer = await storage.getObject(file.objectKey);
      const { rows, errors } = await parseThermalWorkbook(buffer, createDefaultThermalImportDeps(db));

      const errorSummary = errors.length === 0
        ? null
        : `共 ${errors.length} 行错误：${errors.slice(0, 3).map((error) => error.message).join("；")}`.slice(0, 500);

      await db.transaction(async (tx) => {
        // 重试幂等：先清空旧错误清单再写入
        await tx.delete(thermalImportErrors).where(eq(thermalImportErrors.jobId, jobId));
        if (errors.length > 0) {
          await tx.insert(thermalImportErrors).values(errors.map((error) => ({
            jobId,
            sheetName: error.sheetName ?? null,
            rowNumber: error.rowNumber,
            rawRow: error.rawRow,
            errorType: error.errorType,
            message: error.message
          })));
        }
        await tx.update(thermalImportJobs).set({
          status: "PARSED",
          templateVersion: IMPORT_TEMPLATE_VERSION,
          rowCount: rows.length + errors.length,
          validCount: rows.length,
          errorCount: errors.length,
          result: rows,
          errorSummary,
          updatedAt: new Date()
        }).where(eq(thermalImportJobs.id, jobId));
      });

      await db.update(files).set({ status: "UPLOADED", updatedAt: new Date() }).where(eq(files.id, file.id));
      return { jobId, validCount: rows.length, errorCount: errors.length, message: "图集热工参考选用表解析完成" };
    } catch (error) {
      await db.update(thermalImportJobs).set({
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "图集热工参考选用表解析失败",
        updatedAt: new Date()
      }).where(eq(thermalImportJobs.id, jobId));
      await db.update(files).set({ status: "UPLOADED", updatedAt: new Date() }).where(eq(files.id, file.id));
      throw error;
    }
  };
}