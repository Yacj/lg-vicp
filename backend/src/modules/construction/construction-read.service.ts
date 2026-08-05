import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../db/client.js";
import {
  constructionLayers,
  constructionSchemes,
  insulationSystems,
  schemeDocuments,
  schemeProductOptions
} from "../../db/schema.js";
import { ConstructionError } from "../../shared/construction-errors.js";
import { effectiveRangeConditions } from "./construction-structure.service.js";

/**
 * 保温系统/构造方案已发布读取服务（供未来图集查表模块与受控读取接口复用）。
 * 只返回 PUBLISHED 且生效中（effective_at <= now <= expires_at）的数据；
 * 状态过滤在服务内强制，调用方无法传入状态参数绕过审核状态。
 */

const published = <T extends { status: AnyPgColumn; effectiveAt: AnyPgColumn; expiresAt: AnyPgColumn }>(table: T, now = new Date()) =>
  and(eq(table.status, "PUBLISHED"), ...effectiveRangeConditions(table, now));

export async function listPublishedInsulationSystems(
  db: DbExecutor,
  query: { systemType?: string; keyword?: string } = {}
) {
  const conditions = [
    published(insulationSystems),
    query.systemType ? eq(insulationSystems.systemType, query.systemType) : undefined,
    query.keyword
      ? or(
          ilike(insulationSystems.code, `%${query.keyword}%`),
          ilike(insulationSystems.name, `%${query.keyword}%`)
        )
      : undefined
  ];
  return db.select().from(insulationSystems).where(and(...conditions)).orderBy(desc(insulationSystems.version));
}

export async function listPublishedConstructionSchemes(
  db: DbExecutor,
  query: { systemId?: string; schemeCode?: string; keyword?: string } = {}
) {
  const conditions = [
    published(constructionSchemes),
    query.systemId ? eq(constructionSchemes.systemId, query.systemId) : undefined,
    query.schemeCode ? eq(constructionSchemes.schemeCode, query.schemeCode) : undefined,
    query.keyword
      ? or(
          ilike(constructionSchemes.schemeCode, `%${query.keyword}%`),
          ilike(constructionSchemes.name, `%${query.keyword}%`)
        )
      : undefined
  ];
  return db.select().from(constructionSchemes).where(and(...conditions)).orderBy(desc(constructionSchemes.version));
}

/** 已发布方案详情：方案 + 构造层 + 产品选项 + 方案文档（子表按生效区间过滤） */
export async function getPublishedConstructionSchemeDetail(db: DbExecutor, id: string) {
  const [scheme] = await db.select().from(constructionSchemes)
    .where(and(eq(constructionSchemes.id, id), published(constructionSchemes))).limit(1);
  if (!scheme) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "没有已发布且生效中的构造方案");

  const now = new Date();
  const [layers, options, documents] = await Promise.all([
    db.select().from(constructionLayers)
      .where(and(eq(constructionLayers.schemeId, id), ...effectiveRangeConditions(constructionLayers, now)))
      .orderBy(asc(constructionLayers.layerOrder)),
    db.select().from(schemeProductOptions)
      .where(and(eq(schemeProductOptions.schemeId, id), ...effectiveRangeConditions(schemeProductOptions, now)))
      .orderBy(schemeProductOptions.productSpecId),
    db.select().from(schemeDocuments)
      .where(and(eq(schemeDocuments.targetType, "SCHEME"), eq(schemeDocuments.targetId, id), ...effectiveRangeConditions(schemeDocuments, now)))
      .orderBy(schemeDocuments.updatedAt)
  ]);
  return { ...scheme, layers, productOptions: options, documents };
}