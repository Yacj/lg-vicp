import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { getClientProfileSummary } from "./client-profile.service.js";

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
}