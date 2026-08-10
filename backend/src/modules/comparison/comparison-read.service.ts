import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { comparisonDimensions, comparisonEvidence, comparisonMaterials, comparisonRules, comparisonVersions } from "../../db/schema.js";

/**
 * 已发布材料对比规则读取（AI 与前端共用）：
 * - 状态过滤在服务内强制（只读 PUBLISHED），调用方无法传 status 绕过；
 * - 生效区间按 effectiveDate（默认当前时间）判定，空视为不限制；
 * - 组装规则 + 双方材料 + 证据（VICP 侧/竞品侧），供 AI 上下文格式化与前端展示复用同一形状。
 */

export interface PublishedComparisonRuleQuery {
  competitorCategory?: string;
  dimensionCode?: string;
  effectiveDate?: Date;
}

export async function listPublishedComparisonRules(app: FastifyInstance, query: PublishedComparisonRuleQuery = {}) {
  const now = query.effectiveDate ?? new Date();
  const versions = await app.db.select().from(comparisonVersions)
    .where(and(
      eq(comparisonVersions.status, "PUBLISHED"),
      or(isNull(comparisonVersions.effectiveAt), lte(comparisonVersions.effectiveAt, now)),
      or(isNull(comparisonVersions.expiresAt), gte(comparisonVersions.expiresAt, now))
    ))
    .orderBy(comparisonVersions.updatedAt);
  if (versions.length === 0) return [];
  const versionIds = versions.map((v) => v.id);
  const versionMap = new Map(versions.map((v) => [v.id, v]));

  let dimensionIds: string[] | undefined;
  if (query.dimensionCode) {
    const dimensions = await app.db.select({ id: comparisonDimensions.id }).from(comparisonDimensions)
      .where(and(eq(comparisonDimensions.code, query.dimensionCode), eq(comparisonDimensions.enabled, true)));
    dimensionIds = dimensions.map((d) => d.id);
    if (dimensionIds.length === 0) return [];
  }

  const rules = await app.db.select().from(comparisonRules)
    .where(and(
      inArray(comparisonRules.versionId, versionIds),
      dimensionIds ? inArray(comparisonRules.dimensionId, dimensionIds) : undefined
    ))
    .orderBy(comparisonRules.sortOrder);
  if (rules.length === 0) return [];

  const materialIds = [...new Set(rules.flatMap((r) => [r.vicpMaterialId, r.competitorMaterialId]))];
  const materials = await app.db.select().from(comparisonMaterials).where(inArray(comparisonMaterials.id, materialIds));
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const evidence = await app.db.select().from(comparisonEvidence)
    .where(and(inArray(comparisonEvidence.versionId, versionIds), inArray(comparisonEvidence.ruleId, rules.map((r) => r.id))));
  const evidenceByRule = new Map<string, typeof evidence>();
  for (const item of evidence) {
    if (!item.ruleId) continue;
    const list = evidenceByRule.get(item.ruleId) ?? [];
    list.push(item);
    evidenceByRule.set(item.ruleId, list);
  }

  return rules.flatMap((rule) => {
    const vicpMaterial = materialMap.get(rule.vicpMaterialId);
    const competitorMaterial = materialMap.get(rule.competitorMaterialId);
    const version = versionMap.get(rule.versionId);
    if (!vicpMaterial || !competitorMaterial || !version) return [];
    if (query.competitorCategory && competitorMaterial.category !== query.competitorCategory) return [];
    return [{
      ...rule,
      /** 规则编码 = 所属版本的 code（规则本身无独立编码），使用日志据此追溯版本 */
      ruleCode: version.code,
      ruleVersion: version.version,
      vicpMaterial,
      competitorMaterial,
      evidence: evidenceByRule.get(rule.id) ?? []
    }];
  });
}