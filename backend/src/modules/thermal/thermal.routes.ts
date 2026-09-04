import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { THERMAL_PERMISSIONS } from "../../shared/thermal-permissions.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { ThermalError } from "../../shared/thermal-errors.js";
import {
  applyThermalImportJob,
  completeThermalImportJob,
  copyThermalRows,
  createThermalImportJob,
  createThermalRow,
  createThermalSet,
  deleteThermalRow,
  deleteThermalSet,
  diffThermalImportJob,
  getThermalImportJob,
  getThermalSet,
  listThermalImportJobs,
  listThermalRows,
  listThermalSets,
  updateThermalRow,
  updateThermalSet,
  validateThermalSet,
  collectThermalSetViolations
} from "./thermal.service.js";
import {
  buildThermalTemplateWorkbook
} from "./thermal-import.service.js";
import {
  getPublishedThermalSetDetail,
  listPublishedThermalSets
} from "./thermal-read.service.js";
import {
  collectCalcRuleViolationsById,
  collectStandardLimitViolationsById,
  createCalcRule,
  createStandardLimit,
  deleteCalcRule,
  deleteStandardLimit,
  executeThermalCalc,
  getCalcRecord,
  getCalcRule,
  getStandardLimit,
  listCalcRecords,
  listCalcRules,
  listStandardLimits,
  updateCalcRule,
  updateStandardLimit,
  validateCalcRule,
  validateStandardLimit
} from "./thermal-calc.service.js";
import {
  createCandidateSelection,
  listCandidateSelections,
  queryThermalCandidates
} from "./thermal-candidate.service.js";
import {
  thermalCalcRecordDto,
  thermalCalcRecordListQuerySchema,
  thermalCalcRequestSchema,
  thermalCalcRuleCreateSchema,
  thermalCalcRuleDto,
  thermalCalcRuleListQuerySchema,
  thermalCalcRuleUpdateSchema,
  thermalStandardLimitCreateSchema,
  thermalStandardLimitDto,
  thermalStandardLimitListQuerySchema,
  thermalStandardLimitUpdateSchema
} from "./thermal-calc.schemas.js";
import {
  thermalCandidateQuerySchema,
  thermalCandidateQueryResponseSchema,
  thermalCandidateSelectionCreateSchema,
  thermalCandidateSelectionDto,
  thermalCandidateSelectionListQuerySchema
} from "./thermal-candidate.schemas.js";
import {
  thermalImportApplySchema,
  thermalImportJobCreateSchema,
  thermalImportJobDetailDto,
  thermalImportJobDto,
  thermalImportJobListQuerySchema,
  thermalImportPreviewDto,
  thermalImportDiffDto,
  thermalImportApplyDto,
  thermalJobStatusSchema,
  thermalPublishedSetQuerySchema,
  thermalRowCreateSchema,
  thermalRowDto,
  thermalRowListQuerySchema,
  thermalRowUpdateSchema,
  thermalSetCreateSchema,
  thermalSetDto,
  thermalSetListQuerySchema,
  thermalSetUpdateSchema,
  uuidParams
} from "./thermal.schemas.js";
import {
  approveBodySchema,
  newVersionBodySchema,
  rejectBodySchema
} from "../construction/construction.schemas.js";
import {
  registerVersionedWorkflow,
  type WorkflowPerms
} from "../masterdata/workflow-routes.js";

const THERMAL_TAG = "B端 / 平台 / 图集热工";

/** 图集热工模块权限校验：SUPER_ADMIN 直通，否则校验具体权限码（本地函数模式，与 construction 一致） */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有图集热工参考表管理权限");
  }
  return user;
}

const P = THERMAL_PERMISSIONS;
const SET_PERMS: WorkflowPerms = {
  list: P.LIST, create: P.CREATE, update: P.UPDATE,
  remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
};

/** 参考行路径参数：setId */
const setIdParams = z.object({ setId: z.uuid("参考集 ID 格式不正确") });
const jobIdParams = z.object({ id: z.uuid("导入作业 ID 格式不正确") });

/** 显式结构校验响应：valid + 违规明细（不抛错，前端可逐条展示） */
const validateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    violations: z.array(z.object({ field: z.string(), message: z.string() }))
  }),
  requestId: z.string()
});

export async function thermalRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /** 工作流工厂公共上下文（图集热工统一标签/权限/Schema） */
  const workflowCtx = {
    tag: THERMAL_TAG,
    require: requirePermission,
    uuidParams,
    approveBody: approveBodySchema,
    rejectBody: rejectBodySchema,
    newVersionBody: newVersionBodySchema
  } as const;

  // ================================================================ 参考集（版本化 + 结构校验）
  route.get("/sets", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询图集热工参考集列表",
      querystring: thermalSetListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalSetDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    return ok(request, await listThermalSets(app, request.query));
  });

  route.post("/sets", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "新增图集热工参考集",
      body: thermalSetCreateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalSetDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.create);
    return ok(request, await createThermalSet(app, request, actor, request.body));
  });

  route.get("/sets/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询图集热工参考集详情",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalSetDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    return ok(request, await getThermalSet(app, request.params.id));
  });

  route.patch("/sets/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "修改图集热工参考集",
      params: uuidParams, body: thermalSetUpdateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalSetDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.update);
    return ok(request, await updateThermalSet(app, request, actor, request.params.id, request.body));
  });

  route.delete("/sets/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "删除图集热工参考集草稿",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ message: z.string() }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.remove);
    return ok(request, await deleteThermalSet(app, request, actor, request.params.id));
  });

  // 显式结构校验：返回违规明细不抛错（submit/publish 时工厂会在状态机前强制执行同样校验）
  route.post("/sets/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "校验图集热工参考集结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    const violations = await collectThermalSetViolations(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "/sets", label: "图集热工参考集", entity: "thermalReferenceSet",
    perms: SET_PERMS, dto: thermalSetDto,
    copyChildren: copyThermalRows,
    validate: (instance, id) => validateThermalSet(instance, id)
  });

  // ================================================================ 参考行（子表，随集状态守卫）
  route.get("/sets/:setId/rows", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询参考集参考行列表",
      params: setIdParams, querystring: thermalRowListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalRowDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    return ok(request, await listThermalRows(app, request.params.setId, request.query));
  });

  route.post("/sets/:setId/rows", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "新增参考行",
      params: setIdParams, body: thermalRowCreateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalRowDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.update);
    return ok(request, await createThermalRow(app, request, actor, request.params.setId, request.body));
  });

  route.patch("/rows/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "修改参考行",
      params: uuidParams, body: thermalRowUpdateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalRowDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.update);
    return ok(request, await updateThermalRow(app, request, actor, request.params.id, request.body));
  });

  route.delete("/rows/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "删除参考行",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ message: z.string() }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, SET_PERMS.update);
    return ok(request, await deleteThermalRow(app, request, actor, request.params.id));
  });

  // ================================================================ 导入作业（创建/确认/列表/预览/差异/应用）
  route.get("/import-template", {
    preHandler: [app.authenticate],
    schema: { tags: [THERMAL_TAG], summary: "下载图集热工参考选用表导入模板" }
  }, async (request, reply) => {
    requirePermission(request, P.IMPORT);
    const workbook = buildThermalTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", "attachment; filename=\"thermal-template.xlsx\"")
      .send(buffer);
  });

  route.post("/import-jobs", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "创建图集热工导入作业（返回预签名直传地址）",
      body: thermalImportJobCreateSchema,
      response: { 200: z.object({ success: z.boolean(), data: z.object({
        id: z.uuid(), setCode: z.string(), name: z.string().nullable(), fileId: z.uuid(),
        templateVersion: z.number(), status: thermalJobStatusSchema, createdById: z.string().uuid().nullable(),
        createdAt: z.date(), updatedAt: z.date(),
        uploadUrl: z.string(), headers: z.record(z.string(), z.string()),
        expiresAt: z.date()
      }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.IMPORT);
    return ok(request, await createThermalImportJob(app, request, actor, request.body));
  });

  route.post("/import-jobs/:id/complete", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "确认导入文件上传完成并投递解析",
      params: jobIdParams,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ message: z.string(), jobId: z.uuid() }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.IMPORT);
    return ok(request, await completeThermalImportJob(app, request, actor, request.params.id));
  });

  route.get("/import-jobs", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询导入作业列表",
      querystring: thermalImportJobListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalImportJobDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    requirePermission(request, P.IMPORT);
    return ok(request, await listThermalImportJobs(app, request.query));
  });

  route.get("/import-jobs/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询导入作业详情（含错误清单）",
      params: jobIdParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalImportJobDetailDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, P.IMPORT);
    return ok(request, await getThermalImportJob(app, request.params.id));
  });

  route.get("/import-jobs/:id/preview", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "预览解析结果（有效行 + 错误清单）",
      params: jobIdParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalImportPreviewDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, P.IMPORT);
    const detail = await getThermalImportJob(app, request.params.id);
    if (detail.status !== "PARSED") {
      throw new ThermalError("THERMAL_STATUS_CONFLICT", "仅解析完成的导入作业可以预览");
    }
    return ok(request, {
      rowCount: detail.rowCount,
      validCount: detail.validCount,
      errorCount: detail.errorCount,
      rows: Array.isArray(detail.result) ? detail.result : [],
      errors: detail.errors
    });
  });

  route.get("/import-jobs/:id/diff", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "预览与目标参考集的差异（新增/变化/待移除）",
      params: jobIdParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalImportDiffDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, P.IMPORT);
    return ok(request, await diffThermalImportJob(app, request.params.id));
  });

  route.post("/import-jobs/:id/apply", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "应用导入到参考集草稿（单事务，错误行默认拒绝）",
      params: jobIdParams, body: thermalImportApplySchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalImportApplyDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.IMPORT);
    return ok(request, await applyThermalImportJob(app, request, actor, request.params.id, request.body.ignoreErrors));
  });

  // ================================================================ 已发布读取（只读 PUBLISHED + 生效中）
  route.get("/published/sets", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询已发布且生效中的图集热工参考集",
      querystring: thermalPublishedSetQuerySchema,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ items: z.array(thermalSetDto) }), requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    return ok(request, { items: await listPublishedThermalSets(app.db, request.query) });
  });

  route.get("/published/sets/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询已发布参考集详情（含参考行，供方案筛选查表）",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalSetDto.extend({ rows: z.array(thermalRowDto) }), requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, SET_PERMS.list);
    return ok(request, await getPublishedThermalSetDetail(app.db, request.params.id));
  });

  // ================================================================ 热工计算规则（版本化 + 结构校验）
  const RULE_PERMS: WorkflowPerms = {
    list: P.LIST, create: P.CREATE, update: P.UPDATE,
    remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
  };
  const LIMIT_PERMS: WorkflowPerms = {
    list: P.LIST, create: P.CREATE, update: P.UPDATE,
    remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
  };

  route.get("/calc-rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询热工计算规则列表",
      querystring: thermalCalcRuleListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalCalcRuleDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    requirePermission(request, RULE_PERMS.list);
    return ok(request, await listCalcRules(app, request.query));
  });

  route.post("/calc-rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "新增热工计算规则",
      body: thermalCalcRuleCreateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCalcRuleDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, RULE_PERMS.create);
    return ok(request, await createCalcRule(app, request, actor, request.body));
  });

  route.get("/calc-rules/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询热工计算规则详情",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalCalcRuleDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, RULE_PERMS.list);
    return ok(request, await getCalcRule(app, request.params.id));
  });

  route.patch("/calc-rules/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "修改热工计算规则",
      params: uuidParams, body: thermalCalcRuleUpdateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCalcRuleDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, RULE_PERMS.update);
    return ok(request, await updateCalcRule(app, request, actor, request.params.id, request.body));
  });

  route.delete("/calc-rules/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "删除热工计算规则草稿",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ message: z.string() }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, RULE_PERMS.remove);
    return ok(request, await deleteCalcRule(app, request, actor, request.params.id));
  });

  route.post("/calc-rules/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "校验热工计算规则结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, RULE_PERMS.list);
    const violations = await collectCalcRuleViolationsById(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "/calc-rules", label: "热工计算规则", entity: "thermalCalcRule",
    perms: RULE_PERMS, dto: thermalCalcRuleDto,
    validate: (instance, id) => validateCalcRule(instance, id)
  });

  // ================================================================ 地区标准限值（版本化 + 结构校验）
  route.get("/standard-limits", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询地区标准限值列表",
      querystring: thermalStandardLimitListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalStandardLimitDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    requirePermission(request, LIMIT_PERMS.list);
    return ok(request, await listStandardLimits(app, request.query));
  });

  route.post("/standard-limits", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "新增地区标准限值",
      body: thermalStandardLimitCreateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalStandardLimitDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, LIMIT_PERMS.create);
    return ok(request, await createStandardLimit(app, request, actor, request.body));
  });

  route.get("/standard-limits/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询地区标准限值详情",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalStandardLimitDto, requestId: z.string() }) }
    }
  }, async (request) => {
    requirePermission(request, LIMIT_PERMS.list);
    return ok(request, await getStandardLimit(app, request.params.id));
  });

  route.patch("/standard-limits/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "修改地区标准限值",
      params: uuidParams, body: thermalStandardLimitUpdateSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalStandardLimitDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, LIMIT_PERMS.update);
    return ok(request, await updateStandardLimit(app, request, actor, request.params.id, request.body));
  });

  route.delete("/standard-limits/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "删除地区标准限值草稿",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: z.object({ message: z.string() }), requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, LIMIT_PERMS.remove);
    return ok(request, await deleteStandardLimit(app, request, actor, request.params.id));
  });

  route.post("/standard-limits/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "校验地区标准限值结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, LIMIT_PERMS.list);
    const violations = await collectStandardLimitViolationsById(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "/standard-limits", label: "地区标准限值", entity: "thermalStandardLimit",
    perms: LIMIT_PERMS, dto: thermalStandardLimitDto,
    validate: (instance, id) => validateStandardLimit(instance, id)
  });

  // ================================================================ 确定性计算执行与记录
  const thermalCalcExecutionSchema = z.object({
    valid: z.boolean(),
    errors: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() })),
    notes: z.array(z.string()),
    record: thermalCalcRecordDto.nullable()
  });

  route.post("/calc", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "执行确定性热工计算（REFERENCE_TABLE / EQUIVALENT / LAYERED）",
      body: thermalCalcRequestSchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCalcExecutionSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.LIST);
    return ok(request, await executeThermalCalc(app, request, actor, request.body));
  });

  route.get("/calc-records", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询热工计算记录列表（快照可追溯）",
      querystring: thermalCalcRecordListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalCalcRecordDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.LIST);
    return ok(request, await listCalcRecords(app, request.query, actor));
  });

  route.get("/calc-records/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询热工计算记录详情（输入/层/参数/规则/标准/公式/步骤快照）",
      params: uuidParams,
      response: { 200: z.object({ success: z.boolean(), data: thermalCalcRecordDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.LIST);
    return ok(request, await getCalcRecord(app, actor, request.params.id));
  });

  // ================================================================ 候选方案查询与确认
  route.post("/candidates/query", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "候选方案查询（条件匹配图集参考行，返回候选列表供用户选择）",
      body: thermalCandidateQuerySchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCandidateQueryResponseSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.LIST);
    return ok(request, await queryThermalCandidates(app, request, actor, request.body));
  });

  route.get("/candidate-selections", {
    preHandler: [app.authenticate],
    schema: {
      tags: [THERMAL_TAG], summary: "查询候选方案确认记录列表（查询与候选全快照可追溯）",
      querystring: thermalCandidateSelectionListQuerySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(thermalCandidateSelectionDto), total: z.number(), page: z.number(), pageSize: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    const actor = requirePermission(request, P.LIST);
    return ok(request, await listCandidateSelections(app, request.query, actor));
  });
}