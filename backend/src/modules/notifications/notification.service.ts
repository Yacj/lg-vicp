import { and, count, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { notificationReads, notifications } from "../../db/schema.js";

/**
 * B 端消息通知服务（轻量提醒闭环，轮询读取，无 WebSocket）：
 * - 通知为广播行（不按用户 fan-out），已读状态记录在 notification_reads 按用户差集；
 * - createNotification 为尽力写入：通知失败不阻塞主业务流程（审计已覆盖关键动作）。
 */

export type NotificationType =
  | "AI_FEEDBACK"
  | "STANDARD_PENDING_REVIEW"
  | "KNOWLEDGE_PARSE_FAILED"
  | "REPORT_GENERATION_FAILED";

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  content?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  createdById?: string | null;
}

interface NotificationDeps {
  db: Database;
  log?: { error: (...args: unknown[]) => void };
}

/** 尽力写入一条通知：任何失败只记日志，不向调用方抛错（API 与 Worker 均可调用） */
export async function createNotification(deps: NotificationDeps, input: CreateNotificationInput): Promise<void> {
  try {
    await deps.db.insert(notifications).values({
      type: input.type,
      title: input.title,
      content: input.content ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      projectId: input.projectId ?? null,
      createdById: input.createdById ?? null
    });
  } catch (error) {
    const log = deps.log ?? console;
    log.error({ err: error, type: input.type }, "消息通知写入失败（已忽略，不阻塞主流程）");
  }
}

/** 通知列表（含当前用户已读状态；type/read 过滤） */
export async function listNotifications(
  app: NotificationDeps,
  query: { page: number; pageSize: number; userId: string; type?: string; unreadOnly?: boolean }
) {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(1, query.pageSize));
  const readNotificationIds = app.db
    .select({ id: notificationReads.notificationId })
    .from(notificationReads)
    .where(eq(notificationReads.userId, query.userId));

  const where = and(
    query.type ? sql`${notifications.type} = ${query.type}` : undefined,
    query.unreadOnly ? notInArray(notifications.id, readNotificationIds) : undefined
  );

  const items = await app.db.select({
    id: notifications.id,
    type: notifications.type,
    title: notifications.title,
    content: notifications.content,
    targetType: notifications.targetType,
    targetId: notifications.targetId,
    projectId: notifications.projectId,
    createdAt: notifications.createdAt,
    readAt: notificationReads.readAt
  })
    .from(notifications)
    .leftJoin(notificationReads, and(
      eq(notificationReads.notificationId, notifications.id),
      eq(notificationReads.userId, query.userId)
    ))
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [totalRow] = await app.db.select({ value: count() }).from(notifications).where(where);
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

/** 未读数 = 全部通知数 - 当前用户已读数 */
export async function getUnreadNotificationCount(app: NotificationDeps, userId: string): Promise<number> {
  const [totalRow] = await app.db.select({ value: count() }).from(notifications);
  const [readRow] = await app.db.select({ value: count() })
    .from(notificationReads).where(eq(notificationReads.userId, userId));
  return Math.max(0, (totalRow?.value ?? 0) - (readRow?.value ?? 0));
}

/** 标记单条已读（幂等；通知不存在返回 false） */
export async function markNotificationRead(
  app: NotificationDeps,
  userId: string,
  notificationId: string
): Promise<boolean> {
  const [notification] = await app.db.select({ id: notifications.id })
    .from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!notification) return false;
  await app.db.insert(notificationReads)
    .values({ notificationId, userId })
    .onConflictDoNothing();
  return true;
}

/** 全部标记已读（补齐当前用户缺失的已读记录） */
export async function markAllNotificationsRead(app: NotificationDeps, userId: string): Promise<number> {
  const unread = await app.db.select({ id: notifications.id })
    .from(notifications)
    .leftJoin(notificationReads, and(
      eq(notificationReads.notificationId, notifications.id),
      eq(notificationReads.userId, userId)
    ))
    .where(isNull(notificationReads.id));
  if (unread.length === 0) return 0;
  await app.db.insert(notificationReads)
    .values(unread.map((row) => ({ notificationId: row.id, userId })))
    .onConflictDoNothing();
  return unread.length;
}
