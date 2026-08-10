import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../db/client.js";
import { thermalReferenceRows, thermalReferenceSets } from "../../db/schema.js";
import { ThermalError } from "../../shared/thermal-errors.js";
import { effectiveRangeConditions } from "../construction/construction-structure.service.js";

/**
 * 图集热工参考表已发布读取服务（供未来方案筛选模块查表）。
 * 只返回 PUBLISHED 且生效中（effective_at <= now <= expires_at）的参考集；
 * 状态过滤在服务内强制，调用方无法传入状态参数绕过审核状态。
 */

const published = <T extends { status: AnyPgColumn; effectiveAt: AnyPgColumn; expiresAt: AnyPgColumn }>(
  table: T,
  now = new Date()
) => and(eq(table.status, "PUBLISHED"), ...effectiveRangeConditions(table, now));

export async function listPublishedThermalSets(
  db: DbExecutor,
  query: { schemeId?: string; productSpecId?: string; keyword?: string } = {}
) {
  const conditions = [
    published(thermalReferenceSets),
    query.keyword
      ? or(
          ilike(thermalReferenceSets.code, `%${query.keyword}%`),
          ilike(thermalReferenceSets.name, `%${query.keyword}%`)
        )
      : undefined
  ];
  let items = await db.select().from(thermalReferenceSets)
    .where(and(...conditions))
    .orderBy(desc(thermalReferenceSets.version));

  // 行级过滤条件需要联表，保持返回集结构不变，仅缩小范围
  if (query.schemeId || query.productSpecId) {
    const rowConditions = [
      query.schemeId ? eq(thermalReferenceRows.schemeId, query.schemeId) : undefined,
      query.productSpecId ? eq(thermalReferenceRows.productSpecId, query.productSpecId) : undefined
    ];
    const matched = await db.select({ setId: thermalReferenceRows.setId })
      .from(thermalReferenceRows)
      .where(and(...rowConditions));
    const matchedIds = new Set(matched.map((row) => row.setId));
    items = items.filter((set) => matchedIds.has(set.id));
  }
  return items;
}

/** 已发布参考集详情：集 + 全部参考行（行随集版本化，无需独立状态过滤） */
export async function getPublishedThermalSetDetail(db: DbExecutor, id: string) {
  const [set] = await db.select().from(thermalReferenceSets)
    .where(and(eq(thermalReferenceSets.id, id), published(thermalReferenceSets))).limit(1);
  if (!set) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "没有已发布且生效中的图集热工参考集");

  const rows = await db.select().from(thermalReferenceRows)
    .where(eq(thermalReferenceRows.setId, id))
    .orderBy(thermalReferenceRows.schemeId, thermalReferenceRows.thicknessMm);
  return { ...set, rows };
}