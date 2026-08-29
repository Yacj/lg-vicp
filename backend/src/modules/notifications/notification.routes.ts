import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { NOTIFICATION_PERMISSIONS } from "../../shared/notification-permissions.js";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "./notification.service.js";

const notificationTypes = [
  "AI_FEEDBACK",
  "STANDARD_PENDING_REVIEW",
  "KNOWLEDGE_PARSE_FAILED",
  "REPORT_GENERATION_FAILED"
] as const;

const notificationQuerySchema = paginationQuerySchema.extend({
  type: z.enum(notificationTypes).optional(),
  unreadOnly: z.stringbool().default(false)
});
const notificationParamsSchema = z.object({ id: z.uuid("通知 ID 格式不正确") });

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有消息通知权限");
  }
  return user;
}

/** B 端平台消息通知中心：反馈提醒 / 待审核 / 解析与生成失败告警（轮询，无 WebSocket） */
export async function notificationRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/notifications", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 消息通知"],
      summary: "查询消息通知列表（含本人已读状态）",
      querystring: notificationQuerySchema
    }
  }, async (request) => {
    const user = requireAdmin(request, NOTIFICATION_PERMISSIONS.LIST);
    const result = await listNotifications(app, {
      page: request.query.page,
      pageSize: request.query.pageSize,
      userId: user.id,
      type: request.query.type,
      unreadOnly: request.query.unreadOnly
    });
    return ok(request, result);
  });

  route.get("/notifications/unread-count", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 消息通知"],
      summary: "查询未读通知数量（轮询）"
    }
  }, async (request) => {
    const user = requireAdmin(request, NOTIFICATION_PERMISSIONS.LIST);
    const unreadCount = await getUnreadNotificationCount(app, user.id);
    return ok(request, { unreadCount });
  });

  route.put("/notifications/:id/read", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 消息通知"],
      summary: "标记单条通知已读",
      params: notificationParamsSchema
    }
  }, async (request) => {
    const user = requireAdmin(request, NOTIFICATION_PERMISSIONS.READ);
    const marked = await markNotificationRead(app, user.id, request.params.id);
    if (!marked) return ok(request, { message: "通知不存在", marked: false });
    return ok(request, { message: "通知已标记为已读", marked: true });
  });

  route.put("/notifications/read-all", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 消息通知"],
      summary: "全部标记已读"
    }
  }, async (request) => {
    const user = requireAdmin(request, NOTIFICATION_PERMISSIONS.READ);
    const marked = await markAllNotificationsRead(app, user.id);
    return ok(request, { message: `已标记 ${marked} 条通知为已读`, marked });
  });
}
