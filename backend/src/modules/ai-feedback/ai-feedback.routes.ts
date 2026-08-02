import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiConversations, aiMessageFeedbacks, aiMessages, users } from "../../db/schema.js";
import { AI_FEEDBACK_REACTIONS, AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const feedbackQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  userId: z.uuid("用户 ID 格式不正确").optional(),
  reaction: z.enum([AI_FEEDBACK_REACTIONS.LIKE, AI_FEEDBACK_REACTIONS.DISLIKE]).optional(),
  scene: z.string().trim().max(80, "AI 场景不能超过 80 个字符").optional()
});
const feedbackParamsSchema = z.object({ id: z.uuid("反馈 ID 格式不正确") });
const handleFeedbackBodySchema = z.object({
  handlingNote: z.string().trim().max(1000, "处理意见不能超过 1000 个字符").optional(),
  reasonCode: z.string().trim().max(40, "原因编码不能超过 40 个字符").optional()
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("当前账号没有 AI 反馈查看权限");
  return user;
}

export async function platformAiFeedbackRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/feedbacks", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI运营"],
      summary: "查询 AI 回答点赞与反馈",
      querystring: feedbackQuerySchema
    }
  }, async (request) => {
    requireAdmin(request, "system:ai:feedback:list");
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(
      request.query.projectId ? eq(aiMessageFeedbacks.projectId, request.query.projectId) : undefined,
      request.query.userId ? eq(aiMessageFeedbacks.userId, request.query.userId) : undefined,
      request.query.reaction ? eq(aiMessageFeedbacks.reaction, request.query.reaction) : undefined,
      request.query.scene ? eq(aiConversations.scene, request.query.scene) : undefined
    );

    const [items, [totalRow]] = await Promise.all([
      app.db.select({
        feedback: aiMessageFeedbacks,
        message: {
          id: aiMessages.id,
          content: aiMessages.content,
          provider: aiMessages.provider,
          model: aiMessages.model,
          tokenInput: aiMessages.tokenInput,
          tokenOutput: aiMessages.tokenOutput,
          durationMs: aiMessages.durationMs,
          createdAt: aiMessages.createdAt
        },
        conversation: {
          id: aiConversations.id,
          scene: aiConversations.scene,
          clientApp: aiConversations.clientApp,
          projectId: aiConversations.projectId
        },
        user: {
          id: users.id,
          displayName: users.displayName,
          phone: users.phone
        }
      })
        .from(aiMessageFeedbacks)
        .innerJoin(aiMessages, eq(aiMessages.id, aiMessageFeedbacks.messageId))
        .innerJoin(aiConversations, eq(aiConversations.id, aiMessageFeedbacks.conversationId))
        .innerJoin(users, eq(users.id, aiMessageFeedbacks.userId))
        .where(where)
        .orderBy(desc(aiMessageFeedbacks.createdAt))
        .offset(skip)
        .limit(take),
      app.db.select({ value: count() })
        .from(aiMessageFeedbacks)
        .innerJoin(aiConversations, eq(aiConversations.id, aiMessageFeedbacks.conversationId))
        .where(where)
    ]);

    return ok(request, {
      items,
      total: totalRow?.value ?? 0,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.put("/feedbacks/:id/handle", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI运营"],
      summary: "处理 AI 反馈",
      params: feedbackParamsSchema,
      body: handleFeedbackBodySchema
    }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:feedback:handle");
    const [feedback] = await app.db.select().from(aiMessageFeedbacks)
      .where(eq(aiMessageFeedbacks.id, request.params.id)).limit(1);
    if (!feedback) throw new NotFoundError("AI 反馈不存在");

    await app.db.transaction(async (tx) => {
      await tx.update(aiMessageFeedbacks).set({
        handledById: actor.id,
        handledAt: new Date(),
        handlingNote: request.body.handlingNote,
        updatedAt: new Date()
      }).where(eq(aiMessageFeedbacks.id, feedback.id));
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_FEEDBACK_HANDLED,
        targetType: "ai_feedback", targetId: feedback.id,
        beforeJson: feedback,
        afterJson: { handledById: actor.id, handlingNote: request.body.handlingNote }
      });
    });
    return ok(request, { message: "AI 反馈已标记为已处理" });
  });
}
