import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { reportTemplates } from "../../db/schema.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { REPORT_PERMISSIONS } from "../../shared/report-permissions.js";
import { ok } from "../../shared/response.js";
import { registerVersionedWorkflow, type WorkflowPerms } from "../masterdata/workflow-routes.js";
import {
  collectTemplateSectionViolations,
  createReportTemplate,
  deleteReportTemplate,
  getReportTemplate,
  listReportTemplates,
  updateReportTemplate,
  validateReportTemplateStructure
} from "./report-template.service.js";
import {
  approveBodySchema,
  newVersionBodySchema,
  rejectBodySchema,
  REPORT_TEMPLATE_RESPONSES,
  reportTemplateCreateSchema,
  reportTemplateDto,
  reportTemplateListQuerySchema,
  reportTemplateUpdateSchema,
  uuidParams
} from "./report-template.schemas.js";

const REPORT_TEMPLATE_TAG = "B端 / 平台 / 报告模板";

/** 报告模板权限校验：SUPER_ADMIN 直通，否则校验具体权限码（本地函数模式，与 construction 一致） */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有报告模板管理权限");
  }
  return user;
}

const P = REPORT_PERMISSIONS;
const TEMPLATE_PERMS: WorkflowPerms = {
  list: P.TEMPLATE_LIST, create: P.TEMPLATE_CREATE, update: P.TEMPLATE_UPDATE,
  remove: P.TEMPLATE_DELETE, approve: P.TEMPLATE_APPROVE, publish: P.TEMPLATE_PUBLISH
};

/** 显式结构校验响应：valid + 违规明细（不抛错，前端可逐条展示） */
const validateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    violations: z.array(z.object({ field: z.string(), message: z.string() }))
  }),
  requestId: z.string()
});

export async function reportTemplateRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /** 工作流工厂公共上下文（报告模板统一标签/权限/Schema） */
  const workflowCtx = {
    tag: REPORT_TEMPLATE_TAG,
    require: requirePermission,
    uuidParams,
    approveBody: approveBodySchema,
    rejectBody: rejectBodySchema,
    newVersionBody: newVersionBodySchema
  } as const;

  route.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "查询报告模板列表",
      querystring: reportTemplateListQuerySchema, response: { 200: REPORT_TEMPLATE_RESPONSES.templateList }
    }
  }, async (request) => {
    requirePermission(request, TEMPLATE_PERMS.list);
    return ok(request, await listReportTemplates(app, request.query));
  });

  route.post("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "新增报告模板",
      body: reportTemplateCreateSchema, response: { 200: REPORT_TEMPLATE_RESPONSES.templateSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, TEMPLATE_PERMS.create);
    return ok(request, await createReportTemplate(app, request, actor, request.body));
  });

  route.get("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "查询报告模板详情",
      params: uuidParams, response: { 200: REPORT_TEMPLATE_RESPONSES.templateSingle }
    }
  }, async (request) => {
    requirePermission(request, TEMPLATE_PERMS.list);
    return ok(request, await getReportTemplate(app, request.params.id));
  });

  route.patch("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "修改报告模板",
      params: uuidParams, body: reportTemplateUpdateSchema,
      response: { 200: REPORT_TEMPLATE_RESPONSES.templateSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, TEMPLATE_PERMS.update);
    return ok(request, await updateReportTemplate(app, request, actor, request.params.id, request.body));
  });

  route.delete("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "删除报告模板草稿",
      params: uuidParams, response: { 200: REPORT_TEMPLATE_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, TEMPLATE_PERMS.remove);
    return ok(request, await deleteReportTemplate(app, request, actor, request.params.id));
  });

  // 显式结构校验：返回违规明细不抛错（submit/publish 时工厂会在状态机前强制执行同样校验）
  route.post("/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_TEMPLATE_TAG], summary: "校验报告模板章节配置",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, TEMPLATE_PERMS.list);
    const [row] = await app.db.select().from(reportTemplates).where(eq(reportTemplates.id, request.params.id)).limit(1);
    if (!row) {
      return ok(request, { valid: false, violations: [{ field: "id", message: "报告模板不存在" }] });
    }
    const violations = collectTemplateSectionViolations(row.sectionsJson as never);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "", label: "报告模板", entity: "reportTemplate",
    perms: TEMPLATE_PERMS, dto: reportTemplateDto,
    validate: validateReportTemplateStructure
  });
}