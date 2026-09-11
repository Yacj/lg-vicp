/**
 * 对话生成用知识检索：失败时降级为空结果，避免图集/检索路径把整次回答打成 500。
 * 检索日志写入失败同样忽略，不阻断回答。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { aiRetrievalLogs } from "../../db/schema.js";
import { searchProjectKnowledge, type WikiHit } from "../knowledge/knowledge.service.js";

export async function loadKnowledgeForGeneration(options: {
  app: FastifyInstance;
  log: FastifyRequest["log"];
  conversationId: string;
  messageId: string;
  content: string;
  projectId: string | null;
  insulationSystemId: string | null;
  needSearch: boolean;
  providedChunks?: WikiHit[];
}): Promise<{ chunks: WikiHit[]; retrievalFailed: boolean }> {
  if (options.providedChunks !== undefined) {
    return { chunks: options.providedChunks, retrievalFailed: false };
  }
  if (!options.needSearch) {
    return { chunks: [], retrievalFailed: false };
  }
  try {
    const chunks = await searchProjectKnowledge(options.app, options.projectId, options.content, {
      insulationSystemId: options.insulationSystemId
    });
    if (chunks.length > 0) {
      try {
        await options.app.db.insert(aiRetrievalLogs).values(chunks.map((chunk) => ({
          conversationId: options.conversationId,
          messageId: options.messageId,
          documentId: chunk.documentId,
          chunkId: chunk.chunkId ?? null,
          score: Number.isFinite(chunk.score) ? chunk.score : null,
          sourcePage: chunk.sourcePage,
          sourceTitle: chunk.sourceTitle?.slice(0, 255) ?? null
        })));
      } catch (error) {
        options.log.error({ err: error }, "AI 检索日志写入失败，忽略后继续生成");
      }
    }
    return { chunks, retrievalFailed: false };
  } catch (error) {
    options.log.error({ err: error }, "知识检索失败，将不以图集原文为依据继续生成");
    return { chunks: [], retrievalFailed: true };
  }
}
