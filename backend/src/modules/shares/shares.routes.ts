import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  aiConversations,
  aiMessages,
  files,
  projects,
  reportArtifacts,
  reports,
  shareLinks,
  shareViews
} from "../../db/schema.js";
import { AUDIT_ACTIONS, SHARE_TARGET_TYPES } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject } from "../../shared/permissions.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const shareTargetValues = [
  SHARE_TARGET_TYPES.AI_MESSAGES,
  SHARE_TARGET_TYPES.REPORT,
  SHARE_TARGET_TYPES.REPORT_ARTIFACT,
  SHARE_TARGET_TYPES.PROJECT
] as const;

const createShareBodySchema = z.object({
  targetType: z.enum(shareTargetValues),
  messageIds: z.array(z.uuid("AI 回答 ID 格式不正确")).max(20, "一次最多分享 20 条 AI 回答").optional(),
  reportId: z.uuid("报告 ID 格式不正确").optional(),
  artifactType: z.enum(["HTML", "IMAGE", "WORD", "PDF"]).optional(),
  title: z.string().trim().min(1, "请输入分享标题").max(160, "分享标题不能超过 160 个字符").optional(),
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  expiresAt: z.coerce.date("过期时间格式不正确").optional(),
  maxViews: z.number().int().positive("最大访问次数必须大于 0").max(1_000_000, "最大访问次数过大").optional()
});
const shareParamsSchema = z.object({ id: z.uuid("分享链接 ID 格式不正确") });
const publicShareParamsSchema = z.object({ token: z.string().min(16, "分享链接不正确").max(80, "分享链接不正确") });

function createShareToken() {
  return randomBytes(24).toString("base64url");
}

function uniqueIds(ids: string[] | undefined) {
  return [...new Set(ids ?? [])];
}

function sharePath(token: string) {
  return `/api/v1/public/shares/${token}`;
}

export async function shareRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/shares", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["公开分享"],
      summary: "创建公开分享链接",
      body: createShareBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const token = createShareToken();
    let projectId: string | null = null;
    let targetId: string | null = null;
    let title = request.body.title;
    let snapshotJson: Record<string, unknown>;

    if (request.body.targetType === SHARE_TARGET_TYPES.PROJECT) {
      if (!request.body.projectId) throw new NotFoundError("请选择要分享的项目");
      const [row] = await app.db.select().from(projects).where(and(
        eq(projects.id, request.body.projectId),
        isNull(projects.deletedAt)
      )).limit(1);
      if (!row || !canManageProject(user, row)) throw new NotFoundError("项目不存在或无权分享");
      const publishedReports = await app.db.select({
        id: reports.id,
        reportType: reports.reportType,
        contentJson: reports.contentJson,
        templateVersion: reports.templateVersion,
        publishedAt: reports.publishedAt
      }).from(reports).where(and(
        eq(reports.projectId, row.id),
        eq(reports.status, "READY"),
        isNotNull(reports.publishedAt),
        isNull(reports.deletedAt)
      )).orderBy(reports.publishedAt);
      projectId = row.id;
      targetId = row.id;
      title ??= `${row.name} 项目分享`;
      snapshotJson = {
        type: SHARE_TARGET_TYPES.PROJECT,
        project: {
          id: row.id,
          name: row.name,
          description: row.description,
          region: row.region,
          buildingType: row.buildingType,
          visibility: row.visibility,
          createdAt: row.createdAt
        },
        publishedReports
      };
    } else if (request.body.targetType === SHARE_TARGET_TYPES.AI_MESSAGES) {
      const messageIds = uniqueIds(request.body.messageIds);
      if (messageIds.length === 0) throw new NotFoundError("请选择要分享的 AI 回答");
      const rows = await app.db.select({ message: aiMessages, conversation: aiConversations })
        .from(aiMessages)
        .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
        .where(inArray(aiMessages.id, messageIds));
      if (rows.length !== messageIds.length) throw new NotFoundError("选择的 AI 回答不存在或无权分享");
      const orderedRows = messageIds
        .map((id) => rows.find((row) => row.message.id === id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      const firstConversationId = orderedRows[0]!.conversation.id;
      for (const row of orderedRows) {
        if (
          row.message.role !== "ASSISTANT" ||
          row.message.status !== "COMPLETED" ||
          row.conversation.status !== "active" ||
          row.conversation.userId !== user.id ||
          row.conversation.id !== firstConversationId
        ) {
          throw new NotFoundError("选择的 AI 回答不存在或无权分享");
        }
      }
      projectId = orderedRows[0]!.conversation.projectId;
      targetId = orderedRows[0]!.message.id;
      title ??= orderedRows[0]!.conversation.title ?? "AI 回答分享";
      snapshotJson = {
        type: SHARE_TARGET_TYPES.AI_MESSAGES,
        conversationId: firstConversationId,
        scene: orderedRows[0]!.conversation.scene,
        messages: orderedRows.map((row, index) => ({
          index: index + 1,
          id: row.message.id,
          content: row.message.content,
          model: row.message.model,
          createdAt: row.message.createdAt
        }))
      };
    } else if (request.body.targetType === SHARE_TARGET_TYPES.REPORT) {
      if (!request.body.reportId) throw new NotFoundError("请选择要分享的报告");
      const [row] = await app.db.select({ report: reports, project: projects })
        .from(reports)
        .innerJoin(projects, eq(projects.id, reports.projectId))
        .where(and(eq(reports.id, request.body.reportId), isNull(reports.deletedAt), isNull(projects.deletedAt)))
        .limit(1);
      if (!row || !canManageProject(user, row.project)) throw new NotFoundError("报告不存在或无权分享");
      if (row.report.status !== "READY") throw new ForbiddenError("报告尚未生成完成，不能分享");
      projectId = row.project.id;
      targetId = row.report.id;
      title ??= "报告分享";
      snapshotJson = {
        type: SHARE_TARGET_TYPES.REPORT,
        reportId: row.report.id,
        reportType: row.report.reportType,
        contentJson: row.report.contentJson,
        publishedAt: row.report.publishedAt,
        templateVersion: row.report.templateVersion
      };
    } else {
      if (!request.body.reportId || !request.body.artifactType) throw new NotFoundError("请选择要分享的报告文件");
      const [row] = await app.db.select({ report: reports, project: projects, artifact: reportArtifacts })
        .from(reportArtifacts)
        .innerJoin(reports, eq(reports.id, reportArtifacts.reportId))
        .innerJoin(projects, eq(projects.id, reports.projectId))
        .where(and(
          eq(reports.id, request.body.reportId),
          eq(reportArtifacts.type, request.body.artifactType),
          isNull(reports.deletedAt),
          isNull(projects.deletedAt)
        ))
        .limit(1);
      if (!row || !canManageProject(user, row.project)) throw new NotFoundError("报告文件不存在或无权分享");
      if (row.report.status !== "READY") throw new ForbiddenError("报告尚未生成完成，不能分享");
      projectId = row.project.id;
      targetId = row.artifact.id;
      title ??= `${request.body.artifactType} 报告文件分享`;
      snapshotJson = {
        type: SHARE_TARGET_TYPES.REPORT_ARTIFACT,
        reportId: row.report.id,
        artifactId: row.artifact.id,
        artifactType: row.artifact.type
      };
    }

    const share = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(shareLinks).values({
        token,
        targetType: request.body.targetType,
        targetId,
        projectId,
        createdById: user.id,
        title: title!,
        snapshotJson,
        expiresAt: request.body.expiresAt,
        maxViews: request.body.maxViews
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: projectId ?? undefined,
        action: AUDIT_ACTIONS.SHARE_LINK_CREATED,
        targetType: "share_link",
        targetId: created!.id,
        afterJson: {
          targetType: created!.targetType,
          targetId: created!.targetId,
          expiresAt: created!.expiresAt,
          maxViews: created!.maxViews
        }
      });
      return created!;
    });

    return ok(request, {
      message: "分享链接创建成功",
      share,
      url: sharePath(share.token)
    });
  });

  route.patch("/shares/:id/disable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["公开分享"],
      summary: "禁用公开分享链接",
      params: shareParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const [share] = await app.db.select().from(shareLinks).where(eq(shareLinks.id, request.params.id)).limit(1);
    if (!share || (share.createdById !== user.id && user.role !== "SUPER_ADMIN")) {
      throw new NotFoundError("分享链接不存在或无权操作");
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(shareLinks)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(shareLinks.id, share.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: share.projectId ?? undefined,
        action: AUDIT_ACTIONS.SHARE_LINK_DISABLED,
        targetType: "share_link",
        targetId: share.id
      });
      return row!;
    });
    return ok(request, { message: "分享链接已禁用", share: updated });
  });
}

export async function publicShareRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/shares/:token", {
    schema: {
      tags: ["公开分享"],
      summary: "公开查看分享内容",
      params: publicShareParamsSchema
    }
  }, async (request) => {
    const [share] = await app.db.select().from(shareLinks).where(eq(shareLinks.token, request.params.token)).limit(1);
    if (!share || !share.enabled) throw new NotFoundError("分享链接不存在或已失效");
    if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) throw new NotFoundError("分享链接已过期");
    if (share.maxViews !== null && share.viewCount >= share.maxViews) throw new NotFoundError("分享链接访问次数已用完");

    let payload: Record<string, unknown> = share.snapshotJson;
    if (share.targetType === SHARE_TARGET_TYPES.PROJECT) {
      payload = {
        project: share.snapshotJson.project,
        publishedReports: share.snapshotJson.publishedReports
      };
    } else if (share.targetType === SHARE_TARGET_TYPES.REPORT_ARTIFACT && share.targetId) {
      const [artifact] = await app.db.select({ artifact: reportArtifacts, file: files })
        .from(reportArtifacts)
        .innerJoin(files, eq(files.id, reportArtifacts.fileId))
        .where(eq(reportArtifacts.id, share.targetId))
        .limit(1);
      if (!artifact) throw new NotFoundError("分享的报告文件不存在");
      const downloadUrl = await app.storage.createDownloadUrl(
        artifact.file.objectKey,
        artifact.file.originalName,
        env.STORAGE_PRESIGN_EXPIRES_SECONDS
      );
      payload = {
        ...payload,
        fileName: artifact.file.originalName,
        artifactType: artifact.artifact.type,
        downloadUrl,
        expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS
      };
    }

    await app.db.transaction(async (tx) => {
      await tx.insert(shareViews).values({
        shareLinkId: share.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        referer: request.headers.referer
      });
      await tx.update(shareLinks)
        .set({ viewCount: sql`${shareLinks.viewCount} + 1`, updatedAt: new Date() })
        .where(eq(shareLinks.id, share.id));
      await writeAuditLog({
        db: tx, request, projectId: share.projectId ?? undefined,
        action: AUDIT_ACTIONS.SHARE_LINK_VIEWED,
        targetType: "share_link",
        targetId: share.id
      });
    });

    return ok(request, {
      title: share.title,
      targetType: share.targetType,
      payload
    });
  });
}
