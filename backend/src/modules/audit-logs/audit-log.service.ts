import type { FastifyRequest } from "fastify";
import type { DbExecutor } from "../../db/client.js";
import { auditLogs } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";

interface WriteAuditLogInput {
  db: DbExecutor;
  /** 定时任务/服务端入口（爬虫、内部 API）无 HTTP 请求上下文时可省略 */
  request?: FastifyRequest;
  actor?: AuthUser;
  projectId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
}

export async function writeAuditLog(input: WriteAuditLogInput) {
  await input.db.insert(auditLogs).values({
    actorUserId: input.actor?.id,
    projectId: input.projectId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeJson: input.beforeJson,
    afterJson: input.afterJson,
    ip: input.request?.ip,
    userAgent: input.request?.headers["user-agent"],
    requestId: input.request?.id
  });
}
