import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { resolveSourceDetail } from "../knowledge/knowledge-wiki-read.service.js";
import { readPageImageBytes } from "../knowledge/knowledge-page-image.js";
import { compareKnowledgeSelections } from "./knowledge-option-compare.service.js";
import { canViewProject } from "../../shared/permissions.js";
import { projects } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { AiError } from "../../shared/ai-errors.js";

/**
 * AI 来源详情（Wiki 原文阅读 + 页面高亮）：
 * 用户点击 AI source 后，经 sectionId/pageId/blockId/chunkId 任一定位入口，
 * 回到 文档 → 章节路径 → 完整页 → 本次命中区域高亮。
 * 只允许读取 PUBLISHED 且生效中的知识版本；项目内文档执行项目可见性守卫。
 */
export async function aiKnowledgeRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /**
   * 知识库只读比较：仅读取已确认、已发布、当前有权访问的图集构造/热工档位。
   * 不写 solution_state、不发布候选、不开 Confirm/Final/Snapshot/PDF。
   */
  const compareBodySchema = z.object({
    projectId: z.uuid("项目 ID 格式不正确").optional(),
    selections: z.array(z.object({
      pageId: z.uuid("页面 ID 格式不正确"),
      constructionCode: z.string().trim().max(64).optional(),
      constructionLabel: z.string().trim().max(120).optional(),
      thicknessMm: z.number().finite("厚度必须是数值").nullable().optional(),
      confirmedRevision: z.string().regex(/^[a-f0-9]{24}$/).optional()
    })).min(2, "请至少选择两个档位").max(6, "一次最多比较六个档位")
  });
  route.post("/options/compare", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 知识溯源"], summary: "知识库档位只读比较（不产生候选、不写方案状态）", body: compareBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const projectId = request.body.projectId ?? null;
    if (projectId) {
      const [project] = await app.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project || !canViewProject(user, project)) throw new AiError("AI_CONVERSATION_FORBIDDEN", "无权在该项目下比较资料");
    }
    const result = await compareKnowledgeSelections(app, {
      projectId,
      selections: request.body.selections.map(item => ({ pageId: item.pageId, constructionCode: item.constructionCode ?? null,
        constructionLabel: item.constructionLabel ?? null, thicknessMm: item.thicknessMm ?? null,
        confirmedRevision: item.confirmedRevision ?? null }))
    });
    return ok(request, result);
  });
  route.get("/pages/:pageId/image", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 知识溯源"], summary: "经当前来源权限核验读取原始页图（原字节，不缓存授权）",
      params: z.object({ pageId: z.uuid() }), querystring: z.object({ confirmedRevision: z.string().regex(/^[a-f0-9]{24}$/).optional() }) }
  }, async (request, reply) => {
    await resolveSourceDetail(app, getCurrentUser(request), { pageId: request.params.pageId });
    const image = await readPageImageBytes(app, request.params.pageId, request.query.confirmedRevision);
    return reply.type(image.contentType).header("Content-Disposition", "inline").header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff").send(image.bytes);
  });

  const sourceDetailQuerySchema = z.object({
    documentId: z.uuid("文档 ID 格式不正确").optional(),
    sectionId: z.uuid("章节 ID 格式不正确").optional(),
    pageId: z.uuid("页面 ID 格式不正确").optional(),
    blockId: z.uuid("内容块 ID 格式不正确").optional(),
    chunkId: z.uuid("切片 ID 格式不正确").optional(),
    // 兜底高亮：来源检索命中的原文片段（优先 blockId 定位，其次该文本匹配）
    matchedText: z.string().max(2000, "高亮文本过长").optional()
  }).refine(
    (value) => Boolean(value.documentId || value.sectionId || value.pageId || value.blockId || value.chunkId),
    { message: "请至少提供 documentId/sectionId/pageId/blockId/chunkId 之一" }
  );

  route.get("/source-detail", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 知识溯源"],
      summary: "AI 来源详情：完整页内容 + 章节路径 + 命中高亮",
      querystring: sourceDetailQuerySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const detail = await resolveSourceDetail(app, user, {
      documentId: request.query.documentId ?? null,
      sectionId: request.query.sectionId ?? null,
      pageId: request.query.pageId ?? null,
      blockId: request.query.blockId ?? null,
      chunkId: request.query.chunkId ?? null,
      matchedText: request.query.matchedText ?? null
    });
    return ok(request, detail);
  });
}
