import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiConversations, aiMessageFeedbacks, aiMessages, users } from "../../db/schema.js";
import { AI_FEEDBACK_REACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";

const feedbackQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  userId: z.uuid("用户 ID 格式不正确").optional(),
  reaction: z.enum([AI_FEEDBACK_REACTIONS.LIKE, AI_FEEDBACK_REACTIONS.DISLIKE]).optional(),
  scene: z.string().trim().max(80, "AI 场景不能超过 80 个字符").optional()
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
      tags: ["AI 反馈"],
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
}
