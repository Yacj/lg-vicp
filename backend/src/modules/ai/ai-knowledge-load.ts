/**
 * 对话生成用知识检索：失败时降级为空结果，避免图集/检索路径把整次回答打成 500。
 * 检索日志写入失败同样忽略，不阻断回答。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { aiRetrievalLogs } from "../../db/schema.js";
import { searchProjectKnowledge, type WikiHit } from "../knowledge/knowledge.service.js";
import { parseSpecClassHint } from "./tools/thermal-lookup.js";

/** 型号工程格式提取，不判断意图、不签发正式ID或副作用。 */
export function requestedSpecClasses(message: string) {
  const terms = message.normalize("NFKC").match(/(?:III|II|I|[123一二三])型/gi) ?? [];
  return [...new Map(terms.flatMap(term => { const specClass = parseSpecClassHint(term); return specClass ? [[specClass, { term, specClass }] as const] : []; })).values()];
}

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
    let chunks = await searchProjectKnowledge(options.app, options.projectId, options.content, {
      insulationSystemId: options.insulationSystemId
    });
    const classes = requestedSpecClasses(options.content);
    if (classes.length > 1) {
      // 逐型号召回并交错排列，避免同一本资料的I型片段占满预算而误称II型不存在。
      const grouped = await Promise.allSettled(classes.map(item => searchProjectKnowledge(options.app, options.projectId, item.term,
        { insulationSystemId: options.insulationSystemId, limit: 20 })));
      const groups = grouped.map((result, index) => result.status === "fulfilled" ? result.value.filter(hit =>
        parseSpecClassHint(hit.pageTitle ?? hit.content) === classes[index]!.specClass).slice(0, 3) : []);
      const covered = Array.from({ length: 3 }, (_, index) => groups.flatMap(group => group[index] ? [group[index]!] : [])).flat();
      const unique = new Map<string, WikiHit>();
      for (const hit of [...covered, ...chunks]) unique.set(`${hit.documentId}:${hit.pageId}:${hit.chunkId ?? hit.content}`, hit);
      chunks = [...unique.values()].slice(0, 12);
    }
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
