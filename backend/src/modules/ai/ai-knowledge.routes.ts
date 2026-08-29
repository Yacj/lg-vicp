import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { resolveSourceDetail } from "../knowledge/knowledge-wiki-read.service.js";

/**
 * AI 来源详情（Wiki 原文阅读 + 页面高亮）：
 * 用户点击 AI source 后，经 sectionId/pageId/blockId/chunkId 任一定位入口，
 * 回到 文档 → 章节路径 → 完整页 → 本次命中区域高亮。
 * 只允许读取 PUBLISHED 且生效中的知识版本；项目内文档执行项目可见性守卫。
 */
export async function aiKnowledgeRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

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
