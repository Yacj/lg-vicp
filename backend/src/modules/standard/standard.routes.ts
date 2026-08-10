import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { STANDARD_PERMISSIONS } from "../../shared/standard-permissions.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import type { StandardDeps } from "./standard.service.js";
import {
  approveApplicability,
  approveDocument,
  approveIndicator,
  confirmReplacement,
  createApplicability,
  createManualDocument,
  createReplacement,
  createSource,
  deleteApplicability,
  deleteDocument,
  deleteIndicator,
  deleteReplacement,
  deleteSource,
  getCrawlJob,
  getDocument,
  getIndicator,
  getSource,
  listApplicability,
  listCrawlJobs,
  listDocuments,
  listEffectiveStandards,
  listIndicators,
  listPublishedIndicators,
  listReplacements,
  listSources,
  publishApplicability,
  publishDocument,
  publishIndicator,
  rejectApplicability,
  rejectDocument,
  rejectIndicator,
  rejectReplacement,
  submitApplicability,
  submitDocument,
  triggerCrawl,
  updateApplicability,
  updateDocument,
  updateIndicator,
  updateSource
} from "./standard.service.js";
import {
  applicabilityCreateSchema,
  applicabilityDto,
  applicabilityUpdateSchema,
  approvalBodySchema,
  crawlJobDto,
  crawlJobListQuerySchema,
  crawlTriggerBodySchema,
  documentDto,
  documentListQuerySchema,
  documentUpdateSchema,
  effectiveStandardDto,
  effectiveStandardsQuerySchema,
  indicatorDto,
  indicatorListQuerySchema,
  indicatorUpdateSchema,
  manualDocumentCreateSchema,
  publishedIndicatorQuerySchema,
  rejectBodySchema,
  replacementCreateSchema,
  replacementDto,
  replacementListQuerySchema,
  sourceCreateSchema,
  sourceDto,
  sourceUpdateSchema,
  uuidParams
} from "./standard.schemas.js";

const STANDARD_TAG = "B端 / 平台 / 标准采集";

/** 标准采集模块权限校验：SUPER_ADMIN 直通，否则校验具体权限码 */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有标准采集管理权限");
  }
  return user;
}

const P = STANDARD_PERMISSIONS;
const arrayResponse = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.array(itemDto),
  requestId: z.string()
});
const singleResponse = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});
const messageResponse = z.object({
  success: z.boolean(),
  data: z.object({ message: z.string() }),
  requestId: z.string()
});

/** 文档原文/附件/截图下载地址（对象存储预签名，有效期 1 小时） */
async function buildDocumentObjectUrl(
  deps: StandardDeps, document: { documentNo: string; [key: string]: unknown },
  objectKey: unknown, fileNameSuffix: string
) {
  if (!deps.storage) throw new NotFoundError("对象存储未配置");
  if (typeof objectKey !== "string" || objectKey.length === 0) throw new NotFoundError("该文档没有对应原文文件");
  const safeNo = String(document.documentNo).replace(/[^\w.-]+/g, "_").slice(0, 80);
  return deps.storage.createDownloadUrl(objectKey, `${safeNo}${fileNameSuffix}`, 3600);
}

export async function standardRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  const deps: StandardDeps = { db: app.db, storage: app.storage, queues: app.queues };

  // ================================================================ 抓取来源
  route.get("/sources", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询标准抓取来源列表", querystring: z.object({ enabled: z.coerce.boolean().optional() }), response: { 200: arrayResponse(sourceDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listSources(deps, request.query.enabled));
  });

  route.post("/sources", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "新增标准抓取来源", body: sourceCreateSchema, response: { 200: singleResponse(sourceDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.CREATE);
    return ok(request, await createSource(deps, request, actor, request.body));
  });

  route.get("/sources/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询抓取来源详情", params: uuidParams, response: { 200: singleResponse(sourceDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await getSource(deps, request.params.id));
  });

  route.patch("/sources/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "修改抓取来源配置", params: uuidParams, body: sourceUpdateSchema, response: { 200: singleResponse(sourceDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.UPDATE);
    return ok(request, await updateSource(deps, request, actor, request.params.id, request.body));
  });

  route.delete("/sources/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "删除抓取来源（需先停用）", params: uuidParams, response: { 200: messageResponse } }
  }, async (request) => {
    const actor = requirePermission(request, P.DELETE);
    await deleteSource(deps, request, actor, request.params.id);
    return ok(request, { message: "抓取来源已删除" });
  });

  route.post("/sources/:id/crawl", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "手动触发标准站点抓取", params: uuidParams, body: crawlTriggerBodySchema, response: { 200: singleResponse(crawlJobDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.RUN);
    return ok(request, await triggerCrawl(deps, request, actor, request.params.id, request.body.scope));
  });

  // ================================================================ 抓取作业
  route.get("/crawl-jobs", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询抓取作业列表", querystring: crawlJobListQuerySchema, response: { 200: arrayResponse(crawlJobDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listCrawlJobs(deps, request.query.sourceId, request.query.status));
  });

  route.get("/crawl-jobs/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询抓取作业详情", params: uuidParams, response: { 200: singleResponse(crawlJobDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await getCrawlJob(deps, request.params.id));
  });

  // ================================================================ 标准文档（双通道：人工录入 MANUAL + 爬虫 CRAWL）
  route.get("/documents", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询标准文档列表", querystring: documentListQuerySchema, response: { 200: arrayResponse(documentDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listDocuments(deps, request.query));
  });

  route.post("/documents", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "人工录入标准（文档+适用范围+指标组合提交）", body: manualDocumentCreateSchema, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.CREATE);
    return ok(request, await createManualDocument(deps, request, actor, request.body));
  });

  route.get("/documents/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询标准文档详情（含适用范围与指标）", params: uuidParams, response: { 200: singleResponse(documentDto.extend({ applicability: z.array(applicabilityDto), indicators: z.array(indicatorDto) })) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await getDocument(deps, request.params.id));
  });

  route.patch("/documents/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "修改标准文档元数据（仅草稿）", params: uuidParams, body: documentUpdateSchema, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.UPDATE);
    return ok(request, await updateDocument(deps, request, actor, request.params.id, request.body));
  });

  route.delete("/documents/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "删除标准文档（仅草稿）", params: uuidParams, response: { 200: messageResponse } }
  }, async (request) => {
    const actor = requirePermission(request, P.DELETE);
    await deleteDocument(deps, request, actor, request.params.id);
    return ok(request, { message: "标准文档已删除" });
  });

  route.post("/documents/:id/submit", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "提交标准文档审核", params: uuidParams, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await submitDocument(deps, request, actor, request.params.id));
  });

  route.post("/documents/:id/approve", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "通过标准文档审核", params: uuidParams, body: approvalBodySchema, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await approveDocument(deps, request, actor, request.params.id, request.body.approvalNote ?? undefined));
  });

  route.post("/documents/:id/reject", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "驳回标准文档", params: uuidParams, body: rejectBodySchema, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await rejectDocument(deps, request, actor, request.params.id, request.body.rejectReason));
  });

  route.post("/documents/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "发布标准文档（同编号旧版自动停用）", params: uuidParams, response: { 200: singleResponse(documentDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.PUBLISH);
    return ok(request, await publishDocument(deps, request, actor, request.params.id));
  });

  route.get("/documents/:id/file-url", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "获取标准 PDF 附件下载地址", params: uuidParams, response: { 200: singleResponse(z.object({ url: z.string() })) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    const document = await getDocument(deps, request.params.id);
    const url = await buildDocumentObjectUrl(deps, document, document.fileObjectKey, ".pdf");
    return ok(request, { url });
  });

  route.get("/documents/:id/html-url", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "获取标准详情页原文 HTML 下载地址", params: uuidParams, response: { 200: singleResponse(z.object({ url: z.string() })) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    const document = await getDocument(deps, request.params.id);
    const url = await buildDocumentObjectUrl(deps, document, document.pageHtmlObjectKey, ".html");
    return ok(request, { url });
  });

  route.get("/documents/:id/screenshot-url", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "获取标准详情页截图下载地址", params: uuidParams, response: { 200: singleResponse(z.object({ url: z.string() })) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    const document = await getDocument(deps, request.params.id);
    const url = await buildDocumentObjectUrl(deps, document, document.screenshotObjectKey, ".png");
    return ok(request, { url });
  });

  // ================================================================ 适用范围
  route.get("/applicability", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询适用范围列表", querystring: z.object({ documentId: z.uuid("文档 ID 格式不正确").optional(), regionCode: z.string().trim().max(40).optional() }), response: { 200: arrayResponse(applicabilityDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listApplicability(deps, request.query.documentId, request.query.regionCode));
  });

  route.post("/applicability", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "新增适用范围", body: applicabilityCreateSchema, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.CREATE);
    return ok(request, await createApplicability(deps, request, actor, request.body));
  });

  route.patch("/applicability/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "修改适用范围（仅草稿）", params: uuidParams, body: applicabilityUpdateSchema, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.UPDATE);
    return ok(request, await updateApplicability(deps, request, actor, request.params.id, request.body));
  });

  route.delete("/applicability/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "删除适用范围（仅草稿）", params: uuidParams, response: { 200: messageResponse } }
  }, async (request) => {
    const actor = requirePermission(request, P.DELETE);
    await deleteApplicability(deps, request, actor, request.params.id);
    return ok(request, { message: "适用范围已删除" });
  });

  route.post("/applicability/:id/submit", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "提交适用范围审核", params: uuidParams, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await submitApplicability(deps, request, actor, request.params.id));
  });

  route.post("/applicability/:id/approve", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "通过适用范围审核", params: uuidParams, body: approvalBodySchema, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await approveApplicability(deps, request, actor, request.params.id, request.body.approvalNote ?? undefined));
  });

  route.post("/applicability/:id/reject", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "驳回适用范围", params: uuidParams, body: rejectBodySchema, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await rejectApplicability(deps, request, actor, request.params.id, request.body.rejectReason));
  });

  route.post("/applicability/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "发布适用范围", params: uuidParams, response: { 200: singleResponse(applicabilityDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.PUBLISH);
    return ok(request, await publishApplicability(deps, request, actor, request.params.id));
  });

  // ================================================================ 指标
  route.get("/indicators", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询指标列表（不传审核状态默认待审核队列）", querystring: indicatorListQuerySchema, response: { 200: arrayResponse(indicatorDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listIndicators(deps, {
      documentId: request.query.documentId,
      indicatorType: request.query.indicatorType,
      reviewStatus: request.query.reviewStatus ?? "PENDING_REVIEW"
    }));
  });

  route.get("/indicators/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询指标详情", params: uuidParams, response: { 200: singleResponse(indicatorDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await getIndicator(deps, request.params.id));
  });

  route.patch("/indicators/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "人工修正指标（数值/证据引用）", params: uuidParams, body: indicatorUpdateSchema, response: { 200: singleResponse(indicatorDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.UPDATE);
    return ok(request, await updateIndicator(deps, request, actor, request.params.id, request.body));
  });

  route.delete("/indicators/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "删除指标（未发布）", params: uuidParams, response: { 200: messageResponse } }
  }, async (request) => {
    const actor = requirePermission(request, P.DELETE);
    await deleteIndicator(deps, request, actor, request.params.id);
    return ok(request, { message: "指标已删除" });
  });

  route.post("/indicators/:id/approve", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "通过指标审核", params: uuidParams, body: approvalBodySchema, response: { 200: singleResponse(indicatorDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await approveIndicator(deps, request, actor, request.params.id, request.body.approvalNote ?? undefined));
  });

  route.post("/indicators/:id/reject", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "驳回指标", params: uuidParams, body: rejectBodySchema, response: { 200: singleResponse(indicatorDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await rejectIndicator(deps, request, actor, request.params.id, request.body.rejectReason));
  });

  route.post("/indicators/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "发布指标（K 值同事务转换落库 thermal_standard_limits）", params: uuidParams, response: { 200: singleResponse(indicatorDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.PUBLISH);
    return ok(request, await publishIndicator(deps, request, actor, request.params.id));
  });

  // ================================================================ 替代关系
  route.get("/replacements", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询标准替代关系", querystring: replacementListQuerySchema, response: { 200: arrayResponse(replacementDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listReplacements(deps, request.query.status));
  });

  route.post("/replacements", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "新增标准替代关系", body: replacementCreateSchema, response: { 200: singleResponse(replacementDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.CREATE);
    return ok(request, await createReplacement(deps, request, actor, request.body));
  });

  route.delete("/replacements/:id", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "删除替代关系（已确认不可删）", params: uuidParams, response: { 200: messageResponse } }
  }, async (request) => {
    const actor = requirePermission(request, P.DELETE);
    await deleteReplacement(deps, request, actor, request.params.id);
    return ok(request, { message: "替代关系已删除" });
  });

  route.post("/replacements/:id/confirm", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "确认替代关系（旧标准进入过渡期）", params: uuidParams, response: { 200: singleResponse(replacementDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await confirmReplacement(deps, request, actor, request.params.id));
  });

  route.post("/replacements/:id/reject", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "驳回替代关系", params: uuidParams, body: z.object({ reason: z.string().trim().max(2000).optional() }), response: { 200: singleResponse(replacementDto) } }
  }, async (request) => {
    const actor = requirePermission(request, P.APPROVE);
    return ok(request, await rejectReplacement(deps, request, actor, request.params.id, request.body.reason ?? ""));
  });

  // ================================================================ 生效标准查询
  route.get("/standards/effective", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询指定地区指定时点的已发布生效标准", querystring: effectiveStandardsQuerySchema, response: { 200: arrayResponse(effectiveStandardDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listEffectiveStandards(deps, request.query.regionCode, request.query.asOfDate ?? new Date()));
  });

  route.get("/published/indicators", {
    preHandler: [app.authenticate],
    schema: { tags: [STANDARD_TAG], summary: "查询指定地区已发布指标（确定性取数）", querystring: publishedIndicatorQuerySchema, response: { 200: arrayResponse(indicatorDto) } }
  }, async (request) => {
    requirePermission(request, P.LIST);
    return ok(request, await listPublishedIndicators(deps, request.query.regionCode, request.query.indicatorType));
  });
}