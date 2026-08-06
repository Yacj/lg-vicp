/**
 * AI 对话敏感词围栏：发送消息前做确定性校验，命中即拦截（不发模型请求）。
 * 词条数量小，匹配在内存中完成（纯函数，便于单测），不拼接用户输入构造 SQL。
 */
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { aiContentFilters } from "../../db/schema.js";

export const CONTENT_FILTER_MATCH_TYPES = ["CONTAINS", "REGEX"] as const;
export type ContentFilterMatchType = (typeof CONTENT_FILTER_MATCH_TYPES)[number];

export type ContentFilterRow = typeof aiContentFilters.$inferSelect;

export interface ContentFilterHit {
  filterId: string;
  keyword: string;
  matchType: ContentFilterMatchType;
  matchedText: string;
  hitMessage: string | null;
}

/**
 * 纯函数：在内容中匹配单个词条。
 * CONTAINS：包含匹配（原样）；REGEX：正则匹配（带 iu 标志，非法正则返回 null 不抛错）。
 */
export function matchContentFilter(
  content: string,
  filter: Pick<ContentFilterRow, "keyword" | "matchType">
): string | null {
  if (!content || !filter.keyword) return null;
  if (filter.matchType === "REGEX") {
    try {
      const matched = content.match(new RegExp(filter.keyword, "iu"));
      return matched ? matched[0] : null;
    } catch {
      // 非法正则：配置接口已校验，运行时兜底跳过该词条
      return null;
    }
  }
  return content.includes(filter.keyword) ? filter.keyword : null;
}

/**
 * 纯函数：按场景过滤词条并逐个匹配，返回第一个命中的词条。
 * sceneCodes 为空或空数组表示全局生效；否则仅对列出的场景生效。
 */
export function findFirstContentHit(
  content: string,
  sceneCode: string,
  filters: ContentFilterRow[]
): ContentFilterHit | null {
  for (const filter of filters) {
    if (!filter.enabled) continue;
    if (filter.sceneCodes && filter.sceneCodes.length > 0 && !filter.sceneCodes.includes(sceneCode)) {
      continue;
    }
    const matchedText = matchContentFilter(content, filter);
    if (matchedText !== null) {
      return {
        filterId: filter.id,
        keyword: filter.keyword,
        matchType: (filter.matchType === "REGEX" ? "REGEX" : "CONTAINS"),
        matchedText,
        hitMessage: filter.hitMessage
      };
    }
  }
  return null;
}

/**
 * 校验用户输入是否命中启用的敏感词条（每轮消息一次查询）。
 * 命中返回词条信息（含自定义提示语）；未命中返回 null。
 */
export async function checkContentFiltered(
  db: Database,
  sceneCode: string,
  content: string
): Promise<ContentFilterHit | null> {
  const filters = await db.select().from(aiContentFilters)
    .where(eq(aiContentFilters.enabled, true));
  return findFirstContentHit(content, sceneCode, filters);
}