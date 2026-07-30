import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastify, { LogController } from "fastify";
import { sql } from "drizzle-orm";
import {
  serializerCompiler,
  validatorCompiler
} from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { aiRoutes } from "./modules/ai/ai.routes.js";
import { aiAdminRoutes } from "./modules/ai/ai-admin.routes.js";
import { aiConfigRoutes } from "./modules/ai-config/ai-config.routes.js";
import { platformAiFeedbackRoutes } from "./modules/ai-feedback/ai-feedback.routes.js";
import { auditLogRoutes } from "./modules/audit-logs/audit-log.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { dictRoutes } from "./modules/dicts/dicts.routes.js";
import { permissionRoutes } from "./modules/permissions/permissions.routes.js";
import {
  platformProjectRoutes,
  projectRoutes,
  workspaceProjectRoutes
} from "./modules/projects/projects.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { publicShareRoutes, shareRoutes } from "./modules/shares/shares.routes.js";
import { fileRoutes } from "./modules/files/files.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { systemManagementRoutes } from "./modules/system-management/system-management.routes.js";
import { platformOpsRoutes } from "./modules/platform-ops/platform-ops.routes.js";
import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { databasePlugin } from "./plugins/database.js";
import { queuesPlugin } from "./plugins/queues.js";
import { redisPlugin } from "./plugins/redis.js";
import { requestContextPlugin } from "./plugins/request-context.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { storagePlugin } from "./plugins/storage.js";
import { ok } from "./shared/response.js";

export async function buildApp() {
  const app = fastify({
    logger: env.NODE_ENV === "test" ? false : {
      level: env.NODE_ENV === "development" ? "debug" : "info"
    },
    logController: new LogController({
      disableRequestLogging: true
    }),
    genReqId: () => randomUUID()
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN
  });
  await app.register(requestContextPlugin);
  await app.register(databasePlugin);
  await app.register(redisPlugin);
  await app.register(queuesPlugin);
  await app.register(storagePlugin);
  await app.register(authPlugin);
  await app.register(swaggerPlugin);

  app.get("/favicon.ico", {
    schema: { hide: true }
  }, async (_request, reply) => reply.code(204).send());

  app.get("/health", async (request) =>
    ok(request, {
      status: "ok",
      service: "lg-vicp-backend",
      message: "服务运行正常"
    })
  );

  app.get("/health/live", {
    schema: { tags: ["公共 / 健康检查"], summary: "检查服务进程是否存活" }
  }, async (request) => ok(request, { status: "ok", message: "服务进程运行正常" }));

  app.get("/health/ready", {
    schema: { tags: ["公共 / 健康检查"], summary: "检查依赖服务是否就绪" }
  }, async (request, reply) => {
    const checks: Record<string, string> = {};
    await Promise.all([
      app.db.execute(sql`select 1`).then(() => { checks.database = "正常"; }).catch(() => { checks.database = "异常"; }),
      app.redis.ping().then(() => { checks.redis = "正常"; }).catch(() => { checks.redis = "异常"; }),
      app.storage.healthCheck().then(() => { checks.storage = "正常"; }).catch(() => { checks.storage = "异常"; })
    ]);
    const ready = Object.values(checks).every((value) => value === "正常");
    return reply.status(ready ? 200 : 503).send(ok(request, {
      status: ready ? "ready" : "not_ready",
      message: ready ? "所有依赖服务均已就绪" : "部分依赖服务尚未就绪",
      checks
    }));
  });

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(dictRoutes, { prefix: "/api/v1" });
  await app.register(permissionRoutes, { prefix: "/api/v1" });
  await app.register(projectRoutes, { prefix: "/api/v1" });
  await app.register(workspaceProjectRoutes, { prefix: "/api/v1/workspace" });
  await app.register(platformProjectRoutes, { prefix: "/api/v1/platform" });
  await app.register(userRoutes, { prefix: "/api/v1/platform" });
  await app.register(auditLogRoutes, { prefix: "/api/v1/platform" });
  await app.register(systemManagementRoutes, { prefix: "/api/v1/platform" });
  await app.register(platformOpsRoutes, { prefix: "/api/v1/platform" });
  await app.register(aiConfigRoutes, { prefix: "/api/v1/platform" });
  await app.register(platformAiFeedbackRoutes, { prefix: "/api/v1/platform/ai" });
  await app.register(aiAdminRoutes, { prefix: "/api/v1/platform/ai" });
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(fileRoutes, { prefix: "/api/v1/files" });
  await app.register(reportRoutes, { prefix: "/api/v1" });
  await app.register(shareRoutes, { prefix: "/api/v1" });
  await app.register(publicShareRoutes, { prefix: "/api/v1/public" });

  return app;
}
