import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { getCurrentUser } from "../../shared/current-user.js";import { requireClient } from "../../shared/client-guard.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { ok } from "../../shared/response.js";
import {
  getPublicDocumentDetail,
  getPublicDocumentPage,
  listPublicDocuments,
  listPublicDocumentPages
} from "./knowledge-wiki-read.service.js";

/**
 * C 端公开文库只读接口（Wiki 式文档浏览）：
 * 只暴露 visibility=PUBLIC + 版本 PUBLISHED + 生效中的知识文档；
 * 与 AI 来源详情共用同一 Wiki 文档/章节/页面读取服务，不写第二套逻辑。
 */
export async function knowledgeClientRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const clientGuard = [app.authenticate, requireClient(AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI)] as const;

  const documentListQuerySchema = paginationQuerySchema.extend({
    categoryId: z.uuid("分类 ID 格式不正确").optional(),
    docType: z.enum([
      "SPECIFICATION", "DETAIL_ATLAS", "STANDARD", "APPLICATION_GUIDE",
      "MATERIAL_COMPARISON", "COMPANY_PROFILE", "THERMAL_FORMULA", "OTHER"
    ]).optional(),
    keyword: z.string().trim().max(120, "关键词不能超过 120 个字符").optional(),
    sort: z.enum(["latest", "title"]).default("latest")
  });

  const documentParamsSchema = z.object({ documentId: z.uuid("文档 ID 格式不正确") });
  const pageParamsSchema = documentParamsSchema.extend({
    pageNumber: z.coerce.number().int().min(0, "页码不能为负数")
  });
  const pageListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  });

  route.get("/knowledge/documents", {
    preHandler: [...clientGuard],
    schema: {
      tags: ["C端 / 公开文库"],
      summary: "公开文库文档列表（仅 PUBLIC + PUBLISHED + 生效中）",
      querystring: documentListQuerySchema
    }
  }, async (request) => {
    getCurrentUser(request);
    const result = await listPublicDocuments(app, {
      categoryId: request.query.categoryId,
      docType: request.query.docType,
      keyword: request.query.keyword,
      sort: request.query.sort,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
    return ok(request, {
      items: result.items,
      total: result.total,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.get("/knowledge/documents/:documentId", {
    preHandler: [...clientGuard],
    schema: {
      tags: ["C端 / 公开文库"],
      summary: "公开文库文档详情（元信息 + Wiki 章节树）",
      params: documentParamsSchema
    }
  }, async (request) => {
    getCurrentUser(request);
    const detail = await getPublicDocumentDetail(app, request.params.documentId);
    return ok(request, detail);
  });

  route.get("/knowledge/documents/:documentId/pages", {
    preHandler: [...clientGuard],
    schema: {
      tags: ["C端 / 公开文库"],
      summary: "公开文库页面列表（分页）",
      params: documentParamsSchema,
      querystring: pageListQuerySchema
    }
  }, async (request) => {
    getCurrentUser(request);
    const result = await listPublicDocumentPages(
      app,
      request.params.documentId,
      request.query.page,
      request.query.pageSize
    );
    return ok(request, result);
  });

  route.get("/knowledge/documents/:documentId/pages/:pageNumber", {
    preHandler: [...clientGuard],
    schema: {
      tags: ["C端 / 公开文库"],
      summary: "公开文库单页完整内容（fullText + 内容块）",
      params: pageParamsSchema
    }
  }, async (request) => {
    getCurrentUser(request);
    const page = await getPublicDocumentPage(app, request.params.documentId, request.params.pageNumber);
    return ok(request, { page });
  });
}
