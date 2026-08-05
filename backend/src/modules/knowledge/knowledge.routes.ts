import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { KNOWLEDGE_PERMISSIONS } from "../../shared/knowledge-permissions.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import {
  approveVersion,
  completeVersionUpload,
  createAlias,
  createCategory,
  createDocument,
  createDocumentVersion,
  createVersionUploadIntent,
  deleteAlias,
  deleteCategory,
  deleteDocument,
  disableVersion,
  enqueueChunkRebuild,
  enqueueParsing,
  getDocumentDetail,
  listAliases,
  listCategories,
  listChunkTerms,
  listDocuments,
  listParsingJobs,
  listVersionChunks,
  listVersionPages,
  publishVersion,
  rollbackVersion,
  updateAlias,
  updateCategory,
  updateDocument
} from "./knowledge-admin.service.js";
import { searchKnowledge, listSearchLogs } from "./knowledge.service.js";
import { createEvaluation, judgeEvaluation, listEvaluations } from "./knowledge-evaluation.service.js";
import {
  createBatchImportIntents,
  createCrawlerSource,
  deleteCrawlerSource,
  listCrawlerSources,
  listRankingRules,
  runCrawlerSource,
  updateCrawlerSource,
  updateRankingRule,
  type IngestDeps
} from "./knowledge-ingest.service.js";

/** 路由层将 FastifyInstance 收窄为 ingest 服务所需依赖 */
function ingestDeps(app: FastifyInstance): IngestDeps {
  return { db: app.db, storage: app.storage, queues: app.queues };
}

const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });
const versionParams = z.object({ versionId: z.uuid("版本 ID 格式不正确") });
const chunkParams = z.object({ chunkId: z.uuid("分块 ID 格式不正确") });
const rollbackParams = z.object({ id: z.uuid("文档 ID 格式不正确"), versionId: z.uuid("版本 ID 格式不正确") });

const docTypeSchema = z.enum([
  "SPECIFICATION", "DETAIL_ATLAS", "STANDARD", "APPLICATION_GUIDE",
  "MATERIAL_COMPARISON", "COMPANY_PROFILE", "THERMAL_FORMULA", "OTHER"
]);
const evidenceLevelSchema = z.enum(["A", "B", "C"]);
const termTypeSchema = z.enum(["KEYWORD", "SYNONYM", "ENTITY", "CLAUSE_NO"]);
const aliasScopeSchema = z.enum(["GLOBAL", "PROJECT"]);

function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有知识库管理权限");
  }
  return user;
}

export async function knowledgeRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------- 分类

  route.get("/categories", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识分类列表"
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.CATEGORY_LIST);
    return ok(request, { items: await listCategories(app) });
  });

  route.post("/categories", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "新增知识分类",
      body: z.object({
        name: z.string().trim().min(1).max(80),
        code: z.string().trim().min(1).max(40),
        parentId: z.uuid("父分类 ID 格式不正确").optional(),
        sortOrder: z.number().int().optional(),
        description: z.string().trim().max(500).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CATEGORY_CREATE);
    return ok(request, { category: await createCategory(app, request, actor, request.body) });
  });

  route.patch("/categories/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改知识分类",
      params: uuidParams,
      body: z.object({
        name: z.string().trim().min(1).max(80).optional(),
        code: z.string().trim().min(1).max(40).optional(),
        parentId: z.uuid("父分类 ID 格式不正确").nullable().optional(),
        sortOrder: z.number().int().optional(),
        enabled: z.boolean().optional(),
        description: z.string().trim().max(500).nullable().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CATEGORY_UPDATE);
    return ok(request, { category: await updateCategory(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/categories/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除知识分类",
      params: uuidParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CATEGORY_DELETE);
    return ok(request, await deleteCategory(app, request, actor, request.params.id));
  });

  // ---------------------------------------------------------------- 文档

  route.get("/documents", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识文档列表",
      querystring: paginationQuerySchema.extend({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        docType: docTypeSchema.optional(),
        categoryId: z.uuid("分类 ID 格式不正确").optional(),
        keyword: z.string().trim().max(120).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listDocuments(app, { page, pageSize, ...filters }));
  });

  route.post("/documents", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "新增知识文档（元数据，版本与文件另行创建）",
      body: z.object({
        title: z.string().trim().min(1).max(200),
        docType: docTypeSchema.optional(),
        docNumber: z.string().trim().max(80).optional(),
        sourceOrg: z.string().trim().max(120).optional(),
        issueDate: z.string().trim().max(20).optional(),
        effectiveDate: z.string().trim().max(20).optional(),
        evidenceLevel: evidenceLevelSchema.optional(),
        allowedPurposes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        categoryId: z.uuid("分类 ID 格式不正确").optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_CREATE);
    return ok(request, { document: await createDocument(app, request, actor, request.body) });
  });

  route.get("/documents/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识文档详情（含版本列表）",
      params: uuidParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getDocumentDetail(app, request.params.id));
  });

  route.patch("/documents/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改知识文档元数据",
      params: uuidParams,
      body: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        docType: docTypeSchema.optional(),
        docNumber: z.string().trim().max(80).nullable().optional(),
        sourceOrg: z.string().trim().max(120).nullable().optional(),
        issueDate: z.string().trim().max(20).nullable().optional(),
        effectiveDate: z.string().trim().max(20).nullable().optional(),
        evidenceLevel: evidenceLevelSchema.nullable().optional(),
        allowedPurposes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        categoryId: z.uuid("分类 ID 格式不正确").nullable().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, { document: await updateDocument(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/documents/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "软删除知识文档（仅无已发布版本时允许）",
      params: uuidParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_DELETE);
    return ok(request, await deleteDocument(app, request, actor, request.params.id));
  });

  // ---------------------------------------------------------------- 版本

  route.post("/documents/:id/versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "为文档创建新草稿版本",
      params: uuidParams,
      body: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        changeNote: z.string().trim().max(500).optional(),
        evidenceLevel: evidenceLevelSchema.optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, { version: await createDocumentVersion(app, request, actor, request.params.id, request.body) });
  });

  route.post("/versions/:versionId/upload-intent", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "申请版本文件直传凭证",
      params: versionParams,
      body: z.object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(120),
        sizeBytes: z.number().int().positive().max(1_073_741_824),
        sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, "sha256 格式不正确").optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await createVersionUploadIntent(app, request, actor, request.params.versionId, request.body));
  });

  route.post("/versions/:versionId/upload-complete", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "确认版本文件上传完成（校验大小/哈希/类型）",
      params: versionParams,
      body: z.object({
        fileId: z.uuid("文件 ID 格式不正确")
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await completeVersionUpload(app, request, actor, request.params.versionId, request.body.fileId));
  });

  route.post("/versions/:versionId/parse", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "发起版本解析（PARSE）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    return ok(request, await enqueueParsing(app, request, actor, request.params.versionId, "PARSE"));
  });

  route.post("/versions/:versionId/reparse", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "发起版本重新解析（REPARSE，仅非发布版本）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    return ok(request, await enqueueParsing(app, request, actor, request.params.versionId, "REPARSE"));
  });

  route.post("/versions/:versionId/chunks/rebuild", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "基于已有页面原文重建分块（不重读文件）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    return ok(request, await enqueueChunkRebuild(app, request, actor, request.params.versionId));
  });

  route.post("/versions/:versionId/approve", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "审核通过版本（要求解析完成）",
      params: versionParams,
      body: z.object({
        approvalNote: z.string().trim().max(500).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_APPROVE);
    return ok(request, await approveVersion(app, request, actor, request.params.versionId, request.body.approvalNote));
  });

  route.post("/versions/:versionId/publish", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "发布版本为当前受控版本（同文档其他已发布版本自动停用）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PUBLISH);
    return ok(request, await publishVersion(app, request, actor, request.params.versionId));
  });

  route.post("/versions/:versionId/disable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "停用已发布版本（文档受控版本置空）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PUBLISH);
    return ok(request, await disableVersion(app, request, actor, request.params.versionId));
  });

  route.post("/documents/:id/rollback-to/:versionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "版本替代：从已发布/已停用历史版本复制为新草稿",
      params: rollbackParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PUBLISH);
    return ok(request, await rollbackVersion(app, request, actor, request.params.id, request.params.versionId));
  });

  // ---------------------------------------------------------------- 内容查看

  route.get("/versions/:versionId/pages", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看版本页面列表（审核/调试用）",
      params: versionParams,
      querystring: paginationQuerySchema
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await listVersionPages(app, request.params.versionId, request.query.page, request.query.pageSize));
  });

  route.get("/versions/:versionId/chunks", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看版本分块列表（含关键词/别名/锚点）",
      params: versionParams,
      querystring: paginationQuerySchema.extend({
        contentType: z.enum([
          "PARAGRAPH", "TITLE", "SECTION", "CLAUSE", "TABLE", "NOTE", "FORMULA", "IMAGE_CAPTION"
        ]).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listVersionChunks(app, request.params.versionId, page, pageSize, filters.contentType));
  });

  route.get("/chunks/:chunkId/terms", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看分块术语命中（审核/调试用）",
      params: chunkParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, { items: await listChunkTerms(app, request.params.chunkId) });
  });

  // ---------------------------------------------------------------- 检索与日志

  route.get("/search", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "检索知识库（仅已发布版本；记录检索日志）",
      querystring: z.object({
        query: z.string().trim().min(1).max(500),
        docType: docTypeSchema.optional(),
        categoryId: z.uuid("分类 ID 格式不正确").optional(),
        projectId: z.uuid("项目 ID 格式不正确").optional(),
        region: z.string().trim().max(80).optional(),
        purpose: z.string().trim().max(50).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(10)
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await searchKnowledge(app, request, actor, request.query));
  });

  route.get("/search-logs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识检索日志",
      querystring: paginationQuerySchema.extend({
        keyword: z.string().trim().max(120).optional(),
        userId: z.uuid("用户 ID 格式不正确").optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.SEARCH_LOG_LIST);
    return ok(request, await listSearchLogs(app, request.query));
  });

  route.get("/parsing-jobs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询解析任务列表",
      querystring: paginationQuerySchema.extend({
        documentId: z.uuid("文档 ID 格式不正确").optional(),
        versionId: z.uuid("版本 ID 格式不正确").optional(),
        status: z.enum(["QUEUED", "ACTIVE", "COMPLETED", "FAILED", "OCR_REQUIRED"]).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listParsingJobs(app, { page, pageSize, ...filters }));
  });

  // ---------------------------------------------------------------- 别名

  route.get("/aliases", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询别名词典列表",
      querystring: paginationQuerySchema.extend({
        term: z.string().trim().max(80).optional(),
        alias: z.string().trim().max(80).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.ALIAS_LIST);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listAliases(app, { page, pageSize, ...filters }));
  });

  route.post("/aliases", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "新增别名词条",
      body: z.object({
        term: z.string().trim().min(1).max(80),
        alias: z.string().trim().min(1).max(80),
        termType: termTypeSchema.optional(),
        scope: aliasScopeSchema.optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.ALIAS_CREATE);
    return ok(request, { alias: await createAlias(app, request, actor, request.body) });
  });

  route.patch("/aliases/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改别名词条",
      params: uuidParams,
      body: z.object({
        term: z.string().trim().min(1).max(80).optional(),
        alias: z.string().trim().min(1).max(80).optional(),
        termType: termTypeSchema.optional(),
        scope: aliasScopeSchema.optional(),
        enabled: z.boolean().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.ALIAS_UPDATE);
    return ok(request, { alias: await updateAlias(app, request, actor, request.params.id, request.body) });
  });

  route.delete("/aliases/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除别名词条",
      params: uuidParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.ALIAS_DELETE);
    return ok(request, await deleteAlias(app, request, actor, request.params.id));
  });

  // ---------------------------------------------------------------- 批量导入

  const batchImportItemSchema = z.object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().positive().max(1_073_741_824),
    sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, "sha256 格式不正确").optional(),
    title: z.string().trim().min(1).max(200).optional(),
    docType: docTypeSchema.optional(),
    categoryId: z.uuid("分类 ID 格式不正确").optional(),
    changeNote: z.string().trim().max(500).optional()
  });

  route.post("/imports/batch", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "批量导入（逐项创建文档与草稿版本，返回预签名上传地址；直传后复用 upload-complete 确认）",
      body: z.object({ items: z.array(batchImportItemSchema).min(1).max(100) })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await createBatchImportIntents(ingestDeps(app), request, actor, request.body.items));
  });

  // ---------------------------------------------------------------- 抓取源

  const crawlerSourceParams = z.object({ sourceId: z.uuid("抓取源 ID 格式不正确") });

  route.get("/crawler-sources", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询抓取源列表",
      querystring: z.object({
        enabled: z.enum(["true", "false"]).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_LIST);
    return ok(request, {
      items: await listCrawlerSources(ingestDeps(app), request.query.enabled === undefined ? undefined : request.query.enabled === "true")
    });
  });

  route.post("/crawler-sources", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "新增抓取源（站点下载规则，抓取结果默认待审核）",
      body: z.object({
        name: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().min(1).max(500),
        downloadUrlPattern: z.string().trim().min(1).max(500),
        docType: docTypeSchema.optional(),
        enabled: z.boolean().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_CREATE);
    return ok(request, { source: await createCrawlerSource(ingestDeps(app), request, actor, request.body) });
  });

  route.patch("/crawler-sources/:sourceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改抓取源",
      params: crawlerSourceParams,
      body: z.object({
        name: z.string().trim().min(1).max(120).optional(),
        baseUrl: z.string().trim().min(1).max(500).optional(),
        downloadUrlPattern: z.string().trim().min(1).max(500).optional(),
        docType: docTypeSchema.optional(),
        enabled: z.boolean().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_UPDATE);
    return ok(request, { source: await updateCrawlerSource(ingestDeps(app), request, actor, request.params.sourceId, request.body) });
  });

  route.delete("/crawler-sources/:sourceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除抓取源",
      params: crawlerSourceParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_DELETE);
    return ok(request, await deleteCrawlerSource(ingestDeps(app), request, actor, request.params.sourceId));
  });

  route.post("/crawler-sources/:sourceId/run", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "手动触发抓取（下载 → 去重 → 入库 → 投递解析）",
      params: crawlerSourceParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_RUN);
    return ok(request, await runCrawlerSource(ingestDeps(app), request, request.params.sourceId));
  });

  // ---------------------------------------------------------------- 检索排序规则

  const rankingRuleParams = z.object({ key: z.string().trim().min(1).max(80) });

  route.get("/ranking-rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询检索排序规则（权重与启用状态）"
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.RANKING_LIST);
    return ok(request, { items: await listRankingRules(ingestDeps(app)) });
  });

  route.patch("/ranking-rules/:key", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改检索排序规则权重",
      params: rankingRuleParams,
      body: z.object({
        weight: z.number().min(0).max(1000).optional(),
        enabled: z.boolean().optional(),
        description: z.string().trim().max(200).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.RANKING_UPDATE);
    return ok(request, { rule: await updateRankingRule(ingestDeps(app), request, actor, request.params.key, request.body) });
  });

  // ---------------------------------------------------------------- 检索评测

  const evaluationParams = z.object({ id: z.uuid("评测 ID 格式不正确") });
  const judgementSchema = z.enum(["APPROVED", "REJECTED", "PARTIAL"]);

  route.post("/evaluations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "提交检索评测（立即执行检索并保存实际结果）",
      body: z.object({
        query: z.string().trim().min(1).max(500),
        expectedDocumentId: z.uuid("期望文档 ID 格式不正确").optional(),
        expectedPage: z.number().int().positive().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.EVAL_CREATE);
    return ok(request, { evaluation: await createEvaluation(app, request, actor, request.body) });
  });

  route.get("/evaluations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询检索评测列表（分页 + 判定状态过滤）",
      querystring: paginationQuerySchema.extend({
        judgement: z.enum(["PENDING", "APPROVED", "REJECTED", "PARTIAL", "ALL"]).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.EVAL_LIST);
    return ok(request, await listEvaluations(app, request.query));
  });

  route.post("/evaluations/:id/judge", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "人工判定检索评测结果",
      params: evaluationParams,
      body: z.object({
        judgement: judgementSchema,
        note: z.string().trim().max(500).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.EVAL_JUDGE);
    return ok(request, { evaluation: await judgeEvaluation(app, request, actor, request.params.id, request.body) });
  });
}