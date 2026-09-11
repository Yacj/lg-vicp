/**
 * AI 快捷提问：独立配置，不复用 prompts / prompt_versions。
 * C 端只读 enabled=true 且按 sortOrder ASC；B 端写入后清 Redis 缓存。
 */
import { and, asc, count, eq, ilike } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiQuickPrompts } from "../../db/schema.js";
import {
  AI_QUICK_PROMPT_ACTION_TYPES,
  AI_QUICK_PROMPT_ICONS,
  AI_QUICK_PROMPT_POSITIONS
} from "../../shared/constants.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { getPagination } from "../../shared/pagination.js";

export const QUICK_PROMPT_CACHE_KEY = "ai:quick-prompts:client";
export const QUICK_PROMPT_CACHE_TTL_SECONDS = 600;

export type QuickPromptPosition = (typeof AI_QUICK_PROMPT_POSITIONS)[keyof typeof AI_QUICK_PROMPT_POSITIONS];
export type QuickPromptActionType = (typeof AI_QUICK_PROMPT_ACTION_TYPES)[keyof typeof AI_QUICK_PROMPT_ACTION_TYPES];
export type QuickPromptIcon = (typeof AI_QUICK_PROMPT_ICONS)[number];

export type QuickPromptRow = typeof aiQuickPrompts.$inferSelect;

export interface ClientQuickPrompt {
  id: string;
  title: string;
  description: string | null;
  content: string;
  icon: string;
  position: QuickPromptPosition;
}

export interface QuickPromptWriteInput {
  title: string;
  description?: string | null;
  content: string;
  position: QuickPromptPosition;
  icon: QuickPromptIcon;
  sortOrder: number;
  enabled: boolean;
  actionType: QuickPromptActionType;
}

export function toClientQuickPrompt(row: Pick<
  QuickPromptRow,
  "id" | "title" | "description" | "content" | "icon" | "position"
>): ClientQuickPrompt {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    icon: row.icon,
    position: row.position
  };
}

export function sortClientQuickPrompts<T extends { sortOrder: number; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

export async function invalidateQuickPromptCache(app: FastifyInstance): Promise<void> {
  await app.redis.del(QUICK_PROMPT_CACHE_KEY);
}

export async function listAdminQuickPrompts(
  app: FastifyInstance,
  query: { page: number; pageSize: number; keyword?: string; position?: QuickPromptPosition; enabled?: boolean }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const keyword = query.keyword?.replace(/[\\%_]/g, (value) => `\\${value}`);
  const where = and(
    keyword ? ilike(aiQuickPrompts.title, `%${keyword}%`) : undefined,
    query.position ? eq(aiQuickPrompts.position, query.position) : undefined,
    query.enabled === undefined ? undefined : eq(aiQuickPrompts.enabled, query.enabled)
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(aiQuickPrompts)
      .where(where)
      .orderBy(asc(aiQuickPrompts.sortOrder), asc(aiQuickPrompts.createdAt))
      .offset(skip)
      .limit(take),
    app.db.select({ value: count() }).from(aiQuickPrompts).where(where)
  ]);
  return {
    items,
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getQuickPrompt(app: FastifyInstance, id: string): Promise<QuickPromptRow> {
  const [row] = await app.db.select().from(aiQuickPrompts).where(eq(aiQuickPrompts.id, id)).limit(1);
  if (!row) throw new NotFoundError("快捷提问不存在");
  return row;
}

export async function assertQuickPromptTitleAvailable(
  app: FastifyInstance,
  position: QuickPromptPosition,
  title: string,
  excludeId?: string
): Promise<void> {
  const [duplicate] = await app.db.select({ id: aiQuickPrompts.id }).from(aiQuickPrompts)
    .where(and(eq(aiQuickPrompts.position, position), eq(aiQuickPrompts.title, title)))
    .limit(1);
  if (duplicate && duplicate.id !== excludeId) {
    throw new ConflictError("同一展示位置已存在相同标题的快捷提问");
  }
}

export async function listClientQuickPrompts(
  app: FastifyInstance,
  position: QuickPromptPosition
): Promise<ClientQuickPrompt[]> {
  const cached = await app.redis.get(QUICK_PROMPT_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as QuickPromptRow[];
      return parsed
        .filter((row) => row.enabled && row.position === position)
        .sort((left, right) => left.sortOrder - right.sortOrder || Date.parse(String(left.createdAt)) - Date.parse(String(right.createdAt)))
        .map(toClientQuickPrompt);
    } catch {
      await app.redis.del(QUICK_PROMPT_CACHE_KEY);
    }
  }

  const rows = await app.db.select().from(aiQuickPrompts)
    .where(eq(aiQuickPrompts.enabled, true))
    .orderBy(asc(aiQuickPrompts.sortOrder), asc(aiQuickPrompts.createdAt));
  await app.redis.set(QUICK_PROMPT_CACHE_KEY, JSON.stringify(rows), "EX", QUICK_PROMPT_CACHE_TTL_SECONDS);
  return rows.filter((row) => row.position === position).map(toClientQuickPrompt);
}
