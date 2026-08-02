import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";import { z } from "zod";
import {
  aiConversations,
  aiMessageFeedbacks,
  aiMessageRegenerations,
  aiMessages,
  aiRetrievalLogs,
  aiToolCalls,
  asyncTasks,
  auditLogs,
  files,
  projects,
  reportArtifacts,
  reportSources,
  reports,
  shareLinks,
  shareViews,
  users
} from "../../db/schema.js";
import { CLIENT_APPS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";

const conversationParamsSchema = z.object({ id: z.uuid("会话 ID 格式不正确") });
const messageParamsSchema = z.object({ id: z.uuid("消息 ID 格式不正确") });
const adminConversationQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(120).optional(),
  userId: z.uuid("用户 ID 格式不正确").optional(),
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  clientApp: z.enum([CLIENT_APPS.PC_AI, CLIENT_APPS.B_ADMIN, CLIENT_APPS.C_APP]).optional(),
  scene: z.string().trim().max(80).optional(),
  status: z.string().trim().max(32).optional()
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有 AI 会话运营权限");
  }
  return user;
}

export async function aiAdminRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/conversations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI运营"],
      summary: "查询 AI 会话运营列表",
      querystring: adminConversationQuerySchema
    }
  }, async (request) => {
    requireAdmin(request, "system:ai:conversation:list");
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const keyword = request.query.keyword?.replace(/[\\%_]/g, (value) => `\\${value}`);
    const where = and(
      request.query.userId ? eq(aiConversations.userId, request.query.userId) : undefined,
      request.query.projectId ? eq(aiConversations.projectId, request.query.projectId) : undefined,
      request.query.clientApp ? eq(aiConversations.clientApp, request.query.clientApp) : undefined,
      request.query.scene ? eq(aiConversations.scene, request.query.scene) : undefined,
      request.query.status ? eq(aiConversations.status, request.query.status) : undefined,
      keyword ? or(
        ilike(aiConversations.title, `%${keyword}%`),
        ilike(users.displayName, `%${keyword}%`),
        ilike(users.phone, `%${keyword}%`),
        ilike(projects.name, `%${keyword}%`)
      ) : undefined
    );
    const [rows, [totalRow]] = await Promise.all([
      app.db.select({ conversation: aiConversations, user: {
        id: users.id,
        displayName: users.displayName,
        phone: users.phone,
        role: users.role,
        channelType: users.channelType
      }, project: { id: projects.id, name: projects.name } })
        .from(aiConversations)
        .innerJoin(users, eq(users.id, aiConversations.userId))
        .leftJoin(projects, eq(projects.id, aiConversations.projectId))
        .where(where)
        .orderBy(desc(aiConversations.updatedAt))
        .offset(skip)
        .limit(take),
      app.db.select({ value: count() })
        .from(aiConversations)
        .innerJoin(users, eq(users.id, aiConversations.userId))
        .leftJoin(projects, eq(projects.id, aiConversations.projectId))
        .where(where)
    ]);
    const ids = rows.map((row) => row.conversation.id);
    const stats = ids.length === 0 ? [] : await app.db.select({ conversationId: aiMessages.conversationId, messageCount: count() })
      .from(aiMessages).where(inArray(aiMessages.conversationId, ids)).groupBy(aiMessages.conversationId);
    const statsMap = new Map(stats.map((item) => [item.conversationId, item.messageCount]));
    return ok(request, {
      items: rows.map((row) => ({ ...row, messageCount: statsMap.get(row.conversation.id) ?? 0 })),
      total: totalRow?.value ?? 0,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.get("/conversations/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI运营"],
      summary: "查看 AI 会话运营详情",
      params: conversationParamsSchema
    }
  }, async (request) => {
    requireAdmin(request, "system:ai:conversation:detail");
    const [row] = await app.db.select({ conversation: aiConversations, user: {
      id: users.id,
      displayName: users.displayName,
      phone: users.phone,
      email: users.email,
      role: users.role,
      channelType: users.channelType,
      status: users.status
    }, project: projects })
      .from(aiConversations)
      .innerJoin(users, eq(users.id, aiConversations.userId))
      .leftJoin(projects, eq(projects.id, aiConversations.projectId))
      .where(eq(aiConversations.id, request.params.id)).limit(1);
    if (!row) throw new NotFoundError("AI 会话不存在");

    const messages = await app.db.select().from(aiMessages)
      .where(eq(aiMessages.conversationId, row.conversation.id)).orderBy(asc(aiMessages.createdAt));
    const messageIds = messages.map((message) => message.id);
    const reportRows = await app.db.select().from(reports)
      .where(eq(reports.conversationId, row.conversation.id)).orderBy(desc(reports.createdAt));
    const reportIds = reportRows.map((report) => report.id);
    const [retrievals, toolCalls, feedbacks, regenerations, reportSourcesRows, artifactRows, tasks] = await Promise.all([
      app.db.select().from(aiRetrievalLogs).where(eq(aiRetrievalLogs.conversationId, row.conversation.id)).orderBy(asc(aiRetrievalLogs.createdAt)),
      app.db.select().from(aiToolCalls).where(eq(aiToolCalls.conversationId, row.conversation.id)).orderBy(asc(aiToolCalls.createdAt)),
      app.db.select().from(aiMessageFeedbacks).where(eq(aiMessageFeedbacks.conversationId, row.conversation.id)).orderBy(desc(aiMessageFeedbacks.createdAt)),
      app.db.select().from(aiMessageRegenerations).where(eq(aiMessageRegenerations.conversationId, row.conversation.id)).orderBy(asc(aiMessageRegenerations.createdAt)),
      reportIds.length === 0 ? Promise.resolve([]) : app.db.select().from(reportSources).where(inArray(reportSources.reportId, reportIds)).orderBy(asc(reportSources.sortOrder)),
      reportIds.length === 0 ? Promise.resolve([]) : app.db.select({ artifact: reportArtifacts, file: files })
        .from(reportArtifacts).innerJoin(files, eq(files.id, reportArtifacts.fileId)).where(inArray(reportArtifacts.reportId, reportIds)),
      reportIds.length === 0 ? Promise.resolve([]) : app.db.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"), inArray(asyncTasks.businessId, reportIds))).orderBy(desc(asyncTasks.createdAt))
    ]);

    const artifactIds = artifactRows.map((item) => item.artifact.id);
    const projectShares = row.conversation.projectId
      ? await app.db.select().from(shareLinks).where(eq(shareLinks.projectId, row.conversation.projectId))
      : [];
    const messageShares = messageIds.length === 0 ? [] : await app.db.select().from(shareLinks)
      .where(and(eq(shareLinks.targetType, "AI_MESSAGES"), inArray(shareLinks.targetId, messageIds)));
    const allShares = [...projectShares, ...messageShares].filter((share, index, list) => list.findIndex((item) => item.id === share.id) === index)
      .filter((share) => (share.targetType === "AI_MESSAGES" && messageIds.includes(share.targetId ?? "")) ||
        (share.targetType === "REPORT" && reportIds.includes(share.targetId ?? "")) ||
        (share.targetType === "REPORT_ARTIFACT" && artifactIds.includes(share.targetId ?? "")));
    const shareIds = allShares.map((share) => share.id);
    const shareViewRows = shareIds.length === 0 ? [] : await app.db.select().from(shareViews)
      .where(inArray(shareViews.shareLinkId, shareIds)).orderBy(desc(shareViews.createdAt));
    const auditTargetIds = [...messageIds, ...reportIds, row.conversation.id];
    const conversationAuditLogs = auditTargetIds.length === 0 ? [] : await app.db.select().from(auditLogs)
      .where(inArray(auditLogs.targetId, auditTargetIds)).orderBy(desc(auditLogs.createdAt));

    return ok(request, {
      conversation: row.conversation,
      user: row.user,
      project: row.project,
      messages,
      processingSummary: {
        stages: [
          { stage: "analyzing", message: row.conversation.projectId ? "正在分析项目资料..." : "正在分析问题..." },
          ...(row.conversation.projectId ? [{ stage: "checking", message: "正在核对标准和计算结果..." }] : []),
          { stage: "composing", message: "正在整理回答..." }
        ],
        note: "管理端展示处理阶段、引用和工具调用摘要，不返回模型原始思考链或任何密钥。"
      },
      retrievals,
      toolCalls,
      feedbacks,
      regenerations,
      reports: reportRows.map((report) => ({
        ...report,
        sources: reportSourcesRows.filter((source) => source.reportId === report.id),
        artifacts: artifactRows.filter((item) => item.artifact.reportId === report.id)
      })),
      tasks,
      shareLinks: allShares,
      shareViews: shareViewRows,
      auditLogs: conversationAuditLogs
    });
  });

  route.get("/messages/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI运营"],
      summary: "查看 AI 消息详情",
      params: messageParamsSchema
    }
  }, async (request) => {
    requireAdmin(request, "system:ai:conversation:detail");
    const [row] = await app.db.select({
      message: aiMessages,
      conversation: {
        id: aiConversations.id,
        title: aiConversations.title,
        scene: aiConversations.scene,
        projectId: aiConversations.projectId,
        clientApp: aiConversations.clientApp
      },
      user: { id: users.id, displayName: users.displayName, phone: users.phone }
    })
      .from(aiMessages)
      .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
      .innerJoin(users, eq(users.id, aiConversations.userId))
      .where(eq(aiMessages.id, request.params.id)).limit(1);
    if (!row) throw new NotFoundError("AI 消息不存在");

    const feedbacks = await app.db.select().from(aiMessageFeedbacks)
      .where(eq(aiMessageFeedbacks.messageId, row.message.id)).orderBy(desc(aiMessageFeedbacks.createdAt));
    const regenerations = await app.db.select().from(aiMessageRegenerations)
      .where(or(
        eq(aiMessageRegenerations.originalMessageId, row.message.id),
        eq(aiMessageRegenerations.regeneratedMessageId, row.message.id)
      )).orderBy(asc(aiMessageRegenerations.createdAt));

    return ok(request, {
      message: row.message,
      conversation: row.conversation,
      user: row.user,
      feedbacks,
      regenerations
    });
  });
}
