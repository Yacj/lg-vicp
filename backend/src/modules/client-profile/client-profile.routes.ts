import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { getClientProfileSummary, listClientSelectableDepartments } from "./client-profile.service.js";

export async function clientProfileRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/profile/summary", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["C端 / 个人中心"],
      summary: "获取当前用户个人中心统计"
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const summary = await getClientProfileSummary({
      db: app.db,
      userId: user.id
    });

    return ok(request, summary);
  });

  route.get("/me/departments", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI)],
    schema: {
      tags: ["C端 / 个人中心"],
      summary: "获取当前用户可用于项目可见范围的部门"
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    return ok(request, {
      items: await listClientSelectableDepartments({ db: app.db, user })
    });
  });
}