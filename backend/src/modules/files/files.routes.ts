import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { asyncTasks, files, projects } from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import { AUDIT_ACTIONS, AUTH_CLIENTS } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { requirePermission } from "../../shared/permission-guard.js";
import { requireClient } from "../../shared/client-guard.js";
import { FILE_CENTER_PERMISSIONS } from "../../shared/file-permissions.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { getPagination } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { canAccessSourceFile, canDeleteProjectFile, canReadProjectFile } from "./file-access.js";
import {
  assertFileNotReferenced,
  findCenterFile,
  findReusableFile,
  getCenterFileDetail,
  listCenterFiles,
  listRecentFiles,
  previewCenterFile
} from "./file-center.service.js";
import { getFileReferences } from "./file-reference.service.js";
import {
  createUploadIntentBodySchema,
  fileCenterListQuerySchema,
  fileParamsSchema,
  fileRecentQuerySchema,
  supportedMimeTypes
} from "./file.schemas.js";

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 12);
}

async function findFile(app: FastifyInstance, id: string) {
  const [file] = await app.db.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
  return file;
}

async function findProject(app: FastifyInstance, id: string) {
  const [project] = await app.db.select().from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))).limit(1);
  return project;
}

async function canReadFile(app: FastifyInstance, user: ReturnType<typeof getCurrentUser>, file: { ownerUserId: string; projectId: string | null }) {
  if (!file.projectId) return canAccessSourceFile(user, file);
  const project = await findProject(app, file.projectId);
  return Boolean(project && canReadProjectFile(user, file, project));
}

export async function fileRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // B 端：文件中心 / FilePicker 列表（全平台 READY 文件，支持筛选排序与引用计数）
  // C 端与 PC AI 端：保持原口径（本人或项目内源文件）
  route.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 文件"],
      summary: "文件列表（B 端为文件中心/FilePicker 全平台口径，C 端为我的源文件）",
      querystring: fileCenterListQuerySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (user.clientType === "B_ADMIN") {
      if (request.query.includeRecycled === "1") {
        await requirePermission(FILE_CENTER_PERMISSIONS.VIEW)(request);
      }
      const result = await listCenterFiles(app, request.query);
      return ok(request, result);
    }
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    if (request.query.projectId) {
      const project = await findProject(app, request.query.projectId);
      if (!project || !canViewProject(user, project)) {
        throw new NotFoundError("项目不存在或无权查看资料");
      }
    }
    const where = and(
      request.query.projectId ? eq(files.projectId, request.query.projectId) : (user.role === "SUPER_ADMIN" ? undefined : eq(files.ownerUserId, user.id)),
      isNull(files.deletedAt)
    );
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(files).where(where).orderBy(desc(files.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(files).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  const createUploadIntent = async (request: FastifyRequest<{ Body: z.infer<typeof createUploadIntentBodySchema> }>) => {
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

    // SHA256 去重：同内容且状态 READY 的文件直接复用，不重复占用对象存储
    if (request.body.sha256) {
      const reusable = await findReusableFile(app, request.body.sha256);
      if (reusable) {
        await writeAuditLog({
          db: app.db, request, actor: user, projectId: reusable.projectId ?? undefined,
          action: AUDIT_ACTIONS.FILE_REUSED, targetType: "file", targetId: reusable.id,
          afterJson: { sha256: request.body.sha256, originalName: request.body.fileName }
        });
        return ok(request, {
          mode: "REUSE" as const,
          message: "已存在相同文件，已直接使用",
          fileId: reusable.id,
          file: {
            id: reusable.id,
            originalName: reusable.originalName,
            mimeType: reusable.mimeType,
            sizeBytes: reusable.sizeBytes,
            sha256: reusable.sha256
          }
        });
      }
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
      mode: "UPLOAD" as const,
      message: "上传凭证创建成功",
      fileId: file.id,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt
    });
  };

  route.post("/upload-intents", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 文件"], summary: "创建文件直传凭证（同 SHA-256 内容自动复用已有文件）", body: createUploadIntentBodySchema }
  }, createUploadIntent);

  route.post("/upload-intent", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 文件"], summary: "创建文件直传凭证（/upload-intents 别名）", body: createUploadIntentBodySchema }
  }, createUploadIntent);

  route.post("/:id/complete", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 文件"], summary: "确认文件上传完成", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id)
    if (!file) throw new NotFoundError("文件不存在或无权操作");
    if (file.projectId) {
      const project = await findProject(app, file.projectId);
      if (!project || !canManageProject(user, project)) throw new NotFoundError("文件不存在或无权操作");
    } else if (!canAccessSourceFile(user, file)) {
      throw new NotFoundError("文件不存在或无权操作");
    }
    if (file.status !== "UPLOADING") throw new ForbiddenError("文件当前状态不能确认上传");

    const object = await app.storage.statObject(file.objectKey);
    if (!object) throw new NotFoundError("对象存储中未找到上传文件");
    if (object.size !== file.sizeBytes) throw new ForbiddenError("上传文件大小与申请信息不一致");
    const data = await app.storage.getObject(file.objectKey);
    const actualSha256 = createHash("sha256").update(data).digest("hex");
    if (file.sha256) {
      if (actualSha256.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new ForbiddenError("上传文件的 SHA-256 校验失败");
      }
    }
    const detected = await fileTypeFromBuffer(data);
    const detectedMime = detected?.mime ?? file.mimeType;
    if (!supportedMimeTypes.includes(detectedMime as typeof supportedMimeTypes[number])) {
      throw new ForbiddenError("文件真实类型不受支持");
    }

    // 去重兜底：上传完成后发现同 SHA-256 的 READY 文件已存在，本次文件直接标记删除（不影响已有文件，不阻塞上传）
    const duplicate = await findReusableFile(app, actualSha256, file.id);
    if (duplicate) {
      await app.db.transaction(async (tx) => {
        await tx.update(files).set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(files.id, file.id));
        await writeAuditLog({
          db: tx, request, actor: user, projectId: file.projectId ?? undefined,
          action: AUDIT_ACTIONS.FILE_DELETED, targetType: "file", targetId: file.id,
          beforeJson: { status: file.status, objectKey: file.objectKey },
          afterJson: { reason: "SHA256_DUPLICATE", duplicateOfFileId: duplicate.id }
        });
      });
      return ok(request, {
        message: "已存在相同文件，本次上传已合并",
        fileId: duplicate.id,
        duplicateOfFileId: duplicate.id
      });
    }

    const normalizedSha256 = file.sha256 ? undefined : actualSha256.toLowerCase();
    const task = await app.db.transaction(async (tx) => {
      await tx.update(files).set({ mimeType: detectedMime, status: "QUEUED", updatedAt: new Date(), ...(normalizedSha256 ? { sha256: normalizedSha256 } : {}) })
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
    schema: { tags: ["共用 / 文件"], summary: "获取文件处理状态", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !(await canReadFile(app, user, file))) throw new NotFoundError("文件不存在或无权查看");
    const [task] = await app.db.select().from(asyncTasks).where(and(
      eq(asyncTasks.businessType, "file"), eq(asyncTasks.businessId, file.id)
    )).orderBy(desc(asyncTasks.createdAt)).limit(1);
    return ok(request, { file, task: task ?? null });
  });

  route.get("/:id/download-url", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 文件"], summary: "获取源文件下载地址", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file || !(await canReadFile(app, user, file))) throw new NotFoundError("文件不存在或无权下载");
    const url = await app.storage.createDownloadUrl(file.objectKey, file.originalName, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
    await writeAuditLog({
      db: app.db, request, actor: user, projectId: file.projectId ?? undefined,
      action: AUDIT_ACTIONS.FILE_DOWNLOADED, targetType: "file", targetId: file.id
    });
    return ok(request, { url, expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS });
  });

  route.delete("/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 文件"], summary: "删除文件", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const file = await findFile(app, request.params.id);
    if (!file) throw new NotFoundError("文件不存在或无权删除");
    const project = file.projectId ? await findProject(app, file.projectId) : undefined;
    if (!canDeleteProjectFile(user, file, project)) throw new NotFoundError("文件不存在或无权删除");
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

  // ---------------------------------------------------------------- 文件中心（B 端）

  route.get("/recent", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["共用 / 文件"], summary: "FilePicker 最近使用文件（当前用户上传时间倒序）", querystring: fileRecentQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const items = await listRecentFiles(app, user.id, request.query.limit);
    return ok(request, { items });
  });

  route.get("/:id", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["共用 / 文件"], summary: "文件中心文件详情（含引用计数）", params: fileParamsSchema }
  }, async (request) => {
    const detail = await getCenterFileDetail(app, request.params.id);
    if (!detail) throw new NotFoundError("文件不存在或已删除");
    return ok(request, detail);
  });

  route.get("/:id/references", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN), requirePermission(FILE_CENTER_PERMISSIONS.VIEW)],
    schema: { tags: ["共用 / 文件"], summary: "文件引用关系（各业务关系表聚合）", params: fileParamsSchema }
  }, async (request) => {
    const file = await findCenterFile(app, request.params.id);
    if (!file) throw new NotFoundError("文件不存在或已删除");
    const references = await getFileReferences(app.db, file.file.id);
    return ok(request, { items: references, total: references.length });
  });

  route.get("/:id/preview", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["共用 / 文件"], summary: "文件预览（可内联类型返回短期签名 URL，其余返回下载模式）", params: fileParamsSchema }
  }, async (request) => {
    const row = await findCenterFile(app, request.params.id);
    if (!row) throw new NotFoundError("文件不存在或已删除");
    if (row.file.status === "RECYCLED") throw new ForbiddenError("回收站文件不可预览");
    const preview = await previewCenterFile(app, row.file);
    return ok(request, { fileId: row.file.id, ...preview });
  });

  route.post("/:id/recycle", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN), requirePermission(FILE_CENTER_PERMISSIONS.MANAGE)],
    schema: { tags: ["共用 / 文件"], summary: "文件移入回收站（被业务引用时拒绝）", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await findCenterFile(app, request.params.id);
    if (!row) throw new NotFoundError("文件不存在或已删除");
    const file = row.file;
    if (file.status === "RECYCLED") throw new ForbiddenError("文件已在回收站中");
    await assertFileNotReferenced(app, file.id);
    await app.db.transaction(async (tx) => {
      await tx.update(files).set({ status: "RECYCLED", recycledAt: new Date(), recycledById: user.id, updatedAt: new Date() })
        .where(eq(files.id, file.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: file.projectId ?? undefined,
        action: AUDIT_ACTIONS.FILE_RECYCLED, targetType: "file", targetId: file.id,
        beforeJson: { status: file.status }
      });
    });
    return ok(request, { message: "文件已移入回收站" });
  });

  route.post("/:id/restore", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN), requirePermission(FILE_CENTER_PERMISSIONS.MANAGE)],
    schema: { tags: ["共用 / 文件"], summary: "从回收站恢复文件", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await findCenterFile(app, request.params.id);
    if (!row) throw new NotFoundError("文件不存在或已删除");
    const file = row.file;
    if (file.status !== "RECYCLED") throw new ForbiddenError("仅回收站中的文件可以恢复");
    await app.db.transaction(async (tx) => {
      await tx.update(files).set({ status: "READY", recycledAt: null, recycledById: null, updatedAt: new Date() })
        .where(eq(files.id, file.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: file.projectId ?? undefined,
        action: AUDIT_ACTIONS.FILE_RESTORED, targetType: "file", targetId: file.id,
        beforeJson: { status: file.status }
      });
    });
    return ok(request, { message: "文件已恢复" });
  });

  route.delete("/:id/permanent", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN), requirePermission(FILE_CENTER_PERMISSIONS.MANAGE)],
    schema: { tags: ["共用 / 文件"], summary: "回收站文件永久删除（仍受引用保护）", params: fileParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await findCenterFile(app, request.params.id);
    if (!row) throw new NotFoundError("文件不存在或已删除");
    const file = row.file;
    if (file.status !== "RECYCLED") throw new ForbiddenError("仅回收站中的文件可以永久删除");
    await assertFileNotReferenced(app, file.id);
    // 一期只删除数据库行标记，OSS 对象由维护任务延迟清理，保留可追溯审计
    await app.db.transaction(async (tx) => {
      await tx.update(files).set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(files.id, file.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: file.projectId ?? undefined,
        action: AUDIT_ACTIONS.FILE_PERMANENT_DELETED, targetType: "file", targetId: file.id,
        beforeJson: { status: file.status, objectKey: file.objectKey }
      });
    });
    return ok(request, { message: "文件已永久删除，存储对象将由维护任务延迟清理" });
  });
}
