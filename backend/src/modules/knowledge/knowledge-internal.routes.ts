import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ServiceUnavailableError, UnauthorizedError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { ingestServerSideFile, resolveSystemActor, type IngestDeps } from "./knowledge-ingest.service.js";

/**
 * 知识库内部受控 API：服务间调用专用（如外部门户推送标准文件）。
 * 鉴权：请求头 x-internal-key 必须等于 env.INTERNAL_API_KEY（未配置则整体禁用）。
 * 产物为 DRAFT 版本（默认 REVIEW_PENDING 待审核），审核发布走 B 端流程。
 */

const MAX_BASE64_BYTES = 20 * 1024 * 1024; // 与 bodyLimit 匹配：20MB 二进制 → ~27MB base64

function ingestDeps(app: FastifyInstance): IngestDeps {
  return { db: app.db, storage: app.storage, queues: app.queues };
}

export async function internalKnowledgeRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/ingest", {
    config: { bodyLimit: 32 * 1024 * 1024 },
    schema: {
      tags: ["公共 / 内部接口"],
      summary: "内部受控 API：服务端直接入库知识文档并投递解析（x-internal-key 鉴权）",
      headers: z.object({
        "x-internal-key": z.string().min(16, "缺少内部调用密钥")
      }),
      body: z.object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(120),
        sizeBytes: z.number().int().positive().max(MAX_BASE64_BYTES),
        sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, "sha256 格式不正确"),
        contentBase64: z.string().min(1),
        title: z.string().trim().min(1).max(200).optional(),
        docType: z.enum([
          "SPECIFICATION", "DETAIL_ATLAS", "STANDARD", "APPLICATION_GUIDE",
          "MATERIAL_COMPARISON", "COMPANY_PROFILE", "THERMAL_FORMULA", "OTHER"
        ]).optional(),
        categoryId: z.uuid("分类 ID 格式不正确").optional()
      })
    }
  }, async (request) => {
    if (!env.INTERNAL_API_KEY) {
      throw new ServiceUnavailableError("内部接口未启用（未配置 INTERNAL_API_KEY）");
    }
    if (request.headers["x-internal-key"] !== env.INTERNAL_API_KEY) {
      throw new UnauthorizedError("内部调用密钥无效");
    }
    const actor = await resolveSystemActor(app.db);
    const content = Buffer.from(request.body.contentBase64, "base64");
    if (content.length !== request.body.sizeBytes) {
      throw new ServiceUnavailableError("文件内容大小与申请信息不一致");
    }
    const result = await ingestServerSideFile(ingestDeps(app), request, actor, {
      fileName: request.body.fileName,
      mimeType: request.body.mimeType,
      sizeBytes: request.body.sizeBytes,
      sha256: request.body.sha256,
      content,
      source: "INTERNAL_API",
      docType: request.body.docType,
      categoryId: request.body.categoryId,
      title: request.body.title
    });
    return ok(request, {
      message: result.skipped ? "相同内容已在库，已跳过（幂等）" : "入库成功，等待解析与人工审核",
      ...result
    });
  });
}