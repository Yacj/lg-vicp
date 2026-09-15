import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { requireClient } from "../../shared/client-guard.js";
import { ok } from "../../shared/response.js";
import { getLegacyEnterpriseProfileAbout } from "../company/company.service.js";

/**
 * C 端只读企业内容（关于我们）兼容入口。
 * 与 `GET /api/v1/company/about` 同源；保留 intro/logoUrl 别名，不返回工商/联系人等内部字段。
 */
export async function masterdataClientRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/content/enterprise-profile", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI)],
    schema: {
      tags: ["C端 / 企业内容"],
      summary: "获取企业介绍（兼容旧路径，与 /api/v1/company/about 同源）"
    }
  }, async (request) => {
    getCurrentUser(request);
    return ok(request, await getLegacyEnterpriseProfileAbout(app));
  });
}
