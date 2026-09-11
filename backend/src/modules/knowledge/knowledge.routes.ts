import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { KNOWLEDGE_PERMISSIONS } from "../../shared/knowledge-permissions.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { requireClient } from "../../shared/client-guard.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
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
  deleteDocumentVersion,
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
  updateChunkMetadata,
  splitChunk,
  mergeChunks,
  updateDocument
} from "./knowledge-admin.service.js";
import { searchKnowledge, sanitizeSearchHit, listSearchLogs } from "./knowledge.service.js";
import {
  deleteTocItem,
  deleteVersionAsset,
  enqueueUpgradeParse,
  listVersionAssets,
  listVersionPageMappings,
  listVersionToc,
  remapVersionToc,
  reorderVersionToc,
  replaceVersionToc,
  updateTocItem,
  updateVersionAsset,
  updateVersionPage,
  updateVersionUsageMode,
  verifyVersionPageMappings
} from "./knowledge-original.service.js";
import { createEvaluation, judgeEvaluation, listEvaluations } from "./knowledge-evaluation.service.js";
import { getPublicDocumentDetail, getPublicDocumentPage, getPublicDocumentToc, getVersionPageWindow, listDocumentSections, listPublicDocuments } from "./knowledge-wiki-read.service.js";
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
import {
  createKnowledgeWithFile,
  getDocumentWorkspace,
  listVersionChapterTree,
  replaceDocumentFile,
  streamVersionTestQa
} from "./knowledge-workflow.service.js";
import { KNOWLEDGE_USER_STATUSES } from "./knowledge-user-status.js";

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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识分类列表"
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.CATEGORY_LIST);
    return ok(request, { items: await listCategories(app) });
  });

  route.post("/categories", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识文档列表",
      querystring: paginationQuerySchema.extend({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        docType: docTypeSchema.optional(),
        categoryId: z.uuid("分类 ID 格式不正确").optional(),
        keyword: z.string().trim().max(120).optional(),
        healthStatus: z.enum(["NEEDS_ACTION", "READY", "BROWSE_ONLY", "PUBLISHED", "PENDING_REVIEW"]).optional(),
        userStatus: z.enum(KNOWLEDGE_USER_STATUSES).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listDocuments(app, { page, pageSize, ...filters }));
  });

  route.post("/documents", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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

  route.post("/documents/create-with-file", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "一次创建知识文档、v1 并自动发起解析（只收 fileId）",
      body: z.object({
        title: z.string().trim().min(1).max(200),
        docType: docTypeSchema,
        originalFileId: z.uuid("正式文件 ID 格式不正确"),
        searchSourceFileId: z.uuid("检索文件 ID 格式不正确").nullable().optional(),
        categoryId: z.uuid("分类 ID 格式不正确").nullable().optional(),
        docNumber: z.string().trim().max(80).nullable().optional(),
        sourceOrg: z.string().trim().max(120).nullable().optional(),
        issueDate: z.string().trim().max(20).nullable().optional(),
        effectiveDate: z.string().trim().max(20).nullable().optional(),
        evidenceLevel: evidenceLevelSchema.nullable().optional(),
        allowedPurposes: z.array(z.string().trim().min(1).max(40)).max(20).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_CREATE);
    return ok(request, await createKnowledgeWithFile(app, request, actor, request.body));
  });

  route.get("/documents/:id", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询知识文档详情（含版本列表）",
      params: uuidParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getDocumentDetail(app, request.params.id));
  });

  route.get("/documents/:id/workspace", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "知识文档用户态摘要（工作版本、解析任务、可操作动作）",
      params: uuidParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getDocumentWorkspace(app, actor, request.params.id));
  });

  route.post("/documents/:id/replace-file", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "更换文件：新建下一版本并自动解析（不破坏旧版本）",
      params: uuidParams,
      body: z.object({
        originalFileId: z.uuid("正式文件 ID 格式不正确"),
        searchSourceFileId: z.uuid("检索文件 ID 格式不正确").nullable().optional(),
        changeNote: z.string().trim().max(500).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await replaceDocumentFile(app, request, actor, request.params.id, request.body));
  });

  route.patch("/documents/:id", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "为文档创建新草稿版本（可直接从文件中心指定正式文件/AI 识别文件）",
      params: uuidParams,
      body: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        changeNote: z.string().trim().max(500).optional(),
        evidenceLevel: evidenceLevelSchema.optional(),
        // FilePicker：直接复用文件中心已有文件（两者可传同一个 fileId）
        originalFileId: z.uuid("正式文件 ID 格式不正确").optional(),
        searchSourceFileId: z.uuid("AI 识别文件 ID 格式不正确").optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, { version: await createDocumentVersion(app, request, actor, request.params.id, request.body) });
  });

  route.post("/versions/:versionId/upload-intent", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "申请版本文件直传凭证（提供 existingFileId 时直接复用文件中心已有文件）",
      params: versionParams,
      body: z.object({
        fileName: z.string().trim().min(1).max(255).optional(),
        mimeType: z.string().trim().min(1).max(120).optional(),
        sizeBytes: z.number().int().positive().max(1_073_741_824).optional(),
        sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, "sha256 格式不正确").optional(),
        // FilePicker：从文件中心选择已有文件（不重新上传 OSS）
        existingFileId: z.uuid("文件 ID 格式不正确").optional(),
        // 缺省 = ORIGINAL（版本主文件）；SEARCH_SOURCE/OCR_SOURCE 允许绑定到任意未停用版本
        assetRole: z.enum(["ORIGINAL", "SEARCH_SOURCE", "OCR_SOURCE", "PREVIEW"]).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await createVersionUploadIntent(app, request, actor, request.params.versionId, request.body, request.body.assetRole));
  });

  route.post("/versions/:versionId/upload-complete", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "确认版本文件上传完成（校验大小/哈希/类型；文件中心 READY 文件直接绑定）",
      params: versionParams,
      body: z.object({
        fileId: z.uuid("文件 ID 格式不正确"),
        assetRole: z.enum(["ORIGINAL", "SEARCH_SOURCE", "OCR_SOURCE", "PREVIEW"]).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPLOAD);
    return ok(request, await completeVersionUpload(app, request, actor, request.params.versionId, request.body.fileId, request.body.assetRole));
  });

  route.post("/versions/:versionId/parse", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "发起版本重新解析（REPARSE，仅非发布版本）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    return ok(request, await enqueueParsing(app, request, actor, request.params.versionId, "REPARSE"));
  });

  route.post("/versions/:versionId/test-qa", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "当前版本 AI 检索测试问答（SSE，仅检索该 versionId，允许草稿）",
      params: versionParams,
      body: z.object({
        query: z.string().trim().min(1, "请输入问题").max(500, "问题不能超过 500 个字符"),
        reasoningMode: z.enum(["OFF", "ON"]).default("OFF"),
        limit: z.coerce.number().int().min(1).max(10).default(5)
      })
    }
  }, async (request, reply) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_TEST);
    await streamVersionTestQa(app, request, reply, actor, request.params.versionId, request.body);
  });

  route.post("/versions/:versionId/chunks/rebuild", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "版本替代：从已发布/已停用历史版本复制为新草稿",
      params: rollbackParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PUBLISH);
    return ok(request, await rollbackVersion(app, request, actor, request.params.id, request.params.versionId));
  });

  route.delete("/versions/:versionId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除草稿版本（仅 DRAFT；级联清理页面/分块/术语/引用/解析任务与源文件）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_DELETE);
    return ok(request, await deleteDocumentVersion(app, request, actor, request.params.versionId));
  });

  // ---------------------------------------------------------------- 内容查看

  route.get("/versions/:versionId/pages", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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

  route.get("/versions/:versionId/pages/window", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看版本当前页与相邻页面窗口（当前页完整、邻页轻量）",
      params: versionParams,
      querystring: z.object({
        center: z.coerce.number().int().min(1, "中心物理页码必须大于 0"),
        before: z.coerce.number().int().min(0).max(10).default(2),
        after: z.coerce.number().int().min(0).max(10).default(2)
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getVersionPageWindow(
      app,
      request.params.versionId,
      request.query.center,
      request.query.before,
      request.query.after
    ));
  });

  // 版本 Wiki 章节树（扁平有序，前端按 parentId/level 组树）：按版本读取，
  // DRAFT 审核与 PUBLISHED 阅读共用；与 C 端公开文库/AI 来源详情共用同一读取服务。
  route.get("/versions/:versionId/sections", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看版本 Wiki 章节树（扁平有序，按 parentId/level 组树）",
      params: versionParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, { sections: await listDocumentSections(app, request.params.versionId) });
  });

  route.get("/versions/:versionId/chapter-tree", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "用户可读章节树（已确认 TOC 优先，否则语义章节）",
      params: versionParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await listVersionChapterTree(app, request.params.versionId));
  });

  route.get("/versions/:versionId/chunks", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DEBUG);
    const { page, pageSize, ...filters } = request.query;
    return ok(request, await listVersionChunks(app, request.params.versionId, page, pageSize, filters.contentType));
  });

  route.get("/chunks/:chunkId/terms", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查看分块术语命中（审核/调试用）",
      params: chunkParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DEBUG);
    return ok(request, { items: await listChunkTerms(app, request.params.chunkId) });
  });

  // ---------------------------------------------------------------- 分块人工干预

  route.patch("/chunks/:chunkId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "人工调整分块元数据（标题路径/关键词/锚点/标注/标记错误切片，仅未发布版本）",
      params: chunkParams,
      body: z.object({
        keywords: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
        heading: z.string().trim().max(255).nullable().optional(),
        headingLevel: z.number().int().min(0).max(6).optional(),
        citationAnchor: z.string().trim().max(255).nullable().optional(),
        annotation: z.string().trim().max(1000).nullable().optional(),
        invalid: z.boolean().optional(),
        invalidReason: z.string().trim().max(500).nullable().optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DEBUG);
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CHUNK_EDIT);
    return ok(request, { chunk: await updateChunkMetadata(app, request, actor, request.params.chunkId, request.body) });
  });

  route.post("/chunks/:chunkId/split", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "按内容字符位置拆分分块（TABLE 结构化分块禁止拆分，仅未发布版本）",
      params: chunkParams,
      body: z.object({
        at: z.number().int().min(1),
        heading: z.string().trim().max(255).optional()
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DEBUG);
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CHUNK_SPLIT);
    return ok(request, await splitChunk(app, request, actor, request.params.chunkId, request.body.at, request.body.heading));
  });

  route.post("/chunks/:chunkId/merge", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "把当前分块并入目标分块（TABLE 结构化分块禁止合并，仅未发布版本）",
      params: chunkParams,
      body: z.object({
        intoChunkId: z.uuid("目标分块 ID 格式不正确")
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DEBUG);
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CHUNK_MERGE);
    return ok(request, { chunk: await mergeChunks(app, request, actor, request.params.chunkId, request.body.intoChunkId) });
  });

  // ---------------------------------------------------------------- 公开文库（B 端只读）

  // B 端公开文库列表：与 C 端 `/client/knowledge/documents` 复用同一 listPublicDocuments 读取口径
  // （visibility=PUBLIC + 当前版本 PUBLISHED + 生效中），仅开放给平台侧按 DOC_LIST 授权的运营人员。
  const publicDocumentListQuerySchema = paginationQuerySchema.extend({
    categoryId: z.uuid("分类 ID 格式不正确").optional(),
    docType: docTypeSchema.optional(),
    keyword: z.string().trim().max(120, "关键词不能超过 120 个字符").optional(),
    sort: z.enum(["latest", "title"]).default("latest")
  });

  route.get("/public/documents", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "公开文库文档列表（仅 PUBLIC + PUBLISHED + 生效中，与 C 端公开文库同一读取口径）",
      querystring: publicDocumentListQuerySchema
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    const result = await listPublicDocuments(app, request.query);
    return ok(request, {
      items: result.items,
      total: result.total,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.get("/public/documents/:documentId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "公开文库文档详情与章节树（核验用）",
      params: z.object({ documentId: z.uuid("文档 ID 格式不正确") })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getPublicDocumentDetail(app, request.params.documentId));
  });

  route.get("/public/documents/:documentId/toc", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "公开文库原文目录（核验用）",
      params: z.object({ documentId: z.uuid("文档 ID 格式不正确") })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await getPublicDocumentToc(app, request.params.documentId));
  });

  route.get("/public/documents/:documentId/pages/:physicalPageNumber", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "公开文库原文物理页（核验用）",
      params: z.object({
        documentId: z.uuid("文档 ID 格式不正确"),
        physicalPageNumber: z.coerce.number().int().min(1)
      })
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, { page: await getPublicDocumentPage(app, request.params.documentId, request.params.physicalPageNumber) });
  });

  // ---------------------------------------------------------------- 检索与日志

  route.get("/search", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    const result = await searchKnowledge(app, request, actor, request.query);
    const debugEnabled = actor.role === "SUPER_ADMIN" || (actor.permissionCodes ?? []).includes(KNOWLEDGE_PERMISSIONS.DEBUG);
    return ok(request, { ...result, items: result.items.map((item) => sanitizeSearchHit(item, debugEnabled)) });
  });

  route.get("/search-logs", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "新增抓取源（站点下载规则，抓取结果默认待审核）",
      body: z.object({
        name: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().min(1).max(500),
        downloadUrlPattern: z.string().trim().min(1).max(500),
        docType: docTypeSchema.optional(),
        enabled: z.boolean().optional(),
        operatorRemark: z.string().trim().max(1000, "人工备注不能超过 1000 个字符").nullable().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_CREATE);
    return ok(request, { source: await createCrawlerSource(ingestDeps(app), request, actor, request.body) });
  });

  route.patch("/crawler-sources/:sourceId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "修改抓取源",
      params: crawlerSourceParams,
      body: z.object({
        name: z.string().trim().min(1).max(120).optional(),
        baseUrl: z.string().trim().min(1).max(500).optional(),
        downloadUrlPattern: z.string().trim().min(1).max(500).optional(),
        docType: docTypeSchema.optional(),
        enabled: z.boolean().optional(),
        operatorRemark: z.string().trim().max(1000, "人工备注不能超过 1000 个字符").nullable().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.CRAWLER_UPDATE);
    return ok(request, { source: await updateCrawlerSource(ingestDeps(app), request, actor, request.params.sourceId, request.body) });
  });

  route.delete("/crawler-sources/:sourceId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询检索排序规则（权重与启用状态）"
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.RANKING_LIST);
    return ok(request, { items: await listRankingRules(ingestDeps(app)) });
  });

  route.patch("/ranking-rules/:key", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
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

  // ================================================================ 原文档导航：双源资产 / 原文 TOC / 页面维护（2026-08）

  const assetParams = versionParams.extend({ assetId: z.uuid("资产 ID 格式不正确") });
  const tocParams = z.object({ tocId: z.uuid("目录条目 ID 格式不正确") });

  route.get("/versions/:versionId/assets", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询版本文件资产（ORIGINAL 展示原文件 / SEARCH_SOURCE 检索文本源）",
      params: versionParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await listVersionAssets(app, request.params.versionId));
  });

  route.patch("/versions/:versionId/assets/:assetId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "更新文件资产（主源标记）",
      params: assetParams,
      body: z.object({ isPrimary: z.boolean().optional() })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, { asset: await updateVersionAsset(app, request, actor, request.params.versionId, request.params.assetId, request.body) });
  });

  route.delete("/versions/:versionId/assets/:assetId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除文件资产（ORIGINAL 不可删除）",
      params: assetParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await deleteVersionAsset(app, request, actor, request.params.versionId, request.params.assetId));
  });

  route.get("/versions/:versionId/toc", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询原文目录（TOC，含自动识别初稿与人工校正状态）",
      params: versionParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await listVersionToc(app, request.params.versionId));
  });

  route.post("/versions/:versionId/toc", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "保存原文目录（整表替换；confirm=true 直接置为已确认）",
      params: versionParams,
      body: z.object({
        confirm: z.boolean().default(false),
        items: z.array(z.object({
          title: z.string().trim().min(1, "目录标题不能为空").max(255),
          pageLabel: z.string().trim().max(32, "页码标签不能超过 32 个字符").nullable().optional(),
          physicalPageNumber: z.number().int().min(1).nullable().optional(),
          parentId: z.uuid("父条目 ID 格式不正确").nullable().optional(),
          level: z.number().int().min(1).max(6).optional(),
          source: z.enum(["PDF_BOOKMARK", "TOC_PAGE", "MANUAL", "COMPANION_FILE"]).optional(),
          sectionId: z.uuid("章节 ID 格式不正确").nullable().optional()
        })).max(2000, "目录条目不能超过 2000 条")
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await replaceVersionToc(app, request, actor, request.params.versionId, request.body.items, { confirm: request.body.confirm }));
  });

  route.patch("/toc/:tocId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "人工校正目录条目（标题/页码/物理页/关联章节/确认状态）",
      params: tocParams,
      body: z.object({
        title: z.string().trim().min(1).max(255).optional(),
        pageLabel: z.string().trim().max(32).nullable().optional(),
        physicalPageNumber: z.number().int().min(1).nullable().optional(),
        sectionId: z.uuid("章节 ID 格式不正确").nullable().optional(),
        status: z.enum(["DRAFT", "PENDING_REVIEW", "CONFIRMED"]).optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, { item: await updateTocItem(app, request, actor, request.params.tocId, request.body) });
  });

  route.delete("/toc/:tocId", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "删除目录条目",
      params: tocParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await deleteTocItem(app, request, actor, request.params.tocId));
  });

  route.post("/versions/:versionId/toc/reorder", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "目录重排（按提交顺序更新 sortOrder）",
      params: versionParams,
      body: z.object({
        items: z.array(z.object({
          id: z.uuid("目录条目 ID 格式不正确"),
          sortOrder: z.number().int().min(0),
          parentId: z.uuid("父条目 ID 格式不正确").nullable().optional(),
          level: z.number().int().min(1).max(6).optional()
        })).max(2000)
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await reorderVersionToc(app, request, actor, request.params.versionId, request.body.items));
  });

  route.post("/versions/:versionId/toc/remap", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "目录重映射（按 pageLabel 回填物理页，按标题回链语义章节）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await remapVersionToc(app, request, actor, request.params.versionId));
  });

  route.get("/versions/:versionId/page-mappings", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "查询检索页到原文页映射（人工核验状态）",
      params: versionParams
    }
  }, async (request) => {
    requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_LIST);
    return ok(request, await listVersionPageMappings(app, request.params.versionId));
  });

  route.put("/versions/:versionId/page-mappings/verify", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "人工核验/修正页面映射（MANUAL，verified=true）",
      params: versionParams,
      body: z.object({
        mappings: z.array(z.object({
          searchPhysicalPageNumber: z.number().int().min(1),
          originalPhysicalPageNumber: z.number().int().min(1),
          pageLabel: z.string().trim().max(32).nullable().optional()
        })).min(1, "请提交至少一条映射").max(2000)
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, await verifyVersionPageMappings(app, request, actor, request.params.versionId, request.body));
  });

  route.patch("/versions/:versionId/pages/:physicalPageNumber", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "人工维护页面印刷页码/页面标题（A1/A5/D16 等非数字页码）",
      params: versionParams.extend({ physicalPageNumber: z.coerce.number().int().min(1, "物理页序号从 1 开始") }),
      body: z.object({
        pageLabel: z.string().trim().max(32, "页码标签不能超过 32 个字符").nullable().optional(),
        pageTitle: z.string().trim().max(255, "页面标题不能超过 255 个字符").nullable().optional()
      })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, { page: await updateVersionPage(app, request, actor, request.params.versionId, request.params.physicalPageNumber, request.body) });
  });

  route.patch("/versions/:versionId/usage-mode", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "设置版本用途（AI_ENABLED 进入 AI 检索 / BROWSE_ONLY 仅浏览原文）",
      params: versionParams,
      body: z.object({ usageMode: z.enum(["AI_ENABLED", "BROWSE_ONLY"]) })
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_UPDATE);
    return ok(request, { version: await updateVersionUsageMode(app, request, actor, request.params.versionId, request.body.usageMode) });
  });

  route.post("/versions/:versionId/upgrade-parse", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: {
      tags: ["B端 / 平台 / 知识库"],
      summary: "升级解析（重读 ORIGINAL+检索源，重建内容/预览/TOC 草稿；已发布版本保留状态）",
      params: versionParams
    }
  }, async (request) => {
    const actor = requirePermission(request, KNOWLEDGE_PERMISSIONS.DOC_PARSE);
    return ok(request, await enqueueUpgradeParse(app, request, actor, request.params.versionId));
  });
}