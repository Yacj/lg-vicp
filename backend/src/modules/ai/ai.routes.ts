import { randomUUID } from "node:crypto";
import { generateObject, streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  aiConversations,
  aiMessageFeedbacks,
  aiMessageRegenerations,
  aiMessages,
  aiRetrievalLogs,
  aiScenes,
  files,
  projects,
  reportArtifacts,
  reportSources,
  reports,
  shareLinks,
  users
} from "../../db/schema.js";
import { AI_FEEDBACK_REACTIONS, AI_SCENES, AUTH_CLIENTS, AUDIT_ACTIONS, CLIENT_APPS, SHARE_TARGET_TYPES } from "../../shared/constants.js";
import { AiError, toAiError } from "../../shared/ai-errors.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError } from "../../shared/errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { estimateTokens, buildSystemMessages, type ContextMessage } from "../../shared/prompt-assembly.js";
import { budgetHistory } from "../../shared/prompt-assembly.js";
import { ok } from "../../shared/response.js";
import { isAbortError, startSseStream, writeProgress, writeSse } from "./ai-sse.js";
import { checkContentFiltered } from "./ai-content-filter.service.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { formatKnowledgeContext, searchProjectKnowledge } from "../knowledge/knowledge.service.js";
import {
  enforceAiQuota,
  getAiQuota,
  releaseAiConcurrency,
  resolveSceneRuntime,
  type SceneRuntime
} from "./ai-runtime.service.js";

const sceneValues = [
  AI_SCENES.GENERAL_CHAT,
  AI_SCENES.PROJECT_DESIGN,
  AI_SCENES.MATERIAL_COMPARE,
  AI_SCENES.STANDARD_QA,
  AI_SCENES.REPORT_GENERATE,
  AI_SCENES.INFORMATION_EXTRACT
] as const;

const createConversationBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  clientApp: z.enum([CLIENT_APPS.PC_AI, CLIENT_APPS.B_ADMIN, CLIENT_APPS.C_APP]),
  scene: z.enum(sceneValues),
  title: z.string().trim().max(120, "会话标题不能超过 120 个字符").optional(),
  reasoningMode: z.enum(["OFF", "ON"]).default("OFF")
});
const conversationParamsSchema = z.object({ id: z.uuid("会话 ID 格式不正确") });
const conversationSettingsBodySchema = z.object({
  reasoningMode: z.enum(["OFF", "ON"])
});
const conversationListQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(120).optional(),
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  clientApp: z.enum([CLIENT_APPS.PC_AI, CLIENT_APPS.B_ADMIN, CLIENT_APPS.C_APP]).optional(),
  pinned: z.stringbool().optional(),
  includeDeleted: z.stringbool().default(false)
});
const conversationUpdateBodySchema = z.object({
  title: z.string().trim().min(1, "会话标题不能为空").max(120, "会话标题不能超过 120 个字符")
});
const pinBodySchema = z.object({ pinned: z.boolean() });
const moveProjectBodySchema = z.object({ projectId: z.uuid("项目 ID 格式不正确").nullable() });
const sendMessageBodySchema = z.object({
  content: z.string().trim().min(1, "请输入消息内容").max(20_000, "单条消息不能超过 20000 个字符")
});
const messageParamsSchema = z.object({ id: z.uuid("AI 消息 ID 格式不正确") });
const feedbackBodySchema = z.object({
  reaction: z.enum([AI_FEEDBACK_REACTIONS.LIKE, AI_FEEDBACK_REACTIONS.DISLIKE]).nullable().optional(),
  reasonCode: z.string().trim().max(40, "原因编码不能超过 40 个字符").optional(),
  tags: z.array(z.string().trim().min(1, "反馈标签不能为空").max(40, "单个反馈标签不能超过 40 个字符"))
    .max(10, "反馈标签不能超过 10 个").default([]),
  content: z.string().trim().max(1000, "反馈内容不能超过 1000 个字符").nullable().optional(),
  clientApp: z.enum([CLIENT_APPS.PC_AI, CLIENT_APPS.B_ADMIN, CLIENT_APPS.C_APP]).optional()
});
const regenerateBodySchema = z.object({
  reason: z.string().trim().max(500, "重新生成原因不能超过 500 个字符").optional()
});
const updateSceneBodySchema = z.object({
  scene: z.enum(sceneValues)
});
const updateGroupBodySchema = z.object({
  groupId: z.string().trim().min(1, "分组名不能为空").max(80, "分组名不能超过 80 个字符").nullable()
});
const reportDraftBodySchema = z.object({
  reportType: z.enum(["energy_design", "design_note", "marketing_copy"]),
  requirements: z.string().trim().max(4000, "补充要求不能超过 4000 个字符").optional()
});
const reportDraftOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  projectOverview: z.object({
    name: z.string(),
    region: z.string().nullable(),
    buildingType: z.string().nullable()
  }),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string(),
    citations: z.array(z.object({ sourceTitle: z.string(), page: z.number().int().positive().nullable() }))
  })),
  risks: z.array(z.string()),
  disclaimer: z.string()
});

type ActiveGeneration = {
  controller: AbortController;
  conversationId: string;
  userId: string;
  stopRequested: boolean;
  stopReason?: "USER" | "CLIENT_DISCONNECTED";
};

async function findConversation(app: FastifyInstance, id: string) {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.status, "active"))).limit(1);
  return conversation;
}

async function findConversationById(app: FastifyInstance, id: string) {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(eq(aiConversations.id, id)).limit(1);
  return conversation;
}

function ensureConversationOwner(user: ReturnType<typeof getCurrentUser>, conversation: NonNullable<Awaited<ReturnType<typeof findConversation>>>) {
  if (user.role !== "SUPER_ADMIN" && conversation.userId !== user.id) {
    throw new NotFoundError("AI 会话不存在或无权查看");
  }
}

function expectedClientApp(clientType: ReturnType<typeof getCurrentUser>["clientType"]) {
  if (clientType === AUTH_CLIENTS.B_ADMIN) return CLIENT_APPS.B_ADMIN;
  if (clientType === AUTH_CLIENTS.PC_AI) return CLIENT_APPS.PC_AI;
  return CLIENT_APPS.C_APP;
}

async function findAssistantMessageWithConversation(app: FastifyInstance, id: string) {
  const [row] = await app.db.select({ message: aiMessages, conversation: aiConversations })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
    .where(and(
      eq(aiMessages.id, id),
      eq(aiMessages.role, "ASSISTANT"),
      eq(aiConversations.status, "active")
    ))
    .limit(1);
  return row;
}

async function enforceAiRateLimit(app: FastifyInstance, userId: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `ai:rate:${userId}:${minute}`;
  const count = await app.redis.incr(key);
  if (count === 1) await app.redis.expire(key, 70);
  if (count > env.AI_RATE_LIMIT_PER_MINUTE) {
    throw new TooManyRequestsError("AI 请求过于频繁，请稍后再试");
  }
}

/** 模型 contextWindow 缺省时的保守预算 */
const DEFAULT_CONTEXT_WINDOW = 32_000;

/** 项目上下文（仅 requireProject 场景注入） */
async function resolveProjectContext(app: FastifyInstance, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const [project] = await app.db.select().from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  if (!project) return null;
  return [
    `项目名称：${project.name}`,
    project.description ? `项目描述：${project.description}` : null,
    project.region ? `所在地区：${project.region}` : null,
    project.buildingType ? `建筑类型：${project.buildingType}` : null
  ].filter(Boolean).join("\n");
}

export async function aiRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const activeGenerations = new Map<string, ActiveGeneration & {
    lockKey: string;
    lockToken: string;
    stopKey: string;
  }>();

  async function releaseGenerationLock(lockKey: string, lockToken: string) {
    if (await app.redis.get(lockKey) === lockToken) await app.redis.del(lockKey);
  }

  route.post("/conversations", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "创建 AI 会话", body: createConversationBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (request.body.clientApp !== expectedClientApp(user.clientType)) {
      throw new ForbiddenError("当前登录端不能创建其他来源的 AI 会话");
    }
    if (request.body.projectId) {
      const [project] = await app.db.select().from(projects).where(and(
        eq(projects.id, request.body.projectId), isNull(projects.deletedAt)
      )).limit(1);
      if (!project || !canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");
      if (request.body.scene === AI_SCENES.REPORT_GENERATE && !canManageProject(user, project)) {
        throw new ForbiddenError("只有项目创建者或超级管理员可以生成项目报告");
      }
    }

    const conversation = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiConversations).values({
        userId: user.id,
        projectId: request.body.projectId,
        clientApp: request.body.clientApp,
        scene: request.body.scene,
        title: request.body.title,
        reasoningMode: request.body.reasoningMode
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: request.body.projectId,
        action: AUDIT_ACTIONS.AI_CONVERSATION_CREATED,
        targetType: "ai_conversation", targetId: created!.id, afterJson: created
      });
      return created!;
    });
    return ok(request, { message: "AI 会话创建成功", conversation });
  });

  route.get("/conversations", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "获取我的 AI 会话列表", querystring: conversationListQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const keyword = request.query.keyword?.replace(/[\\%_]/g, (value) => `\\${value}`);
    const where = and(
      eq(aiConversations.userId, user.id),
      request.query.includeDeleted ? undefined : isNull(aiConversations.deletedAt),
      request.query.projectId ? eq(aiConversations.projectId, request.query.projectId) : undefined,
      request.query.clientApp ? eq(aiConversations.clientApp, request.query.clientApp) : undefined,
      request.query.pinned === undefined ? undefined : eq(aiConversations.isPinned, request.query.pinned),
      keyword ? or(ilike(aiConversations.title, `%${keyword}%`), ilike(projects.name, `%${keyword}%`)) : undefined
    );
    const [rows, [totalRow]] = await Promise.all([
      app.db.select({ conversation: aiConversations, project: { id: projects.id, name: projects.name } })
        .from(aiConversations)
        .leftJoin(projects, eq(projects.id, aiConversations.projectId))
        .where(where)
        .orderBy(desc(aiConversations.isPinned), desc(aiConversations.updatedAt))
        .offset(skip)
        .limit(take),
      app.db.select({ value: count() })
        .from(aiConversations)
        .leftJoin(projects, eq(projects.id, aiConversations.projectId))
        .where(where)
    ]);

    const conversationIds = rows.map((row) => row.conversation.id);
    const [messageStats, latestMessages] = conversationIds.length === 0
      ? [[], []]
      : await Promise.all([
        app.db.select({ conversationId: aiMessages.conversationId, messageCount: count() })
          .from(aiMessages)
          .where(inArray(aiMessages.conversationId, conversationIds))
          .groupBy(aiMessages.conversationId),
        app.db.select({
          id: aiMessages.id,
          conversationId: aiMessages.conversationId,
          role: aiMessages.role,
          status: aiMessages.status,
          content: aiMessages.content,
          createdAt: aiMessages.createdAt
        }).from(aiMessages)
          .where(and(
            inArray(aiMessages.conversationId, conversationIds),
            inArray(aiMessages.role, ["USER", "ASSISTANT"])
          ))
          .orderBy(desc(aiMessages.createdAt))
      ]);
    const statsMap = new Map(messageStats.map((item) => [item.conversationId, item.messageCount]));
    const latestMap = new Map<string, (typeof latestMessages)[number]>();
    for (const message of latestMessages) {
      if (!latestMap.has(message.conversationId)) latestMap.set(message.conversationId, message);
    }
    const items = rows.map(({ conversation, project }) => {
      const latest = latestMap.get(conversation.id);
      return {
        ...conversation,
        project: project?.id ? project : null,
        messageCount: statsMap.get(conversation.id) ?? 0,
        lastMessage: latest ? {
          id: latest.id,
          role: latest.role,
          status: latest.status,
          preview: latest.content.length > 160 ? `${latest.content.slice(0, 160)}...` : latest.content,
          createdAt: latest.createdAt
        } : null
      };
    });
    return ok(request, {
      items,
      total: totalRow?.value ?? 0,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.get("/conversations/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "获取 AI 会话和消息", params: conversationParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    const messages = await app.db.select().from(aiMessages)
      .where(eq(aiMessages.conversationId, conversation.id)).orderBy(aiMessages.createdAt);
    const assistantMessageIds = messages.filter((message) => message.role === "ASSISTANT").map((message) => message.id);
    const [retrievals, feedbacks, regenerations, conversationReports] = await Promise.all([
      app.db.select().from(aiRetrievalLogs).where(eq(aiRetrievalLogs.conversationId, conversation.id)).orderBy(asc(aiRetrievalLogs.createdAt)),
      app.db.select().from(aiMessageFeedbacks).where(eq(aiMessageFeedbacks.conversationId, conversation.id)).orderBy(desc(aiMessageFeedbacks.createdAt)),
      app.db.select().from(aiMessageRegenerations).where(eq(aiMessageRegenerations.conversationId, conversation.id)).orderBy(asc(aiMessageRegenerations.createdAt)),
      app.db.select().from(reports).where(and(eq(reports.conversationId, conversation.id), isNull(reports.deletedAt))).orderBy(desc(reports.createdAt))
    ]);
    const reportIds = conversationReports.map((report) => report.id);
    const artifactRows = reportIds.length === 0 ? [] : await app.db.select({ artifact: reportArtifacts, file: files })
      .from(reportArtifacts)
      .innerJoin(files, eq(files.id, reportArtifacts.fileId))
      .where(inArray(reportArtifacts.reportId, reportIds));
    const artifactIds = artifactRows.map((row) => row.artifact.id);
    const conversationShares = assistantMessageIds.length === 0 ? [] : await app.db.select().from(shareLinks)
      .where(and(eq(shareLinks.targetType, SHARE_TARGET_TYPES.AI_MESSAGES), inArray(shareLinks.targetId, assistantMessageIds)));
    const reportShareRows = reportIds.length === 0 ? [] : await app.db.select().from(shareLinks)
      .where(and(
        inArray(shareLinks.targetType, [SHARE_TARGET_TYPES.REPORT, SHARE_TARGET_TYPES.REPORT_ARTIFACT]),
        inArray(shareLinks.targetId, [...reportIds, ...artifactIds])
      ));
    const reportSourcesRows = reportIds.length === 0 ? [] : await app.db.select().from(reportSources)
      .where(inArray(reportSources.reportId, reportIds)).orderBy(asc(reportSources.sortOrder));
    const reportItems = conversationReports.map((report) => ({
      ...report,
      artifacts: artifactRows.filter((row) => row.artifact.reportId === report.id).map((row) => ({
        ...row.artifact,
        file: { id: row.file.id, originalName: row.file.originalName, mimeType: row.file.mimeType, sizeBytes: row.file.sizeBytes, status: row.file.status }
      })),
      sources: reportSourcesRows.filter((source) => source.reportId === report.id)
    }));
    const visibleMessages = messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      userId: message.userId,
      role: message.role,
      status: message.status,
      content: message.content,
      reasoningMode: message.reasoningMode,
      model: message.model,
      durationMs: message.durationMs,
      startedAt: message.startedAt,
      finishedAt: message.finishedAt,
      stopReason: message.stopReason,
      createdAt: message.createdAt
    }));
    return ok(request, {
      conversation,
      messages: visibleMessages,
      processingSummary: {
        stages: [
          { stage: "analyzing", message: conversation.projectId ? "正在分析项目资料..." : "正在分析问题..." },
          ...(conversation.projectId ? [{ stage: "checking", message: "正在核对标准和计算结果..." }] : []),
          { stage: "composing", message: "正在整理回答..." }
        ],
        note: "这里展示回答依据和处理阶段，不展示模型原始思考链。"
      },
      retrievals,
      feedbacks,
      regenerations,
      reports: reportItems,
      shareLinks: [...conversationShares, ...reportShareRows]
    });
  });

  route.patch("/conversations/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "重命名 AI 会话",
      params: conversationParamsSchema,
      body: conversationUpdateBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ title: request.body.title, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_RENAMED,
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { title: conversation.title }, afterJson: { title: row!.title }
      });
      return row!;
    });
    return ok(request, { message: "AI 会话重命名成功", conversation: updated });
  });

  route.put("/conversations/:id/pin", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "置顶或取消置顶 AI 会话",
      params: conversationParamsSchema,
      body: pinBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ isPinned: request.body.pinned, pinnedAt: request.body.pinned ? new Date() : null, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_PINNED,
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { isPinned: conversation.isPinned }, afterJson: { isPinned: row!.isPinned }
      });
      return row!;
    });
    return ok(request, { message: request.body.pinned ? "AI 会话已置顶" : "AI 会话已取消置顶", conversation: updated });
  });

  route.patch("/conversations/:id/project", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "移动 AI 会话到项目",
      params: conversationParamsSchema,
      body: moveProjectBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    let targetProject: typeof projects.$inferSelect | undefined;
    if (request.body.projectId) {
      const [project] = await app.db.select().from(projects).where(and(
        eq(projects.id, request.body.projectId), isNull(projects.deletedAt)
      )).limit(1);
      if (!project) throw new NotFoundError("目标项目不存在");
      if (!canManageProject(user, project)) throw new ForbiddenError("只能移动到自己可管理的项目");
      targetProject = project;
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ projectId: request.body.projectId, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: request.body.projectId ?? conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_MOVED,
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { projectId: conversation.projectId },
        afterJson: { projectId: row!.projectId, projectName: targetProject?.name ?? null }
      });
      return row!;
    });
    return ok(request, { message: request.body.projectId ? "AI 会话已移动到项目" : "AI 会话已移出项目", conversation: updated });
  });

  route.delete("/conversations/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "删除 AI 会话", params: conversationParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    const [activeMessage] = await app.db.select({ id: aiMessages.id }).from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, conversation.id),
        inArray(aiMessages.status, ["PENDING", "STREAMING"])
      )).limit(1);
    if (activeMessage) throw new ConflictError("请先停止正在生成的 AI 回答，再删除会话");
    const deletedAt = new Date();
    await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations).set({
        status: "deleted", deletedAt, isPinned: false, updatedAt: deletedAt
      }).where(and(eq(aiConversations.id, conversation.id), eq(aiConversations.status, "active"))).returning();
      if (!row) throw new NotFoundError("AI 会话不存在或已经删除");
      const candidateShares = await tx.select({ id: shareLinks.id, snapshotJson: shareLinks.snapshotJson })
        .from(shareLinks).where(and(
          eq(shareLinks.targetType, SHARE_TARGET_TYPES.AI_MESSAGES),
          eq(shareLinks.enabled, true)
        ));
      const shareIds = candidateShares
        .filter((share) => share.snapshotJson.conversationId === conversation.id)
        .map((share) => share.id);
      if (shareIds.length > 0) {
        await tx.update(shareLinks).set({ enabled: false, updatedAt: deletedAt })
          .where(inArray(shareLinks.id, shareIds));
        for (const shareId of shareIds) {
          await writeAuditLog({
            db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
            action: AUDIT_ACTIONS.SHARE_LINK_DISABLED,
            targetType: "share_link", targetId: shareId,
            afterJson: { reason: "conversation_deleted" }
          });
        }
      }
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_DELETED,
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: conversation, afterJson: { status: "deleted", deletedAt }
      });
    });
    return ok(request, { message: "AI 会话已删除" });
  });

  route.post("/conversations/:id/restore", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "恢复 AI 会话", params: conversationParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversationById(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    if (conversation.status !== "deleted" || !conversation.deletedAt) {
      throw new ConflictError("AI 会话当前不需要恢复");
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations).set({
        status: "active", deletedAt: null, updatedAt: new Date()
      }).where(eq(aiConversations.id, conversation.id)).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_RESTORED,
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { status: conversation.status, deletedAt: conversation.deletedAt },
        afterJson: { status: row!.status, deletedAt: row!.deletedAt }
      });
      return row!;
    });
    return ok(request, { message: "AI 会话已恢复", conversation: updated });
  });

  route.patch("/conversations/:id/settings", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "修改当前 AI 会话设置",
      params: conversationParamsSchema,
      body: conversationSettingsBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);

    const resolved = await resolveSceneRuntime(app.db, conversation.scene, request.body.reasoningMode);
    void resolved;

    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ reasoningMode: request.body.reasoningMode, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx,
        request,
        actor: user,
        projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_CONVERSATION_REASONING_CHANGED,
        targetType: "ai_conversation",
        targetId: conversation.id,
        beforeJson: { reasoningMode: conversation.reasoningMode },
        afterJson: { reasoningMode: row!.reasoningMode }
      });
      return row!;
    });
    return ok(request, { message: "AI 会话深度思考设置已更新", conversation: updated });
  });

  route.post("/conversations/:id/messages", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "发送消息并以 SSE 接收 AI 回复",
      params: conversationParamsSchema,
      body: sendMessageBodySchema
    }
  }, async (request, reply) => {
    const startedAt = Date.now();
    const requestId = request.id;
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    await enforceAiRateLimit(app, user.id);

    // 敏感词围栏：命中即拦截（不发模型请求），用户消息落库 BLOCKED 并审计
    const blocked = await checkContentFiltered(app.db, conversation.scene, request.body.content);
    if (blocked) {
      await app.db.transaction(async (tx) => {
        const [blockedRow] = await tx.insert(aiMessages).values({
          conversationId: conversation.id,
          userId: user.id,
          role: "USER",
          content: request.body.content,
          status: "BLOCKED",
          reasoningMode: conversation.reasoningMode,
          requestId,
          metadata: {
            blockedFilterId: blocked.filterId,
            blockedKeyword: blocked.keyword,
            blockedMatchType: blocked.matchType,
            blockedMatchedText: blocked.matchedText
          }
        }).returning();
        await writeAuditLog({
          db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
          action: AUDIT_ACTIONS.AI_MESSAGE_BLOCKED, targetType: "ai_message", targetId: blockedRow!.id,
          afterJson: {
            filterId: blocked.filterId,
            keyword: blocked.keyword,
            matchType: blocked.matchType,
            matchedText: blocked.matchedText
          }
        });
      });
      throw new AiError("AI_CONTENT_BLOCKED", blocked.hitMessage?.trim() || undefined);
    }

    await enforceAiQuota(app, user);

    if (conversation.projectId) {
      const [project] = await app.db.select().from(projects).where(and(
        eq(projects.id, conversation.projectId), isNull(projects.deletedAt)
      )).limit(1);
      if (!project || !canViewProject(user, project)) throw new NotFoundError("关联项目不存在或无权查看");
    }

    const [activeMessage] = await app.db.select({ id: aiMessages.id }).from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, conversation.id),
        inArray(aiMessages.status, ["PENDING", "STREAMING"])
      )).limit(1);
    if (activeMessage) throw new ConflictError("当前会话已有正在生成的 AI 回答");

    const lockKey = `ai:conversation:${conversation.id}:generation`;
    const lockToken = randomUUID();
    if (await app.redis.set(lockKey, lockToken, "EX", 900, "NX") !== "OK") {
      throw new ConflictError("当前会话已有正在生成的 AI 回答");
    }

    let runtime: SceneRuntime;
    try {
      runtime = await resolveSceneRuntime(app.db, conversation.scene, conversation.reasoningMode);
    } catch (error) {
      await releaseGenerationLock(lockKey, lockToken);
      throw error;
    }

    const [userMessage, assistantMessage] = await app.db.transaction(async (tx) => {
      const [userRow] = await tx.insert(aiMessages).values({
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: request.body.content,
        status: "COMPLETED",
        reasoningMode: conversation.reasoningMode,
        requestId
      }).returning();
      const [assistantRow] = await tx.insert(aiMessages).values({
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "",
        status: "PENDING",
        reasoningMode: conversation.reasoningMode,
        providerId: runtime.primary.providerId,
        provider: runtime.primary.providerName,
        modelId: runtime.primary.modelRef.id,
        model: runtime.primary.modelId,
        promptVersionId: runtime.promptVersionId,
        promptTemplateVersion: runtime.promptVersionNumber,
        requestId,
        metadata: { reasoningMode: conversation.reasoningMode, reasoning: runtime.reasoning }
      }).returning();
      return [userRow!, assistantRow!];
    });

    // 知识检索门控：仅场景允许检索且关联项目时执行；general_chat 默认不检索
    const chunks = runtime.allowKnowledgeSearch && conversation.projectId
      ? await searchProjectKnowledge(app, conversation.projectId, request.body.content)
      : [];
    if (chunks.length > 0) {
      await app.db.insert(aiRetrievalLogs).values(chunks.map((chunk) => ({
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        documentId: chunk.documentId,
        chunkId: chunk.chunkId,
        score: chunk.score,
        sourcePage: chunk.sourcePage,
        sourceTitle: chunk.sourceTitle
      })));
    }

    const projectContext = runtime.requireProject ? await resolveProjectContext(app, conversation.projectId) : null;
    const systemMessages = buildSystemMessages({
      scenePrompt: runtime.promptContent,
      projectContext,
      knowledgeContext: chunks.length > 0 ? formatKnowledgeContext(chunks) : null
    });
    const system = systemMessages.map((message) => message.content).join("\n\n");

    const historyRows = await app.db.select({ role: aiMessages.role, content: aiMessages.content, id: aiMessages.id })
      .from(aiMessages).where(and(
        eq(aiMessages.conversationId, conversation.id),
        inArray(aiMessages.status, ["COMPLETED", "STOPPED"]),
        notInArray(aiMessages.id, [userMessage.id, assistantMessage.id])
      )).orderBy(desc(aiMessages.createdAt)).limit(200);
    const historyMessages: ContextMessage[] = historyRows.reverse()
      .filter((message) => (message.role === "USER" || message.role === "ASSISTANT")
        && message.id !== userMessage.id && message.id !== assistantMessage.id)
      .map((message) => ({
        role: message.role === "USER" ? "user" as const : "assistant" as const,
        content: message.content
      }));
    const budgeted = budgetHistory({
      history: historyMessages,
      systemTokens: estimateTokens(system),
      userMessageTokens: estimateTokens(request.body.content),
      contextWindow: runtime.primary.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens
    });
    const messages: ModelMessage[] = [...budgeted, { role: "user", content: request.body.content }];

    const stopKey = `ai:message:${assistantMessage.id}:stop`;
    const generation: ActiveGeneration & { lockKey: string; lockToken: string; stopKey: string } = {
      controller: new AbortController(),
      conversationId: conversation.id,
      userId: user.id,
      stopRequested: false,
      lockKey,
      lockToken,
      stopKey
    };
    activeGenerations.set(assistantMessage.id, generation);
    let streamFinished = false;
    const onClientClose = () => {
      if (!streamFinished && !generation.stopRequested) {
        generation.stopRequested = true;
        generation.stopReason = "CLIENT_DISCONNECTED";
        generation.controller.abort();
      }
    };

    startSseStream(reply, request.id);
    writeSse(reply, "message", { messageId: assistantMessage.id, conversationId: conversation.id, requestId });
    writeProgress(reply, "analyzing", conversation.projectId ? "正在分析项目资料..." : "正在分析问题...");
    request.raw.once("close", onClientClose);
    await app.db.update(aiMessages).set({ status: "STREAMING", startedAt: new Date() }).where(eq(aiMessages.id, assistantMessage.id));
    // checking 阶段仅在真实执行知识检索时发送，不伪造“检索/计算”进度
    if (chunks.length > 0) {
      writeProgress(reply, "checking", "正在核对检索资料和计算结果...");
    }
    writeProgress(reply, "composing", "正在整理回答...");

    let fullText = "";
    let streamUsage: LanguageModelUsage | undefined;
    let usedFallback = false;
    let originalFailedModel: string | null = null;

    const streamBody = async (modelConfig: typeof runtime.primary) => {
      const result = streamText({
        model: modelConfig.languageModel,
        system,
        messages,
        maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? undefined,
        temperature: runtime.sceneTemperature ?? runtime.primary.defaultTemperature ?? undefined,
        timeout: modelConfig.timeoutMs,
        abortSignal: generation.controller.signal,
        providerOptions: runtime.providerOptions
      });
      let text = "";
      for await (const delta of result.textStream) {
        if (await app.redis.exists(stopKey) === 1) {
          generation.stopRequested = true;
          generation.stopReason = "USER";
          generation.controller.abort();
          const stopError = new Error("AI 回答已请求停止");
          stopError.name = "AbortError";
          throw stopError;
        }
        text += delta;
        fullText += delta;
        writeSse(reply, "delta", { text: delta });
      }
      streamUsage = await result.usage;
      return text;
    };

    try {
      await streamBody(runtime.primary);
    } catch (error) {
      // 仅在未产出任何内容、非用户停止且配置了备用模型时重试一次
      if (isAbortError(error) || generation.stopRequested || fullText !== "" || !runtime.fallback) {
        throw error;
      }
      originalFailedModel = runtime.primary.modelId;
      request.log.warn({ messageId: assistantMessage.id, originalFailedModel, fallbackModel: runtime.fallback.modelId }, "主模型调用失败，尝试备用模型");
      await streamBody(runtime.fallback);
      usedFallback = true;
    }

    const actualModelId = usedFallback ? runtime.fallback!.modelId : runtime.primary.modelId;
    try {
      if (chunks.length > 0 && !/\[资料\d+\]/.test(fullText)) {
        const citationNotice = `\n\n参考来源：${chunks.map((chunk, index) => `[资料${index + 1}] ${chunk.sourceTitle}${chunk.sourcePage ? `第 ${chunk.sourcePage} 页` : ""}`).join("；")}`;
        fullText += citationNotice;
        writeSse(reply, "delta", { text: citationNotice });
      }
      if (await app.redis.exists(stopKey) === 1) {
        generation.stopRequested = true;
        generation.stopReason = "USER";
        const stopError = new Error("AI 回答已请求停止");
        stopError.name = "AbortError";
        throw stopError;
      }

      const metadata = {
        reasoningMode: conversation.reasoningMode,
        reasoning: runtime.reasoning,
        ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
      };
      await app.db.transaction(async (tx) => {
      await tx.update(aiMessages).set({
        content: fullText,
        status: "COMPLETED",
        tokenInput: streamUsage?.inputTokens,
        tokenOutput: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        metadata
      }).where(eq(aiMessages.id, assistantMessage.id));
      await tx.update(aiConversations)
        .set({ updatedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(aiConversations.id, conversation.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_MESSAGE_SENT, targetType: "ai_message", targetId: userMessage.id,
        afterJson: {
          assistantMessageId: assistantMessage.id,
          model: actualModelId,
          retrievalCount: chunks.length,
          fallbackUsed: usedFallback
        }
      });
    });
    // 首条用户消息回答完成后异步生成会话标题（仅未命名会话，Worker 内再做条件写入）
    if (conversation.title == null) {
      const [userMessageCount] = await app.db.select({ value: count() }).from(aiMessages)
        .where(and(eq(aiMessages.conversationId, conversation.id), eq(aiMessages.role, "USER")));
      if ((userMessageCount?.value ?? 0) === 1) {
        await app.queues.aiTitleGeneration.add("conversation_title", { conversationId: conversation.id });
      }
    }
    streamFinished = true;
    writeProgress(reply, "completed", "回答整理完成");
    writeSse(reply, "done", {
      messageId: assistantMessage.id,
      conversationId: conversation.id,
      finishReason: "COMPLETED",
      usage: {
        inputTokens: streamUsage?.inputTokens,
        outputTokens: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens
      },
      model: { id: actualModelId },
      promptVersion: { id: runtime.promptVersionId, version: runtime.promptVersionNumber },
      sources: chunks.map((chunk) => ({ title: chunk.sourceTitle, page: chunk.sourcePage })),
      latencyMs: Date.now() - startedAt
    });
    } catch (error) {
    const stopRequested = generation.stopRequested || (await app.redis.exists(stopKey).catch(() => 0)) === 1 || isAbortError(error);
    if (stopRequested) {
      request.log.info({ messageId: assistantMessage.id }, "AI 回答已停止");
      await app.db.transaction(async (tx) => {
        await tx.update(aiMessages).set({
          content: fullText,
          status: "STOPPED",
          stopReason: generation.stopReason ?? "USER",
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
          metadata: {
            reasoningMode: conversation.reasoningMode,
            reasoning: runtime.reasoning,
            ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
          }
        }).where(eq(aiMessages.id, assistantMessage.id));
        await tx.update(aiConversations)
          .set({ updatedAt: new Date(), lastMessageAt: new Date() })
          .where(eq(aiConversations.id, conversation.id));
        await writeAuditLog({
          db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
          action: AUDIT_ACTIONS.AI_MESSAGE_STOPPED,
          targetType: "ai_message",
          targetId: assistantMessage.id,
          afterJson: { stopReason: generation.stopReason ?? "USER", contentLength: fullText.length }
        });
      });
      writeSse(reply, "stopped", {
        messageId: assistantMessage.id,
        partialContent: fullText,
        content: fullText,
        usage: streamUsage ? {
          inputTokens: streamUsage.inputTokens,
          outputTokens: streamUsage.outputTokens,
          reasoningTokens: streamUsage.outputTokenDetails.reasoningTokens
        } : undefined
      });
    } else {
      const aiError = error instanceof AiError ? error : toAiError(error);
      request.log.error({ err: error, requestId }, "AI 回复生成失败");
      await app.db.update(aiMessages).set({
        content: fullText,
        status: "FAILED",
        errorMessage: aiError.message,
        errorCode: aiError.code,
        requestId,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date()
      }).where(eq(aiMessages.id, assistantMessage.id));
      writeSse(reply, "error", {
        code: aiError.code,
        message: aiError.message,
        requestId,
        retryable: aiError.retryable
      });
    }
  } finally {
    streamFinished = true;
    request.raw.off("close", onClientClose);
    activeGenerations.delete(assistantMessage.id);
    await releaseGenerationLock(lockKey, lockToken);
    await app.redis.del(stopKey);
    await releaseAiConcurrency(app, user.id);
    reply.raw.end();
  }
  });

  route.post("/messages/:id/stop", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "停止正在生成的 AI 回答",
      params: messageParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await findAssistantMessageWithConversation(app, request.params.id);
    if (!row) throw new NotFoundError("AI 回答不存在");
    ensureConversationOwner(user, row.conversation);
    if (row.message.status !== "PENDING" && row.message.status !== "STREAMING") {
      throw new ConflictError("当前 AI 回答不在生成中");
    }

    const stopKey = `ai:message:${row.message.id}:stop`;
    await app.redis.set(stopKey, "USER", "EX", 900);
    const generation = activeGenerations.get(row.message.id);
    if (generation) {
      generation.stopRequested = true;
      generation.stopReason = "USER";
      generation.controller.abort();
    }
    return ok(request, { message: "已请求停止 AI 回答", messageId: row.message.id, status: "STOPPING" });
  });

  route.put("/messages/:id/feedback", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "提交或更新 AI 回答点赞反馈",
      params: messageParamsSchema,
      body: feedbackBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await findAssistantMessageWithConversation(app, request.params.id);
    if (!row) throw new NotFoundError("AI 回答不存在");
    ensureConversationOwner(user, row.conversation);
    if (row.message.status !== "COMPLETED") throw new ForbiddenError("只有已完成的 AI 回答可以反馈");

    const feedback = await app.db.transaction(async (tx) => {
      const [saved] = await tx.insert(aiMessageFeedbacks).values({
        messageId: row.message.id,
        conversationId: row.conversation.id,
        projectId: row.conversation.projectId,
        userId: user.id,
        reaction: request.body.reaction ?? null,
        reasonCode: request.body.reasonCode,
        tags: request.body.tags,
        content: request.body.content ?? null,
        clientApp: request.body.clientApp ?? row.conversation.clientApp
      }).onConflictDoUpdate({
        target: [aiMessageFeedbacks.messageId, aiMessageFeedbacks.userId],
        set: {
          reaction: request.body.reaction ?? null,
          reasonCode: request.body.reasonCode,
          tags: request.body.tags,
          content: request.body.content ?? null,
          clientApp: request.body.clientApp ?? row.conversation.clientApp,
          updatedAt: new Date()
        }
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_MESSAGE_FEEDBACK_UPSERTED,
        targetType: "ai_message", targetId: row.message.id,
        afterJson: {
          feedbackId: saved!.id,
          reaction: saved!.reaction,
          tags: saved!.tags,
          hasContent: Boolean(saved!.content)
        }
      });
      return saved!;
    });

    return ok(request, { message: "AI 回答反馈已保存", feedback });
  });

  route.post("/messages/:id/regenerate", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "重新生成一条 AI 回答并通过 SSE 返回",
      params: messageParamsSchema,
      body: regenerateBodySchema
    }
  }, async (request, reply) => {
    const startedAt = Date.now();
    const requestId = request.id;
    const user = getCurrentUser(request);
    const row = await findAssistantMessageWithConversation(app, request.params.id);
    if (!row) throw new NotFoundError("AI 回答不存在");
    ensureConversationOwner(user, row.conversation);
    await enforceAiRateLimit(app, user.id);
    await enforceAiQuota(app, user);

    if (row.conversation.projectId) {
      const [project] = await app.db.select().from(projects).where(and(
        eq(projects.id, row.conversation.projectId), isNull(projects.deletedAt)
      )).limit(1);
      if (!project || !canViewProject(user, project)) throw new NotFoundError("关联项目不存在或无权查看");
    }

    const [activeMessage] = await app.db.select({ id: aiMessages.id }).from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, row.conversation.id),
        inArray(aiMessages.status, ["PENDING", "STREAMING"])
      )).limit(1);
    if (activeMessage) throw new ConflictError("当前会话已有正在生成的 AI 回答");
    const lockKey = `ai:conversation:${row.conversation.id}:generation`;
    const lockToken = randomUUID();
    if (await app.redis.set(lockKey, lockToken, "EX", 900, "NX") !== "OK") {
      throw new ConflictError("当前会话已有正在生成的 AI 回答");
    }

    const [lastUserMessage] = await app.db.select().from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, row.conversation.id),
        eq(aiMessages.role, "USER"),
        eq(aiMessages.status, "COMPLETED"),
        lt(aiMessages.createdAt, row.message.createdAt)
      ))
      .orderBy(desc(aiMessages.createdAt))
      .limit(1);
    if (!lastUserMessage) {
      await releaseGenerationLock(lockKey, lockToken);
      throw new NotFoundError("未找到可用于重新生成的用户问题");
    }

    let runtime: SceneRuntime;
    try {
      runtime = await resolveSceneRuntime(app.db, row.conversation.scene, row.conversation.reasoningMode);
    } catch (error) {
      await releaseGenerationLock(lockKey, lockToken);
      throw error;
    }
    const [assistantMessage] = await app.db.insert(aiMessages).values({
      conversationId: row.conversation.id,
      role: "ASSISTANT",
      content: "",
      status: "PENDING",
      reasoningMode: row.conversation.reasoningMode,
      providerId: runtime.primary.providerId,
      provider: runtime.primary.providerName,
      modelId: runtime.primary.modelRef.id,
      model: runtime.primary.modelId,
      promptVersionId: runtime.promptVersionId,
      promptTemplateVersion: runtime.promptVersionNumber,
      requestId,
      metadata: {
        type: "regeneration",
        originalMessageId: row.message.id,
        reasoningMode: row.conversation.reasoningMode,
        reasoning: runtime.reasoning
      }
    }).returning();
    if (!assistantMessage) throw new Error("AI 消息创建失败");

    const chunks = runtime.allowKnowledgeSearch && row.conversation.projectId
      ? await searchProjectKnowledge(app, row.conversation.projectId, lastUserMessage.content)
      : [];
    if (chunks.length > 0) {
      await app.db.insert(aiRetrievalLogs).values(chunks.map((chunk) => ({
        conversationId: row.conversation.id,
        messageId: assistantMessage.id,
        documentId: chunk.documentId,
        chunkId: chunk.chunkId,
        score: chunk.score,
        sourcePage: chunk.sourcePage,
        sourceTitle: chunk.sourceTitle
      })));
    }

    const projectContext = runtime.requireProject ? await resolveProjectContext(app, row.conversation.projectId) : null;
    const systemMessages = buildSystemMessages({
      scenePrompt: runtime.promptContent,
      projectContext,
      knowledgeContext: chunks.length > 0 ? formatKnowledgeContext(chunks) : null
    });
    const system = systemMessages.map((message) => message.content).join("\n\n");

    const historyRows = await app.db.select({ role: aiMessages.role, content: aiMessages.content, id: aiMessages.id })
      .from(aiMessages).where(and(
        eq(aiMessages.conversationId, row.conversation.id),
        inArray(aiMessages.status, ["COMPLETED", "STOPPED"]),
        lt(aiMessages.createdAt, row.message.createdAt)
      )).orderBy(desc(aiMessages.createdAt)).limit(200);
    const historyMessages: ContextMessage[] = historyRows.reverse()
      .filter((message) => (message.role === "USER" || message.role === "ASSISTANT")
        && message.id !== row.message.id && message.id !== assistantMessage.id)
      .map((message) => ({
        role: message.role === "USER" ? "user" as const : "assistant" as const,
        content: message.content
      }));
    const budgeted = budgetHistory({
      history: historyMessages,
      systemTokens: estimateTokens(system),
      userMessageTokens: estimateTokens(lastUserMessage.content),
      contextWindow: runtime.primary.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens
    });
    const messages: ModelMessage[] = [...budgeted, { role: "user", content: lastUserMessage.content }];

    const stopKey = `ai:message:${assistantMessage.id}:stop`;
    const generation: ActiveGeneration & { lockKey: string; lockToken: string; stopKey: string } = {
      controller: new AbortController(),
      conversationId: row.conversation.id,
      userId: user.id,
      stopRequested: false,
      lockKey,
      lockToken,
      stopKey
    };
    activeGenerations.set(assistantMessage.id, generation);
    let streamFinished = false;
    const onClientClose = () => {
      if (!streamFinished && !generation.stopRequested) {
        generation.stopRequested = true;
        generation.stopReason = "CLIENT_DISCONNECTED";
        generation.controller.abort();
      }
    };

    startSseStream(reply, request.id);
    writeSse(reply, "message", {
      messageId: assistantMessage.id,
      conversationId: row.conversation.id,
      originalMessageId: row.message.id,
      requestId
    });
    writeProgress(reply, "analyzing", row.conversation.projectId ? "正在分析项目资料..." : "正在分析问题...");
    request.raw.once("close", onClientClose);
    await app.db.update(aiMessages).set({ status: "STREAMING", startedAt: new Date() }).where(eq(aiMessages.id, assistantMessage.id));
    if (chunks.length > 0) {
      writeProgress(reply, "checking", "正在核对检索资料和计算结果...");
    }
    writeProgress(reply, "composing", "正在整理回答...");

    let fullText = "";
    let streamUsage: LanguageModelUsage | undefined;
    let usedFallback = false;
    let originalFailedModel: string | null = null;

    const streamBody = async (modelConfig: typeof runtime.primary) => {
      const result = streamText({
        model: modelConfig.languageModel,
        system,
        messages,
        maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? undefined,
        temperature: runtime.sceneTemperature ?? runtime.primary.defaultTemperature ?? undefined,
        timeout: modelConfig.timeoutMs,
        abortSignal: generation.controller.signal,
        providerOptions: runtime.providerOptions
      });
      let text = "";
      for await (const delta of result.textStream) {
        if (await app.redis.exists(stopKey) === 1) {
          generation.stopRequested = true;
          generation.stopReason = "USER";
          generation.controller.abort();
          const stopError = new Error("AI 回答已请求停止");
          stopError.name = "AbortError";
          throw stopError;
        }
        text += delta;
        fullText += delta;
        writeSse(reply, "delta", { text: delta });
      }
      streamUsage = await result.usage;
      return text;
    };

    try {
      await streamBody(runtime.primary);
    } catch (error) {
      if (isAbortError(error) || generation.stopRequested || fullText !== "" || !runtime.fallback) {
        throw error;
      }
      originalFailedModel = runtime.primary.modelId;
      request.log.warn({ messageId: assistantMessage.id, originalFailedModel, fallbackModel: runtime.fallback.modelId }, "主模型调用失败，尝试备用模型");
      await streamBody(runtime.fallback);
      usedFallback = true;
    }

    const actualModelId = usedFallback ? runtime.fallback!.modelId : runtime.primary.modelId;
    try {
      if (chunks.length > 0 && !/\[资料\d+\]/.test(fullText)) {
        const citationNotice = `\n\n参考来源：${chunks.map((chunk, index) => `[资料${index + 1}] ${chunk.sourceTitle}${chunk.sourcePage ? `第 ${chunk.sourcePage} 页` : ""}`).join("；")}`;
        fullText += citationNotice;
        writeSse(reply, "delta", { text: citationNotice });
      }
      if (await app.redis.exists(stopKey) === 1) {
        generation.stopRequested = true;
        generation.stopReason = "USER";
        const stopError = new Error("AI 回答已请求停止");
        stopError.name = "AbortError";
        throw stopError;
      }

      const metadata = {
        type: "regeneration",
        originalMessageId: row.message.id,
        reasoningMode: row.conversation.reasoningMode,
        reasoning: runtime.reasoning,
        ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
      };
      await app.db.transaction(async (tx) => {
      await tx.update(aiMessages).set({
        content: fullText,
        status: "COMPLETED",
        tokenInput: streamUsage?.inputTokens,
        tokenOutput: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        metadata
      }).where(eq(aiMessages.id, assistantMessage.id));
      await tx.insert(aiMessageRegenerations).values({
        conversationId: row.conversation.id,
        originalMessageId: row.message.id,
        regeneratedMessageId: assistantMessage.id,
        userId: user.id,
        reason: request.body.reason
      });
      await tx.update(aiConversations)
        .set({ updatedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(aiConversations.id, row.conversation.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_MESSAGE_REGENERATED,
        targetType: "ai_message",
        targetId: assistantMessage.id,
        afterJson: {
          originalMessageId: row.message.id,
          model: actualModelId,
          retrievalCount: chunks.length,
          fallbackUsed: usedFallback
        }
      });
    });
    streamFinished = true;
    writeProgress(reply, "completed", "回答整理完成");
    writeSse(reply, "done", {
      messageId: assistantMessage.id,
      originalMessageId: row.message.id,
      conversationId: row.conversation.id,
      finishReason: "COMPLETED",
      usage: {
        inputTokens: streamUsage?.inputTokens,
        outputTokens: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens
      },
      model: { id: actualModelId },
      promptVersion: { id: runtime.promptVersionId, version: runtime.promptVersionNumber },
      sources: chunks.map((chunk) => ({ title: chunk.sourceTitle, page: chunk.sourcePage })),
      latencyMs: Date.now() - startedAt
    });
    } catch (error) {
    const stopRequested = generation.stopRequested || (await app.redis.exists(stopKey).catch(() => 0)) === 1 || isAbortError(error);
    if (stopRequested) {
      request.log.info({ messageId: assistantMessage.id }, "AI 重新生成已停止");
      await app.db.transaction(async (tx) => {
        await tx.update(aiMessages).set({
          content: fullText,
          status: "STOPPED",
          stopReason: generation.stopReason ?? "USER",
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
          metadata: {
            type: "regeneration",
            originalMessageId: row.message.id,
            reasoningMode: row.conversation.reasoningMode,
            reasoning: runtime.reasoning,
            ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
          }
        }).where(eq(aiMessages.id, assistantMessage.id));
        await tx.insert(aiMessageRegenerations).values({
          conversationId: row.conversation.id,
          originalMessageId: row.message.id,
          regeneratedMessageId: assistantMessage.id,
          userId: user.id,
          reason: request.body.reason
        });
        await tx.update(aiConversations)
          .set({ updatedAt: new Date(), lastMessageAt: new Date() })
          .where(eq(aiConversations.id, row.conversation.id));
        await writeAuditLog({
          db: tx, request, actor: user, projectId: row.conversation.projectId ?? undefined,
          action: AUDIT_ACTIONS.AI_MESSAGE_STOPPED,
          targetType: "ai_message",
          targetId: assistantMessage.id,
          afterJson: { stopReason: generation.stopReason ?? "USER", contentLength: fullText.length }
        });
      });
      writeSse(reply, "stopped", {
        messageId: assistantMessage.id,
        partialContent: fullText,
        content: fullText,
        usage: streamUsage ? {
          inputTokens: streamUsage.inputTokens,
          outputTokens: streamUsage.outputTokens,
          reasoningTokens: streamUsage.outputTokenDetails.reasoningTokens
        } : undefined
      });
    } else {
      const aiError = error instanceof AiError ? error : toAiError(error);
      request.log.error({ err: error, requestId }, "AI 重新生成失败");
      await app.db.update(aiMessages).set({
        content: fullText,
        status: "FAILED",
        errorMessage: aiError.message,
        errorCode: aiError.code,
        requestId,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date()
      }).where(eq(aiMessages.id, assistantMessage.id));
      writeSse(reply, "error", {
        code: aiError.code,
        message: aiError.message,
        requestId,
        retryable: aiError.retryable
      });
    }
  } finally {
    streamFinished = true;
    request.raw.off("close", onClientClose);
    activeGenerations.delete(assistantMessage.id);
    await releaseGenerationLock(lockKey, lockToken);
    await app.redis.del(stopKey);
    await releaseAiConcurrency(app, user.id);
    reply.raw.end();
  }
  });

  route.post("/conversations/:id/report-draft", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "根据 AI 会话生成结构化报告草稿",
      params: conversationParamsSchema,
      body: reportDraftBodySchema
    }
  }, async (request) => {
    const startedAt = Date.now();
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    if (!conversation.projectId) throw new ForbiddenError("生成项目报告前必须先关联项目");
    const [project] = await app.db.select().from(projects).where(and(
      eq(projects.id, conversation.projectId), isNull(projects.deletedAt)
    )).limit(1);
    if (!project || !canManageProject(user, project)) throw new NotFoundError("项目不存在或无权生成报告");
    await enforceAiRateLimit(app, user.id);

    const runtime = await resolveSceneRuntime(app.db, AI_SCENES.REPORT_GENERATE, "OFF");
    const history = await app.db.select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages).where(and(
        eq(aiMessages.conversationId, conversation.id),
        eq(aiMessages.status, "COMPLETED")
      )).orderBy(desc(aiMessages.createdAt)).limit(30);
    const knowledge = await searchProjectKnowledge(
      app,
      project.id,
      request.body.requirements ?? history.map((item) => item.content).join(" ").slice(0, 500)
    );
    const context = formatKnowledgeContext(knowledge);
    const systemMessages = buildSystemMessages({ scenePrompt: runtime.promptContent, projectContext: null, knowledgeContext: context });
    const system = `${systemMessages.map((message) => message.content).join("\n\n")}\n\n请生成结构化中文报告草稿。所有技术结论必须来自提供的资料或明确标注“待专业人员复核”。`;
    const result = await generateObject({
      model: runtime.primary.languageModel,
      schema: reportDraftOutputSchema,
      system,
      prompt: `项目：${project.name}\n地区：${project.region ?? "未填写"}\n建筑类型：${project.buildingType ?? "未填写"}\n报告类型：${request.body.reportType}\n补充要求：${request.body.requirements ?? "无"}\n\n会话摘要材料：\n${history.reverse().map((item) => `${item.role}：${item.content}`).join("\n").slice(0, 12000)}\n\n${context}`,
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? 4000,
      temperature: runtime.sceneTemperature ?? runtime.primary.defaultTemperature ?? 0.2,
      abortSignal: AbortSignal.timeout(runtime.primary.timeoutMs)
    });
    const usage = result.usage;

    const saved = await app.db.transaction(async (tx) => {
      const [message] = await tx.insert(aiMessages).values({
        conversationId: conversation.id,
        role: "ASSISTANT",
        status: "COMPLETED",
        content: JSON.stringify(result.object),
        providerId: runtime.primary.providerId,
        provider: runtime.primary.providerName,
        modelId: runtime.primary.modelRef.id,
        model: runtime.primary.modelId,
        promptVersionId: runtime.promptVersionId,
        promptTemplateVersion: runtime.promptVersionNumber,
        requestId: request.id,
        tokenInput: usage.inputTokens,
        tokenOutput: usage.outputTokens,
        durationMs: Date.now() - startedAt,
        metadata: { type: "report_draft", reportType: request.body.reportType }
      }).returning();
      const [report] = await tx.insert(reports).values({
        projectId: project.id,
        conversationId: conversation.id,
        reportType: request.body.reportType,
        status: "DRAFT",
        contentJson: result.object,
        promptTemplateVersion: runtime.promptVersionNumber,
        createdById: user.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.REPORT_GENERATED, targetType: "report", targetId: report!.id,
        afterJson: { status: "DRAFT", messageId: message!.id, model: runtime.primary.modelId }
      });
      return { message: message!, report: report! };
    });
    return ok(request, {
      message: "AI 报告草稿生成成功",
      report: saved.report,
      draft: result.object,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    });
  });

  route.patch("/conversations/:id/scene", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "切换 AI 会话场景",
      params: conversationParamsSchema,
      body: updateSceneBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    if (request.body.scene === conversation.scene) {
      return ok(request, { message: "AI 会话场景未变化", conversation });
    }
    const [scene] = await app.db.select().from(aiScenes)
      .where(and(eq(aiScenes.code, request.body.scene), eq(aiScenes.enabled, true)))
      .limit(1);
    if (!scene) throw new ConflictError("目标场景未开放或不存在");
    if (scene.requireProject && !conversation.projectId) {
      throw new ConflictError("目标场景需要关联项目，请先为会话选择项目");
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ scene: request.body.scene, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: "ai.conversation_scene_changed",
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { scene: conversation.scene }, afterJson: { scene: row!.scene }
      });
      return row!;
    });
    return ok(request, { message: "AI 会话场景已切换", conversation: updated });
  });

  route.put("/conversations/:id/group", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "移动 AI 会话到分组",
      params: conversationParamsSchema,
      body: updateGroupBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const conversation = await findConversation(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    ensureConversationOwner(user, conversation);
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiConversations)
        .set({ groupId: request.body.groupId, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversation.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: "ai.conversation_group_changed",
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { groupId: conversation.groupId }, afterJson: { groupId: row!.groupId }
      });
      return row!;
    });
    return ok(request, { message: request.body.groupId ? "AI 会话已移动到分组" : "AI 会话已移出分组", conversation: updated });
  });

  route.delete("/conversations/:id/permanent", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / AI对话"],
      summary: "永久删除 AI 会话（仅超级管理员）",
      params: conversationParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("只有超级管理员可以永久删除 AI 会话");
    const conversation = await findConversationById(app, request.params.id);
    if (!conversation) throw new NotFoundError("AI 会话不存在");
    const [activeMessage] = await app.db.select({ id: aiMessages.id }).from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, conversation.id),
        inArray(aiMessages.status, ["PENDING", "STREAMING"])
      )).limit(1);
    if (activeMessage) throw new ConflictError("请先停止正在生成的 AI 回答，再删除会话");
    await app.db.transaction(async (tx) => {
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: "ai.conversation_permanently_deleted",
        targetType: "ai_conversation", targetId: conversation.id,
        beforeJson: { title: conversation.title, scene: conversation.scene, messageCount: 0 }
      });
      await tx.delete(aiConversations).where(eq(aiConversations.id, conversation.id));
    });
    return ok(request, { message: "AI 会话已永久删除（含全部消息）" });
  });

  route.get("/quota", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / AI对话"], summary: "查询当前用户 AI 使用额度" }
  }, async (request) => {
    const user = getCurrentUser(request);
    return ok(request, { quota: await getAiQuota(app, user) });
  });
}
