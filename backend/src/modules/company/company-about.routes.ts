import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { COMPANY_RESPONSES } from "./company.schemas.js";
import { getCompanyAbout } from "./company.service.js";

/**
 * C 端 / App 关于我们。登录即可读取，不依赖后台 RBAC。
 * 只返回名称、简称、Logo、简介、官网、资质，不含工商/银行等内部字段。
 */
export async function companyAboutRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/company/about", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["C端 / 企业内容"],
      summary: "获取企业介绍（关于我们）",
      response: { 200: COMPANY_RESPONSES.about }
    }
  }, async (request) => {
    getCurrentUser(request);
    return ok(request, await getCompanyAbout(app));
  });
}
