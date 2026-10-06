import { tool } from "ai";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { collectionRecords } from "../../db/schema.js";
import { asConflictError } from "../../shared/database-errors.js";
import { canonicalizeCollectionUrl, collectionFingerprint, isSameOrigin } from "./collection-fingerprint.js";
import {
  COLLECTION_AGENT_LIMITS,
  fetchPageTool,
  followLinkTool,
  searchInPageTool,
  sleep,
  type CollectionHttpFetch
} from "./collection-agent.guards.js";

export type CollectionAgentContext = {
  db: Database;
  sourceUrl: string;
  sourceId: string | null;
  skillId: string | null;
  taskId: string;
  runId: string;
  keywords: string[];
  visited: Set<string>;
  storedCount: { value: number };
  duplicateCount: { value: number };
  lastFetchAt: { value: number };
  finished: { value: boolean };
  httpFetch: CollectionHttpFetch;
  deadline: number;
};

export const browsePageInput = z.object({
  url: z.string().url("必须是合法 URL")
    .describe("下一步要访问的 URL，必须来自允许站点或上一步返回的同域链接")
});

export const saveRecordInput = z.object({
  url: z.string().url("必须是合法 URL").describe("已浏览且值得保存的页面 URL"),
  title: z.string().trim().min(1).max(255).describe("页面标题"),
  summary: z.string().trim().min(1).max(2000).describe("与技能关键词相关的正文摘要，不要粘贴整页 HTML"),
  matchedKeywords: z.array(z.string().trim().min(1).max(80)).max(20).default([])
    .describe("命中的技能关键词"),
  publishedAt: z.string().datetime().optional()
    .describe("页面公开日期，ISO 8601；不确定则省略")
});

export const finishCollectionInput = z.object({
  reason: z.string().trim().min(1).max(300).describe("结束采集的原因，例如已覆盖关键词或无更多同域相关链接")
});

export function createCollectionAgentTools(ctx: CollectionAgentContext) {
  const browsePage = tool({
    description: `
      访问下一个同域页面。Backend 会校验同域、已访问、页数上限、频率和重试。
      返回标题、正文摘要和尚未访问的同域链接。不要请求跨域 URL。
    `,
    inputSchema: browsePageInput,
    execute: async ({ url }) => {
      if (Date.now() > ctx.deadline) {
        return { ok: false as const, code: "COLLECTION_TIMEOUT", message: "采集整体超时", recoverable: false };
      }
      if (ctx.visited.size >= COLLECTION_AGENT_LIMITS.maxPages) {
        return { ok: false as const, code: "COLLECTION_MAX_PAGES", message: "已达到最大访问页数", recoverable: false };
      }
      const follow = followLinkTool({ sourceUrl: ctx.sourceUrl, candidateUrl: url, visited: ctx.visited });
      if (follow.skipped) {
        if (follow.reason === "DUPLICATE_URL") ctx.duplicateCount.value += 1;
        return {
          ok: false as const,
          code: follow.reason,
          message: follow.reason === "CROSS_ORIGIN" ? "拒绝跨域 URL" : "该 URL 已访问",
          recoverable: true,
          url: follow.url
        };
      }
      const wait = COLLECTION_AGENT_LIMITS.minIntervalMs - (Date.now() - ctx.lastFetchAt.value);
      if (wait > 0) await sleep(wait);
      const page = await fetchPageTool(ctx.httpFetch, follow.url);
      ctx.lastFetchAt.value = Date.now();
      ctx.visited.add(page.url);
      const search = ctx.keywords.length === 0
        ? { matched: true, hits: [] as string[] }
        : searchInPageTool(page, ctx.keywords);
      const links = page.links
        .map((link) => followLinkTool({ sourceUrl: ctx.sourceUrl, candidateUrl: link, visited: ctx.visited }))
        .filter((item) => !item.skipped)
        .map((item) => item.url)
        .slice(0, 20);
      return {
        ok: true as const,
        data: {
          url: page.url,
          title: page.title,
          summary: page.text.slice(0, 1500),
          matchedKeywords: search.hits,
          relevant: search.matched,
          links
        },
        summary: search.matched ? `命中关键词：${search.hits.join("、") || "未指定"}` : "本页未命中技能关键词"
      };
    }
  });

  const saveRecord = tool({
    description: `
      保存当前相关页面为结构化采集记录。
      你只决定是否值得保存以及摘要/关键词；去重、fingerprint 和数据库唯一约束由 Backend 执行。
    `,
    inputSchema: saveRecordInput,
    execute: async ({ url, title, summary, matchedKeywords, publishedAt }) => {
      if (!isSameOrigin(ctx.sourceUrl, url)) {
        return { ok: false as const, code: "CROSS_ORIGIN", message: "只能保存同域页面", recoverable: false };
      }
      const canonical = canonicalizeCollectionUrl(url);
      const fingerprint = collectionFingerprint({ url: canonical, title, content: summary });
      try {
        await ctx.db.insert(collectionRecords).values({
          sourceId: ctx.sourceId,
          skillId: ctx.skillId,
          taskId: ctx.taskId,
          runId: ctx.runId,
          title,
          url: canonical,
          publishedAt: publishedAt ? new Date(publishedAt) : null,
          collectedAt: new Date(),
          keywordsJson: matchedKeywords.length > 0 ? matchedKeywords : ctx.keywords,
          summary,
          rawDataJson: { source: "collection_agent", matchedKeywords },
          fingerprint
        });
        ctx.storedCount.value += 1;
        return {
          ok: true as const,
          data: { url: canonical, fingerprint, stored: true },
          summary: `已保存：${title}`
        };
      } catch (error) {
        if (asConflictError(error, "重复采集")) {
          ctx.duplicateCount.value += 1;
          return {
            ok: true as const,
            data: { url: canonical, fingerprint, stored: false, duplicate: true },
            summary: "内容指纹重复，已跳过"
          };
        }
        throw error;
      }
    }
  });

  const finishCollection = tool({
    description: "结束本次采集。在没有更多同域相关页面，或已保存足够记录时调用。",
    inputSchema: finishCollectionInput,
    execute: async ({ reason }) => {
      ctx.finished.value = true;
      return {
        ok: true as const,
        data: {
          reason,
          storedCount: ctx.storedCount.value,
          duplicateCount: ctx.duplicateCount.value,
          visitedCount: ctx.visited.size
        },
        summary: reason
      };
    }
  });

  return { browse_page: browsePage, save_record: saveRecord, finish_collection: finishCollection };
}
