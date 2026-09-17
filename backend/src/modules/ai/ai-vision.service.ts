/**
 * Vision 只负责“看图”：校验附件 → 短时签名 URL → 已配置视觉模型 → visionContext。
 * 不直接生成业务答案；visionContext 注入现有 AI 编排后继续知识检索/项目上下文等。
 */
import { generateText } from "ai";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { files, projects } from "../../db/schema.js";
import {
  CHAT_IMAGE_MAX_COUNT,
  VISION_SIGNED_URL_EXPIRES_SECONDS,
  chatImageMaxBytes,
  isChatImageMime
} from "../../shared/chat-image.js";
import { AiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { resolveDefaultVisionModel } from "../ai-config/ai-config.service.js";
import { canAccessSourceFile, canReadProjectFile } from "../files/file-access.js";

export type ChatImageAttachment = {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  objectKey: string;
};

export type VisionContext = {
  text: string;
  modelId: string;
  providerId: string;
  durationMs: number;
  semanticSummary: string;
  extractedText: string | null;
  detectedObjects: string[];
};

export function parseVisionSemantics(text: string): {
  semanticSummary: string;
  extractedText: string | null;
  detectedObjects: string[];
} {
  const summaryMatch = text.match(/【观察摘要】\s*([\s\S]*?)(?=【可见文字】|【可见对象】|$)/);
  const textMatch = text.match(/【可见文字】\s*([\s\S]*?)(?=【可见对象】|【观察摘要】|$)/);
  const objectsMatch = text.match(/【可见对象】\s*([\s\S]*?)(?=【观察摘要】|【可见文字】|$)/);
  const semanticSummary = (summaryMatch?.[1] ?? text).trim();
  const extractedText = textMatch?.[1]?.trim() || null;
  const detectedObjects = (objectsMatch?.[1] ?? "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return { semanticSummary, extractedText, detectedObjects };
}

function uniqueFileIds(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

export function normalizeAttachmentFileIds(ids: string[] | undefined): string[] {
  const unique = uniqueFileIds(ids);
  if (unique.length > CHAT_IMAGE_MAX_COUNT) {
    throw new ForbiddenError(`单次最多发送 ${CHAT_IMAGE_MAX_COUNT} 张图片`);
  }
  return unique;
}

async function canAccessChatImage(
  app: FastifyInstance,
  user: AuthUser,
  file: { ownerUserId: string; projectId: string | null }
): Promise<boolean> {
  if (!file.projectId) return canAccessSourceFile(user, file);
  const [project] = await app.db.select().from(projects)
    .where(and(eq(projects.id, file.projectId), isNull(projects.deletedAt))).limit(1);
  return Boolean(project && canReadProjectFile(user, file, project));
}

/** 校验聊天图片：归属、READY、MIME、数量、大小。不要求 projectId。 */
export async function validateChatImageAttachments(
  app: FastifyInstance,
  user: AuthUser,
  fileIds: string[] | undefined
): Promise<ChatImageAttachment[]> {
  const ids = normalizeAttachmentFileIds(fileIds);
  if (ids.length === 0) return [];

  const rows = await app.db.select().from(files).where(and(
    inArray(files.id, ids),
    isNull(files.deletedAt)
  ));
  if (rows.length !== ids.length) {
    throw new NotFoundError("部分图片不存在或无权使用");
  }

  const maxBytes = chatImageMaxBytes();
  const ordered: ChatImageAttachment[] = [];
  for (const id of ids) {
    const file = rows.find((row) => row.id === id);
    if (!file) throw new NotFoundError("部分图片不存在或无权使用");
    if (!(await canAccessChatImage(app, user, file))) {
      throw new NotFoundError("部分图片不存在或无权使用");
    }
    if (file.status !== "READY") {
      throw new ForbiddenError("图片尚未就绪，请确认上传完成后再发送");
    }
    if (!isChatImageMime(file.mimeType)) {
      throw new ForbiddenError("聊天图片仅支持 JPG、JPEG、PNG");
    }
    if (file.sizeBytes > maxBytes) {
      throw new ForbiddenError(`单张图片不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`);
    }
    ordered.push({
      fileId: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      objectKey: file.objectKey
    });
  }
  return ordered;
}

export function formatVisionContext(text: string): string {
  return [
    "【图片观察（仅视觉描述，不是业务结论）】",
    text.trim(),
    "以上内容只描述图片中可见信息。工程结论、标准条文、热工数值仍须走知识检索、项目上下文或确定性计算，禁止把视觉描述当成最终业务答案。"
  ].join("\n");
}

/**
 * 调用已配置 Vision 模型观察图片，返回可注入编排的 visionContext。
 * 签名 URL 仅短时有效，结果中不保存 bucket/objectKey/永久 URL。
 */
export async function describeChatImages(
  app: FastifyInstance,
  attachments: ChatImageAttachment[],
  userText: string
): Promise<VisionContext> {
  if (attachments.length === 0) {
    throw new ForbiddenError("没有可识别的图片");
  }
  const vision = await resolveDefaultVisionModel(app.db);
  const signedUrls = await Promise.all(attachments.map((item) =>
    app.storage.createDownloadUrl(item.objectKey, item.originalName, VISION_SIGNED_URL_EXPIRES_SECONDS)
  ));

  const startedAt = Date.now();
  const result = await generateText({
    model: vision.languageModel,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "你是视觉观察助手。请客观描述这些图片中可见的内容（材料、构造、文字、尺寸标注、图表、颜色与相对位置等）。",
            "只输出观察结果，不要给出工程结论，不要编造图中看不到的标准号、参数或项目信息。",
            "请按以下结构输出：",
            "【观察摘要】对图片的可复用语义描述，便于后续追问“刚才那张图第二个节点”。",
            "【可见文字】图中可读文字；没有则写无。",
            "【可见对象】逗号分隔的可见对象/节点/标注。",
            `用户问题：${userText}`
          ].join("\n")
        },
        ...signedUrls.map((url) => ({ type: "image" as const, image: new URL(url) }))
      ]
    }],
    maxOutputTokens: vision.maxOutputTokens ?? 1200,
    temperature: 0.2,
    timeout: vision.timeoutMs,
    abortSignal: AbortSignal.timeout(vision.timeoutMs)
  });

  const text = result.text.trim();
  if (!text) {
    throw new AiError("AI_CONTENT_REJECTED", "视觉模型未返回有效的图片观察结果");
  }
  const parsed = parseVisionSemantics(text);
  return {
    text,
    modelId: vision.modelRef.id,
    providerId: vision.providerId,
    durationMs: Date.now() - startedAt,
    ...parsed
  };
}

export function visionResultPayload(vision: VisionContext, fileIds: string[]): Record<string, unknown> {
  return {
    text: vision.text,
    semanticSummary: vision.semanticSummary,
    extractedText: vision.extractedText,
    detectedObjects: vision.detectedObjects,
    modelId: vision.modelId,
    providerId: vision.providerId,
    durationMs: vision.durationMs,
    fileIds
  };
}
