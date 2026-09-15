import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { MD_PERMISSIONS } from "../../shared/md-permissions.js";
import { ok } from "../../shared/response.js";
import {
  COMPANY_RESPONSES,
  companyProfileUpdateSchema,
  companyQualificationIdParams,
  companyQualificationUpdateSchema,
  companyQualificationWriteSchema
} from "./company.schemas.js";
import {
  createCompanyQualification,
  deleteCompanyQualification,
  getCompanyProfile,
  listCompanyQualifications,
  updateCompanyProfile,
  updateCompanyQualification
} from "./company.service.js";

const TAG = "B端 / 平台 / 企业信息";

function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有企业信息管理权限");
  }
  return user;
}

export async function companyRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/profile", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "读取企业信息（名称/简称/Logo/简介/官网/资质）",
      response: { 200: COMPANY_RESPONSES.profile }
    }
  }, async (request) => {
    requirePermission(request, MD_PERMISSIONS.ENTERPRISE_LIST);
    return ok(request, await getCompanyProfile(app));
  });

  route.put("/profile", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "保存企业信息（保存后即可用于 About 与报告，无需审核）",
      body: companyProfileUpdateSchema,
      response: { 200: COMPANY_RESPONSES.profile }
    }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.ENTERPRISE_UPDATE);
    return ok(request, await updateCompanyProfile(app, request, actor, request.body));
  });

  route.get("/qualifications", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "查询企业资质列表",
      response: { 200: COMPANY_RESPONSES.qualificationList }
    }
  }, async (request) => {
    requirePermission(request, MD_PERMISSIONS.ENTERPRISE_LIST);
    return ok(request, await listCompanyQualifications(app));
  });

  route.post("/qualifications", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "新增企业资质",
      body: companyQualificationWriteSchema,
      response: { 200: COMPANY_RESPONSES.qualification }
    }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.ENTERPRISE_CREATE);
    return ok(request, await createCompanyQualification(app, request, actor, request.body));
  });

  route.put("/qualifications/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "修改企业资质",
      params: companyQualificationIdParams,
      body: companyQualificationUpdateSchema,
      response: { 200: COMPANY_RESPONSES.qualification }
    }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.ENTERPRISE_UPDATE);
    return ok(request, await updateCompanyQualification(app, request, actor, request.params.id, request.body));
  });

  route.delete("/qualifications/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [TAG],
      summary: "删除企业资质",
      params: companyQualificationIdParams,
      response: { 200: COMPANY_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, MD_PERMISSIONS.ENTERPRISE_DELETE);
    return ok(request, await deleteCompanyQualification(app, request, actor, request.params.id));
  });
}
