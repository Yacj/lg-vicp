import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { collectionSources, collectionTasks, files } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { ForbiddenError, NotFoundError, ServiceUnavailableError } from "../../shared/errors.js";
import type { ObjectStorage } from "../../storage/index.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { resolveSystemActor } from "../knowledge/knowledge-ingest.service.js";

export interface CollectionFetchDeps {
  db: Database;
  storage: ObjectStorage;
}

export type CollectionHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 12);
}

function inferFileName(url: string, mimeType: string, fallback: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    if (base && base.includes(".")) return decodeURIComponent(base).slice(0, 200);
  } catch {
    // URL 解析失败时用任务名兜底
  }
  const ext = mimeType.includes("pdf")
    ? ".pdf"
    : mimeType.includes("wordprocessingml")
      ? ".docx"
      : mimeType.includes("html")
        ? ".html"
        : "";
  return `${fallback}${ext}`.slice(0, 200);
}

function mimeFromContentType(contentType: string | null): string {
  const raw = (contentType ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : "application/octet-stream";
}

/**
 * 执行采集任务：下载 URL → 写入对象存储 → files(READY, source=COLLECTION) → WAITING_CONFIRM。
 * 失败置 FAILED。自动采集到此为止，绝不创建已发布 Knowledge 版本。
 */
export async function runCollectionTask(
  deps: CollectionFetchDeps,
  taskId: string,
  httpFetch: CollectionHttpFetch = fetch
): Promise<{ status: "WAITING_CONFIRM" | "FAILED"; fileId?: string; message: string }> {
  const [task] = await deps.db.select().from(collectionTasks).where(eq(collectionTasks.id, taskId)).limit(1);
  if (!task) throw new NotFoundError("采集任务不存在");
  if (task.status === "WAITING_CONFIRM" || task.status === "COMPLETED") {
    return { status: task.status === "COMPLETED" ? "FAILED" : "WAITING_CONFIRM", fileId: task.resultFileId ?? undefined, message: "任务已完成采集，跳过重复执行" };
  }
  if (task.status !== "PENDING" && task.status !== "RUNNING") {
    return { status: "FAILED", message: `任务当前状态为 ${task.status}，不能执行采集` };
  }

  const startedAt = new Date();
  await deps.db.update(collectionTasks).set({
    status: "RUNNING",
    startedAt,
    errorMessage: null,
    updatedAt: startedAt
  }).where(eq(collectionTasks.id, taskId));

  try {
    const actor: AuthUser = task.createdById
      ? { id: task.createdById, role: "SUPER_ADMIN", channelType: null, adminLoginEnabled: true, clientType: "B_ADMIN", permissionCodes: [] }
      : await resolveSystemActor(deps.db);

    const response = await httpFetch(task.sourceUrl, {
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
      headers: { "User-Agent": "lg-vicp-collection/1.0" }
    });
    if (!response.ok) throw new ServiceUnavailableError(`采集失败：HTTP ${response.status}`);

    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > env.MAX_UPLOAD_BYTES) {
      throw new ForbiddenError(`采集文件超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限`);
    }

    const mimeType = mimeFromContentType(response.headers.get("content-type"));
    const fileName = inferFileName(task.sourceUrl, mimeType, task.name);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const fileId = randomUUID();
    const objectKey = `collection/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(fileName)}`;
    await deps.storage.putObject(objectKey, content, mimeType);

    await deps.db.insert(files).values({
      id: fileId,
      ownerUserId: actor.id,
      storageProvider: deps.storage.provider,
      bucket: deps.storage.bucket,
      objectKey,
      originalName: fileName,
      mimeType,
      sizeBytes: content.length,
      sha256,
      source: "COLLECTION",
      status: "READY"
    });

    const finishedAt = new Date();
    await deps.db.update(collectionTasks).set({
      status: "WAITING_CONFIRM",
      resultFileId: fileId,
      resultMeta: { mimeType, fileName, sizeBytes: content.length, sha256, httpStatus: response.status },
      errorMessage: null,
      finishedAt,
      updatedAt: finishedAt
    }).where(eq(collectionTasks.id, taskId));

    if (task.sourceId) {
      await deps.db.update(collectionSources).set({
        lastCollectedAt: finishedAt,
        updatedAt: finishedAt
      }).where(eq(collectionSources.id, task.sourceId));
    }

    return { status: "WAITING_CONFIRM", fileId, message: "采集完成，等待管理员确认后导入知识库" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "采集失败";
    const finishedAt = new Date();
    await deps.db.update(collectionTasks).set({
      status: "FAILED",
      errorMessage: message,
      finishedAt,
      updatedAt: finishedAt
    }).where(eq(collectionTasks.id, taskId));
    return { status: "FAILED", message };
  }
}

export async function markInflightTaskFailedIfStuck(deps: CollectionFetchDeps, sourceId: string) {
  const [inflight] = await deps.db.select({ id: collectionTasks.id }).from(collectionTasks).where(and(
    eq(collectionTasks.sourceId, sourceId),
    eq(collectionTasks.status, "PENDING")
  )).limit(1);
  return inflight ?? null;
}
