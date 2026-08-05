import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  enterpriseProfiles,
  materialParameterVersions,
  materials,
  productParameters,
  productSpecs,
  type ProductParameter
} from "../../db/schema.js";
import { MdError } from "../../shared/md-errors.js";

/**
 * 主数据已发布读取服务（供计算模块与受控读取接口复用）。
 * 只返回 PUBLISHED 且生效中（effective_at <= now <= expires_at）的数据；
 * 状态过滤在服务内强制，调用方无法传入状态参数绕过审核状态。
 */

function publishedUsageCondition(allowedUsage: unknown, usage: string) {
  // 空数组表示不限用途；非空时必须包含请求用途
  return sql`(jsonb_array_length(${allowedUsage}) = 0 OR ${allowedUsage} @> ${JSON.stringify([usage])}::jsonb)`;
}

export async function listPublishedProductSpecs(
  db: DbExecutor,
  query: { seriesId?: string; specClass?: "I" | "II" | "III"; keyword?: string }
) {
  const now = new Date();
  const conditions = [
    eq(productSpecs.status, "PUBLISHED"),
    or(isNull(productSpecs.effectiveAt), lte(productSpecs.effectiveAt, now)),
    or(isNull(productSpecs.expiresAt), gte(productSpecs.expiresAt, now)),
    query.seriesId ? eq(productSpecs.seriesId, query.seriesId) : undefined,
    query.specClass ? eq(productSpecs.specClass, query.specClass) : undefined,
    query.keyword ? ilike(productSpecs.specCode, `%${query.keyword}%`) : undefined
  ];
  return db.select().from(productSpecs).where(and(...conditions)).orderBy(productSpecs.specCode);
}

export interface PublishedParameterQuery {
  specId?: string;
  parameterCode?: string;
  /** 用途过滤：allowedUsage 为空数组时不限制，否则必须包含该用途（值域待甲方确认） */
  usage?: string;
}

export async function listPublishedProductParameters(
  db: DbExecutor,
  query: PublishedParameterQuery
): Promise<ProductParameter[]> {
  const now = new Date();
  const conditions = [
    eq(productParameters.status, "PUBLISHED"),
    or(isNull(productParameters.effectiveAt), lte(productParameters.effectiveAt, now)),
    or(isNull(productParameters.expiresAt), gte(productParameters.expiresAt, now)),
    query.specId ? eq(productParameters.specId, query.specId) : undefined,
    query.parameterCode ? eq(productParameters.parameterCode, query.parameterCode) : undefined
  ];
  if (query.usage) {
    conditions.push(publishedUsageCondition(productParameters.allowedUsage, query.usage));
  }
  return db.select().from(productParameters).where(and(...conditions))
    .orderBy(productParameters.parameterCode, productParameters.paramSource);
}

export async function listPublishedMaterials(db: DbExecutor, query: { keyword?: string } = {}) {
  const now = new Date();
  const conditions = [
    eq(materials.status, "PUBLISHED"),
    or(isNull(materials.effectiveAt), lte(materials.effectiveAt, now)),
    or(isNull(materials.expiresAt), gte(materials.expiresAt, now)),
    query.keyword ? ilike(materials.name, `%${query.keyword}%`) : undefined
  ];
  return db.select().from(materials).where(and(...conditions)).orderBy(materials.name);
}

export async function listPublishedMaterialParameters(
  db: DbExecutor,
  query: { materialId?: string; usage?: string }
) {
  const now = new Date();
  const conditions = [
    eq(materialParameterVersions.status, "PUBLISHED"),
    or(isNull(materialParameterVersions.effectiveAt), lte(materialParameterVersions.effectiveAt, now)),
    or(isNull(materialParameterVersions.expiresAt), gte(materialParameterVersions.expiresAt, now)),
    query.materialId ? eq(materialParameterVersions.materialId, query.materialId) : undefined
  ];
  if (query.usage) {
    conditions.push(publishedUsageCondition(materialParameterVersions.allowedUsage, query.usage));
  }
  return db.select().from(materialParameterVersions).where(and(...conditions)).orderBy(desc(materialParameterVersions.version));
}

export async function listPublishedEnterpriseProfiles(db: DbExecutor) {
  const now = new Date();
  return db.select().from(enterpriseProfiles).where(and(
    eq(enterpriseProfiles.status, "PUBLISHED"),
    or(isNull(enterpriseProfiles.effectiveAt), lte(enterpriseProfiles.effectiveAt, now)),
    or(isNull(enterpriseProfiles.expiresAt), gte(enterpriseProfiles.expiresAt, now))
  )).orderBy(desc(enterpriseProfiles.version));
}

/** 计算前置：取某规格下已发布且用途允许的参数；无任何可用参数时抛 MD_NOT_PUBLISHED（不吞掉缺失信息） */
export async function requirePublishedSpecParameters(
  db: DbExecutor,
  query: PublishedParameterQuery & { usage: string }
): Promise<ProductParameter[]> {
  const parameters = await listPublishedProductParameters(db, query);
  if (parameters.length === 0) {
    throw new MdError("MD_NOT_PUBLISHED", "没有已发布且用途允许的产品参数版本，请先在后台配置并发布");
  }
  return parameters;
}