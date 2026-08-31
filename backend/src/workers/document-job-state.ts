import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { asyncTasks, files, knowledgeDocumentVersions, parsingJobs } from "../db/schema.js";

export interface DocumentJobData {
  taskId?: string;
  fileId: string;
  parsingJobId?: string;
  versionId?: string;
  jobType?: "PARSE" | "REPARSE" | "CHUNK_REBUILD" | "OCR" | "UPGRADE_PARSE";
}

export interface DocumentJobFailure {
  attemptsMade: number;
  configuredAttempts?: number;
  errorName: string;
  failedReason: string;
}

export function isTerminalDocumentFailure(failure: DocumentJobFailure): boolean {
  const reason = `${failure.errorName}: ${failure.failedReason}`;
  return failure.errorName === "UnrecoverableError" ||
    /job stalled more than allowable limit/i.test(reason) ||
    failure.attemptsMade >= (failure.configuredAttempts ?? 1);
}

export async function reconcileDocumentJobFailure(
  db: Database,
  data: DocumentJobData,
  errorMessage: string,
  attempts?: number
): Promise<boolean> {
  const now = new Date();

  if (!data.parsingJobId || !data.versionId) {
    if (!data.taskId) return false;
    return db.transaction(async (tx) => {
      const [failedTask] = await tx.update(asyncTasks).set({
        status: "FAILED",
        errorMessage,
        ...(attempts === undefined ? {} : { attempts }),
        finishedAt: now,
        updatedAt: now
      }).where(and(
        eq(asyncTasks.id, data.taskId!),
        inArray(asyncTasks.status, ["QUEUED", "ACTIVE"])
      )).returning({ id: asyncTasks.id });
      if (!failedTask) return false;

      await tx.update(files).set({
        status: "FAILED",
        errorMessage,
        updatedAt: now
      }).where(and(
        eq(files.id, data.fileId),
        inArray(files.status, ["QUEUED", "PARSING", "INDEXING"])
      ));
      return true;
    });
  }

  return db.transaction(async (tx) => {
    const [failedJob] = await tx.update(parsingJobs).set({
      status: "FAILED",
      errorMessage,
      ...(attempts === undefined ? {} : { attempts }),
      finishedAt: now,
      updatedAt: now
    }).where(and(
      eq(parsingJobs.id, data.parsingJobId!),
      inArray(parsingJobs.status, ["QUEUED", "ACTIVE"])
    )).returning({ id: parsingJobs.id });
    if (!failedJob) return false;

    const versionFailure = data.jobType === "CHUNK_REBUILD"
      ? { pipelineStatus: "FAILED" as const, updatedAt: now }
      : { pipelineStatus: "FAILED" as const, parseStatus: "FAILED" as const, updatedAt: now };
    await tx.update(knowledgeDocumentVersions).set(versionFailure).where(and(
      eq(knowledgeDocumentVersions.id, data.versionId!),
      inArray(knowledgeDocumentVersions.pipelineStatus, ["PARSING", "CHUNKING"])
    ));

    if (data.jobType !== "CHUNK_REBUILD") {
      await tx.update(files).set({
        status: "FAILED",
        errorMessage,
        updatedAt: now
      }).where(and(
        eq(files.id, data.fileId),
        inArray(files.status, ["QUEUED", "PARSING", "INDEXING"])
      ));
    }
    return true;
  });
}