import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { asyncTasks, files, projects } from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject } from "../../shared/permissions.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { canAccessSourceFile } from "./file-access.js";
import { createUploadIntentBodySchema, fileParamsSchema, supportedMimeTypes } from "./file.schemas.js";

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 12);
}

async function findFile(app: FastifyInstance, id: string) {
  const [file] = await app.db.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
  return file;
}

export async function fileRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["文件"],
      summary: "获取我的源文件列表",
      querystring: paginationQuerySchema.extend({ projectId: z.uuid("项目 ID 格式不正确").optional() })
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(
      user.role === "SUPER_ADMIN" ? undefined : eq(files.ownerUserId, user.id),
      request.query.projectId ? eq(files.projectId, request.query.projectId) : undefined,
      isNull(files.deletedAt)
    );
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(files).where(where).orderBy(desc(files.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(files).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.post("/upload-intents", {
    preHandler: [app.authenticate],
    schema: { tags: ["文件"], summary: "创建文件直传凭证", body: createUploadIntentBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (request.body.sizeBytes > env.MAX_UPLOAD_BYTES) {
      throw new ForbiddenError(`文件不能超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
    }
    if (request.body.projectId) {
      const [project] = await app.db.select().from(projects).where(and(
        eq(projects.id, request.body.projectId), isNull(projects.deletedAt)
      )).limit(1);
      if (!project || !canManageProject(user, project)) throw new NotFoundError("项目不存在或无权上传项目文件");
    }

    const fileId = randomUUID();
    const scope = request.body.projectId ? `projects/${request.body.projectId}` : `users/${user.id}`;
    const objectKey = `${scope}/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(request.body.fileName)}`;
    const file = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(files).values({
        id: fileId,
        projectId: request.body.projectId,
        ownerUserId: user.id,
        storageProvider: app.storage.provider,
        bucket: app.storage.bucket,
        objectKey,
        originalName: request.body.fileName,
        mimeType: request.body.mimeType,
        sizeBytes: request.body.sizeBytes,
        sha256: request.body.sha256,
        status: "UPLOADING"
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: request.body.projectId,
        action: AUDIT_ACTIONS.FILE_UPLOAD_CREATED, targetType: "file", targetId: created!.id,
        afterJson: { fileName: created!.originalName, sizeBytes: created!.sizeBytes, mimeType: created!.mimeType }
      });
      return created!;
    });
    const upload = await app.storage.createUploadUrl(objectKey, file.mimeType, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
    return ok(request, {
      message: "上传凭证创建成功",
      fileId: file.id,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt
    });
  });

  route.post("/:id/complete", {
    preHandler: [app.authenticate],
    schema: { tags: ["文件"], summary: "确认文件上传完成", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !canAccessSourceFile(user, file)) throw new NotFoundError("文件不存在或无权操作");
    if (file.status !== "UPLOADING") throw new ForbiddenError("文件当前状态不能确认上传");

    const object = await app.storage.statObject(file.objectKey);
    if (!object) throw new NotFoundError("对象存储中未找到上传文件");
    if (object.size !== file.sizeBytes) throw new ForbiddenError("上传文件大小与申请信息不一致");
    const data = await app.storage.getObject(file.objectKey);
    if (file.sha256) {
      const actualSha256 = createHash("sha256").update(data).digest("hex");
      if (actualSha256.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new ForbiddenError("上传文件的 SHA-256 校验失败");
      }
    }
    const detected = await fileTypeFromBuffer(data);
    const detectedMime = detected?.mime ?? file.mimeType;
    if (!supportedMimeTypes.includes(detectedMime as typeof supportedMimeTypes[number])) {
      throw new ForbiddenError("文件真实类型不受支持");
    }

    const task = await app.db.transaction(async (tx) => {
      await tx.update(files).set({ mimeType: detectedMime, status: "QUEUED", updatedAt: new Date() })
        .where(eq(files.id, file.id));
      const [createdTask] = await tx.insert(asyncTasks).values({
        queueName: QUEUE_NAMES.DOCUMENT_PROCESSING,
        jobType: "parse_document",
        businessType: "file",
        businessId: file.id,
        payload: { fileId: file.id }
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: file.projectId ?? undefined,
        action: AUDIT_ACTIONS.FILE_UPLOAD_COMPLETED, targetType: "file", targetId: file.id,
        afterJson: { status: "QUEUED", taskId: createdTask!.id }
      });
      return createdTask!;
    });

    try {
      const job = await app.queues.documentProcessing.add("parse_document", { taskId: task.id, fileId: file.id }, { jobId: task.id });
      await app.db.update(asyncTasks).set({ bullJobId: String(job.id), updatedAt: new Date() }).where(eq(asyncTasks.id, task.id));
    } catch (error) {
      await app.db.update(asyncTasks).set({ status: "FAILED", errorMessage: "文档解析任务投递失败", updatedAt: new Date() })
        .where(eq(asyncTasks.id, task.id));
      await app.db.update(files).set({ status: "FAILED", errorMessage: "文档解析任务投递失败", updatedAt: new Date() })
        .where(eq(files.id, file.id));
      throw error;
    }

    return ok(request, { message: "文件上传完成，已进入解析队列", fileId: file.id, taskId: task.id });
  });

  route.get("/:id/status", {
    preHandler: [app.authenticate],
    schema: { tags: ["文件"], summary: "获取文件处理状态", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !canAccessSourceFile(user, file)) throw new NotFoundError("文件不存在或无权查看");
    const [task] = await app.db.select().from(asyncTasks).where(and(
      eq(asyncTasks.businessType, "file"), eq(asyncTasks.businessId, file.id)
    )).orderBy(desc(asyncTasks.createdAt)).limit(1);
    return ok(request, { file, task: task ?? null });
  });

  route.get("/:id/download-url", {
    preHandler: [app.authenticate],
    schema: { tags: ["文件"], summary: "获取源文件下载地址", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !canAccessSourceFile(user, file)) throw new NotFoundError("文件不存在或无权下载");
    const url = await app.storage.createDownloadUrl(file.objectKey, file.originalName, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
    await writeAuditLog({
      db: app.db, request, actor: user, projectId: file.projectId ?? undefined,
      action: AUDIT_ACTIONS.FILE_DOWNLOADED, targetType: "file", targetId: file.id
    });
    return ok(request, { url, expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS });
  });

  route.delete("/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["文件"], summary: "删除文件", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !canAccessSourceFile(user, file)) throw new NotFoundError("文件不存在或无权删除");
    await app.db.transaction(async (tx) => {
      await tx.update(files).set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() }).where(eq(files.id, file.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: file.projectId ?? undefined,
        action: AUDIT_ACTIONS.FILE_DELETED, targetType: "file", targetId: file.id,
        beforeJson: { status: file.status, objectKey: file.objectKey }
      });
    });
    return ok(request, { message: "文件已删除，存储对象将由维护任务延迟清理" });
  });
}
