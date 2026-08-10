import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  comparisonDimensions,
  comparisonEvidence,
  comparisonMaterials,
  comparisonRules,
  comparisonVersions
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ComparisonError } from "../../shared/comparison-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  MD_ENTITIES,
  registerVersionedEntity,
  type MdReviewStatus
} from "../masterdata/md-workflow.service.js";

/**
 * 材料对比规则引擎服务。
 * - comparison_versions：版本化实体（同 code 多版本行，发布互斥，new-version 派生新草稿并复制子表）。
 * - comparison_materials / comparison_rules / comparison_evidence：随版本化，编辑受版本状态守卫。
 * - 规则引用同一版本内双方材料（VICP 侧类别必须为 VICP、竞品侧必须非 VICP），防不同型号/密度混比。
 * - 定量数据不足时 competitorValue 留空，只输出 VICP 自身已验证表现，不生成对方负面结论。
 */

// 模块加载时注册版本化实体元数据（复用 masterdata 状态机）
registerVersionedEntity("comparisonVersion", {
  table: comparisonVersions,
  idColumn: comparisonVersions.id,
  statusColumn: comparisonVersions.status,
  versionColumn: comparisonVersions.version,
  keyColumns: [comparisonVersions.code],
  kind: "comparison_version",
  label: "材料对比版本"
});

const VERSION_META = () => MD_ENTITIES.comparisonVersion!;

/** 子表可编辑状态：版本处于草稿/审核中/已驳回时允许增删改材料、规则与证据 */
const CHILD_EDITABLE: MdReviewStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

/** 五维固定维度 code（seed 写入，禁止删除/禁用，子指标可扩展） */
export const FIXED_DIMENSION_CODES = ["thermal", "fire", "durability", "construction", "approval"] as const;

/** 审计动作（audit_logs.action 为 varchar，直接使用稳定字符串） */
const AUDIT_VERSION_CREATED = "comparison.version_created";
const AUDIT_VERSION_UPDATED = "comparison.version_updated";
const AUDIT_VERSION_DELETED = "comparison.version_deleted";
const AUDIT_MATERIAL_CREATED = "comparison.material_created";
const AUDIT_MATERIAL_UPDATED = "comparison.material_updated";
const AUDIT_MATERIAL_DELETED = "comparison.material_deleted";
const AUDIT_RULE_CREATED = "comparison.rule_created";
const AUDIT_RULE_UPDATED = "comparison.rule_updated";
const AUDIT_RULE_DELETED = "comparison.rule_deleted";
const AUDIT_RULE_BATCH_CREATED = "comparison.rules_batch_created";
const AUDIT_EVIDENCE_CREATED = "comparison.evidence_created";
const AUDIT_EVIDENCE_UPDATED = "comparison.evidence_updated";
const AUDIT_EVIDENCE_DELETED = "comparison.evidence_deleted";
const AUDIT_DIMENSION_CREATED = "comparison.dimension_created";
const AUDIT_DIMENSION_UPDATED = "comparison.dimension_updated";
const AUDIT_DIMENSION_DELETED = "comparison.dimension_deleted";

// ---------------------------------------------------------------- 版本（版本化主体）

export interface ComparisonVersionCreateInput {
  code: string;
  name: string;
  description?: string | null;
  changeNote?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listComparisonVersions(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(comparisonVersions.status, query.status) : undefined,
    query.keyword
      ? or(
          ilike(comparisonVersions.code, `%${query.keyword}%`),
          ilike(comparisonVersions.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(comparisonVersions).where(where).orderBy(desc(comparisonVersions.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(comparisonVersions).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getComparisonVersion(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(comparisonVersions).where(eq(comparisonVersions.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "材料对比版本不存在");
  return row;
}

/** 版本守卫：行存在 + 状态允许（材料/规则/证据子表共用） */
async function requireEditableVersion(app: FastifyInstance, versionId: string) {
  const row = await getComparisonVersion(app, versionId);
  assertEditable(row, "材料对比版本", CHILD_EDITABLE);
  return row;
}

export async function createComparisonVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ComparisonVersionCreateInput
) {
  const meta = VERSION_META();
  await assertKeyAvailable(app.db, meta, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(comparisonVersions).values({
      code: input.code,
      version: 1,
      name: input.name,
      description: input.description,
      changeNote: input.changeNote,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_VERSION_CREATED, targetType: "comparison_version", targetId: created!.id,
      afterJson: { code: input.code, name: input.name }
    });
    return created!;
  });
}

export async function updateComparisonVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<ComparisonVersionCreateInput>
) {
  const row = await getComparisonVersion(app, id);
  assertEditable(row, "材料对比版本", CHILD_EDITABLE);
  const set: Record<string, unknown> = { updatedById: actor.id };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(comparisonVersions).set(set)
      .where(eq(comparisonVersions.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_VERSION_UPDATED, targetType: "comparison_version", targetId: id,
      afterJson: { code: updated!.code, name: updated!.name }
    });
    return updated!;
  });
}

export async function deleteComparisonVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const row = await getComparisonVersion(app, id);
  assertEditable(row, "材料对比版本", ["DRAFT", "REJECTED"]);
  return app.db.transaction(async (tx) => {
    await tx.delete(comparisonVersions).where(eq(comparisonVersions.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_VERSION_DELETED, targetType: "comparison_version", targetId: id,
      afterJson: { code: row.code, name: row.name }
    });
    return { message: "材料对比版本草稿已删除" };
  });
}

// ---------------------------------------------------------------- 材料（子表）

export interface ComparisonMaterialCreateInput {
  category: "VICP" | "EPS" | "XPS" | "ROCK_WOOL" | "PU" | "TRADITIONAL_BOARD";
  name: string;
  model: string;
  density?: number | null;
  densityUnit?: string | null;
  testConditions?: string | null;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listComparisonMaterials(
  app: FastifyInstance,
  versionId: string,
  query: { page: number; pageSize: number; category?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    eq(comparisonMaterials.versionId, versionId),
    query.category ? eq(comparisonMaterials.category, query.category as never) : undefined,
    query.keyword
      ? or(
          ilike(comparisonMaterials.name, `%${query.keyword}%`),
          ilike(comparisonMaterials.model, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(comparisonMaterials).where(where).orderBy(desc(comparisonMaterials.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(comparisonMaterials).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createComparisonMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  versionId: string, input: ComparisonMaterialCreateInput
) {
  await requireEditableVersion(app, versionId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(comparisonMaterials).values({
      versionId,
      category: input.category,
      name: input.name,
      model: input.model,
      density: input.density,
      densityUnit: input.densityUnit,
      testConditions: input.testConditions,
      description: input.description,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_MATERIAL_CREATED, targetType: "comparison_material", targetId: created!.id,
      afterJson: { category: input.category, name: input.name, model: input.model }
    });
    return created!;
  });
}

export async function updateComparisonMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<ComparisonMaterialCreateInput>
) {
  const [row] = await app.db.select().from(comparisonMaterials).where(eq(comparisonMaterials.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "材料不存在");
  await requireEditableVersion(app, row.versionId);
  const set: Record<string, unknown> = { updatedById: actor.id };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(comparisonMaterials).set(set)
      .where(eq(comparisonMaterials.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_MATERIAL_UPDATED, targetType: "comparison_material", targetId: id,
      afterJson: { category: updated!.category, name: updated!.name, model: updated!.model }
    });
    return updated!;
  });
}

export async function deleteComparisonMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [row] = await app.db.select().from(comparisonMaterials).where(eq(comparisonMaterials.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "材料不存在");
  await requireEditableVersion(app, row.versionId);
  const [used] = await app.db.select({ id: comparisonRules.id }).from(comparisonRules)
    .where(or(eq(comparisonRules.vicpMaterialId, id), eq(comparisonRules.competitorMaterialId, id))).limit(1);
  if (used) throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "材料已被对比规则引用，不能删除");
  return app.db.transaction(async (tx) => {
    await tx.delete(comparisonMaterials).where(eq(comparisonMaterials.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_MATERIAL_DELETED, targetType: "comparison_material", targetId: id,
      afterJson: { category: row.category, name: row.name, model: row.model }
    });
    return { message: "材料已删除" };
  });
}

// ---------------------------------------------------------------- 维度（五维固定 + 子指标）

export interface ComparisonDimensionCreateInput {
  code: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  enabled?: boolean;
  remark?: string | null;
}

export async function listComparisonDimensions(app: FastifyInstance) {
  return app.db.select().from(comparisonDimensions)
    .orderBy(comparisonDimensions.sortOrder, comparisonDimensions.createdAt);
}

export async function createComparisonDimension(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ComparisonDimensionCreateInput
) {
  if (input.parentId) {
    const [parent] = await app.db.select({ id: comparisonDimensions.id }).from(comparisonDimensions)
      .where(eq(comparisonDimensions.id, input.parentId)).limit(1);
    if (!parent) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "父维度不存在");
  }
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(comparisonDimensions).values({
      code: input.code,
      name: input.name,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
      enabled: input.enabled ?? true,
      remark: input.remark,
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_DIMENSION_CREATED, targetType: "comparison_dimension", targetId: created!.id,
      afterJson: { code: input.code, name: input.name }
    });
    return created!;
  });
}

export async function updateComparisonDimension(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<ComparisonDimensionCreateInput>
) {
  const [row] = await app.db.select().from(comparisonDimensions).where(eq(comparisonDimensions.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "维度不存在");
  if (input.enabled === false && isFixedDimension(row)) {
    throw new ComparisonError("COMPARISON_DIMENSION_FIXED");
  }
  const set: Record<string, unknown> = { updatedById: actor.id };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(comparisonDimensions).set(set)
      .where(eq(comparisonDimensions.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_DIMENSION_UPDATED, targetType: "comparison_dimension", targetId: id,
      afterJson: { code: row.code, name: updated!.name, enabled: updated!.enabled }
    });
    return updated!;
  });
}

export async function deleteComparisonDimension(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [row] = await app.db.select().from(comparisonDimensions).where(eq(comparisonDimensions.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "维度不存在");
  if (isFixedDimension(row)) throw new ComparisonError("COMPARISON_DIMENSION_FIXED");
  const [child] = await app.db.select({ id: comparisonDimensions.id }).from(comparisonDimensions)
    .where(eq(comparisonDimensions.parentId, id)).limit(1);
  if (child) throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "维度下存在子指标，不能删除");
  const [used] = await app.db.select({ id: comparisonRules.id }).from(comparisonRules)
    .where(eq(comparisonRules.dimensionId, id)).limit(1);
  if (used) throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "维度已被对比规则引用，不能删除");
  return app.db.transaction(async (tx) => {
    await tx.delete(comparisonDimensions).where(eq(comparisonDimensions.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_DIMENSION_DELETED, targetType: "comparison_dimension", targetId: id,
      afterJson: { code: row.code, name: row.name }
    });
    return { message: "维度已删除" };
  });
}

function isFixedDimension(row: { code: string; parentId: string | null }): boolean {
  return row.parentId === null && (FIXED_DIMENSION_CODES as readonly string[]).includes(row.code);
}

// ---------------------------------------------------------------- 规则（子表）

export interface ComparisonRuleCreateInput {
  dimensionId: string;
  subIndicatorName?: string | null;
  vicpMaterialId: string;
  competitorMaterialId: string;
  benchmarkType: "SAME_THICKNESS" | "SAME_LAMBDA" | "SAME_R_VALUE" | "PERFORMANCE" | "OTHER";
  benchmarkDesc: string;
  vicpValue: number;
  vicpUnit: string;
  competitorValue?: number | null;
  competitorUnit?: string | null;
  advantageText: string;
  applicability: string;
  mandatoryDisclosure: string;
  forbiddenWording?: string | null;
  sortOrder?: number;
}

/** 规则引用校验：维度启用、双方材料同版本、类别正确（VICP 侧为 VICP、竞品侧非 VICP）、单位成对 */
export async function assertRuleReferences(
  app: FastifyInstance, versionId: string, input: ComparisonRuleCreateInput
): Promise<{ dimension: { id: string; name: string }; vicp: { id: string }; competitor: { id: string } }> {
  const [dimension] = await app.db.select({ id: comparisonDimensions.id, name: comparisonDimensions.name, enabled: comparisonDimensions.enabled })
    .from(comparisonDimensions).where(eq(comparisonDimensions.id, input.dimensionId)).limit(1);
  if (!dimension) throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "引用的维度不存在");
  if (!dimension.enabled) throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "引用的维度已禁用");
  const materials = await app.db.select().from(comparisonMaterials)
    .where(inArray(comparisonMaterials.id, [input.vicpMaterialId, input.competitorMaterialId]));
  const vicp = materials.find((m) => m.id === input.vicpMaterialId);
  const competitor = materials.find((m) => m.id === input.competitorMaterialId);
  if (!vicp || !competitor) {
    throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "双方材料必须属于当前版本");
  }
  if (vicp.versionId !== versionId || competitor.versionId !== versionId) {
    throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "双方材料必须属于当前版本");
  }
  if (vicp.category !== "VICP") {
    throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "VICP 侧材料类别必须为 VICP");
  }
  if (competitor.category === "VICP") {
    throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "竞品侧材料类别不能为 VICP");
  }
  if (input.competitorValue !== undefined && input.competitorValue !== null && !input.competitorUnit?.trim()) {
    throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "填写竞品侧数值时必须同时填写竞品侧单位");
  }
  return { dimension, vicp, competitor };
}

export async function listComparisonRules(
  app: FastifyInstance,
  versionId: string,
  query: { page: number; pageSize: number; dimensionId?: string; competitorCategory?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    eq(comparisonRules.versionId, versionId),
    query.dimensionId ? eq(comparisonRules.dimensionId, query.dimensionId) : undefined,
    query.competitorCategory
      ? inArray(
          comparisonRules.competitorMaterialId,
          app.db.select({ id: comparisonMaterials.id }).from(comparisonMaterials)
            .where(and(eq(comparisonMaterials.versionId, versionId), eq(comparisonMaterials.category, query.competitorCategory as never)))
        )
      : undefined,
    query.keyword
      ? or(
          ilike(comparisonRules.benchmarkDesc, `%${query.keyword}%`),
          ilike(comparisonRules.advantageText, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(comparisonRules).where(where).orderBy(comparisonRules.sortOrder, desc(comparisonRules.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(comparisonRules).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createComparisonRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  versionId: string, input: ComparisonRuleCreateInput
) {
  await requireEditableVersion(app, versionId);
  const { dimension } = await assertRuleReferences(app, versionId, input);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(comparisonRules).values({
      versionId,
      dimensionId: input.dimensionId,
      dimensionName: dimension.name,
      subIndicatorName: input.subIndicatorName,
      vicpMaterialId: input.vicpMaterialId,
      competitorMaterialId: input.competitorMaterialId,
      benchmarkType: input.benchmarkType,
      benchmarkDesc: input.benchmarkDesc,
      vicpValue: input.vicpValue,
      vicpUnit: input.vicpUnit,
      competitorValue: input.competitorValue ?? null,
      competitorUnit: input.competitorUnit ?? null,
      advantageText: input.advantageText,
      applicability: input.applicability,
      mandatoryDisclosure: input.mandatoryDisclosure,
      forbiddenWording: input.forbiddenWording,
      sortOrder: input.sortOrder ?? 0,
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_RULE_CREATED, targetType: "comparison_rule", targetId: created!.id,
      afterJson: { dimensionId: input.dimensionId, benchmarkDesc: input.benchmarkDesc }
    });
    return created!;
  });
}

export async function updateComparisonRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<ComparisonRuleCreateInput>
) {
  const [row] = await app.db.select().from(comparisonRules).where(eq(comparisonRules.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "对比规则不存在");
  await requireEditableVersion(app, row.versionId);
  let refreshedDimensionName: string | undefined;
  if (input.vicpMaterialId || input.competitorMaterialId || input.dimensionId) {
    const refs = await assertRuleReferences(app, row.versionId, {
      dimensionId: input.dimensionId ?? row.dimensionId,
      vicpMaterialId: input.vicpMaterialId ?? row.vicpMaterialId,
      competitorMaterialId: input.competitorMaterialId ?? row.competitorMaterialId,
      benchmarkType: input.benchmarkType ?? row.benchmarkType,
      benchmarkDesc: input.benchmarkDesc ?? row.benchmarkDesc,
      vicpValue: input.vicpValue ?? row.vicpValue,
      vicpUnit: input.vicpUnit ?? row.vicpUnit,
      competitorValue: input.competitorValue !== undefined ? input.competitorValue : row.competitorValue,
      competitorUnit: input.competitorUnit !== undefined ? input.competitorUnit : row.competitorUnit,
      advantageText: input.advantageText ?? row.advantageText,
      applicability: input.applicability ?? row.applicability,
      mandatoryDisclosure: input.mandatoryDisclosure ?? row.mandatoryDisclosure
    });
    if (input.dimensionId) refreshedDimensionName = refs.dimension.name;
  }
  const set: Record<string, unknown> = { updatedById: actor.id };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }
  if (refreshedDimensionName) set.dimensionName = refreshedDimensionName;
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(comparisonRules).set(set)
      .where(eq(comparisonRules.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_RULE_UPDATED, targetType: "comparison_rule", targetId: id,
      afterJson: { dimensionId: updated!.dimensionId, benchmarkDesc: updated!.benchmarkDesc }
    });
    return updated!;
  });
}

export async function deleteComparisonRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [row] = await app.db.select().from(comparisonRules).where(eq(comparisonRules.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "对比规则不存在");
  await requireEditableVersion(app, row.versionId);
  return app.db.transaction(async (tx) => {
    await tx.delete(comparisonRules).where(eq(comparisonRules.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_RULE_DELETED, targetType: "comparison_rule", targetId: id,
      afterJson: { dimensionId: row.dimensionId, benchmarkDesc: row.benchmarkDesc }
    });
    return { message: "对比规则已删除" };
  });
}

// ---------------------------------------------------------------- 批量导入（材料 + 规则，单事务）

interface BatchMaterialRow extends ComparisonMaterialCreateInput {
  materialKey: string;
}
interface BatchRuleRow {
  vicpMaterialKey: string;
  competitorMaterialKey: string;
  dimensionId: string;
  subIndicatorName?: string | null;
  benchmarkType: ComparisonRuleCreateInput["benchmarkType"];
  benchmarkDesc: string;
  vicpValue: number;
  vicpUnit: string;
  competitorValue?: number | null;
  competitorUnit?: string | null;
  advantageText: string;
  applicability: string;
  mandatoryDisclosure: string;
  forbiddenWording?: string | null;
  sortOrder?: number;
}

/** 批量导入：先按 materialKey 建/复用材料，再按 key 解析规则引用；任一校验失败整体回滚 */
export async function batchCreateComparisonRules(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  versionId: string, input: { materials?: BatchMaterialRow[]; rules: BatchRuleRow[] }
) {
  await requireEditableVersion(app, versionId);
  const materials = input.materials ?? [];
  const rules = input.rules;
  return app.db.transaction(async (tx) => {
    const keyToId = new Map<string, string>();
    for (const material of materials) {
      const [existing] = await tx.select({ id: comparisonMaterials.id }).from(comparisonMaterials)
        .where(and(
          eq(comparisonMaterials.versionId, versionId),
          eq(comparisonMaterials.category, material.category),
          eq(comparisonMaterials.name, material.name),
          eq(comparisonMaterials.model, material.model)
        )).limit(1);
      const materialId = existing?.id ?? (await tx.insert(comparisonMaterials).values({
        versionId,
        category: material.category,
        name: material.name,
        model: material.model,
        density: material.density ?? null,
        densityUnit: material.densityUnit ?? null,
        testConditions: material.testConditions ?? null,
        description: material.description ?? null,
        evidenceSource: material.evidenceSource ?? null,
        evidenceRef: material.evidenceRef ?? null,
        evidenceLevel: material.evidenceLevel ?? null,
        effectiveAt: material.effectiveAt ?? null,
        expiresAt: material.expiresAt ?? null,
        createdById: actor.id,
        updatedById: actor.id
      }).returning({ id: comparisonMaterials.id }))[0]!.id;
      keyToId.set(material.materialKey, materialId);
    }

    const createdRules = [];
    for (const rule of rules) {
      const vicpMaterialId = keyToId.get(rule.vicpMaterialKey);
      const competitorMaterialId = keyToId.get(rule.competitorMaterialKey);
      if (!vicpMaterialId || !competitorMaterialId) {
        throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", `规则引用的材料 key 不存在：${rule.vicpMaterialKey ?? ""} / ${rule.competitorMaterialKey ?? ""}`);
      }
      const refs = await assertRuleReferences(app, versionId, {
        dimensionId: rule.dimensionId,
        subIndicatorName: rule.subIndicatorName,
        vicpMaterialId,
        competitorMaterialId,
        benchmarkType: rule.benchmarkType,
        benchmarkDesc: rule.benchmarkDesc,
        vicpValue: rule.vicpValue,
        vicpUnit: rule.vicpUnit,
        competitorValue: rule.competitorValue,
        competitorUnit: rule.competitorUnit,
        advantageText: rule.advantageText,
        applicability: rule.applicability,
        mandatoryDisclosure: rule.mandatoryDisclosure,
        forbiddenWording: rule.forbiddenWording,
        sortOrder: rule.sortOrder
      });
      const [created] = await tx.insert(comparisonRules).values({
        versionId,
        dimensionId: rule.dimensionId,
        dimensionName: refs.dimension.name,
        subIndicatorName: rule.subIndicatorName ?? null,
        vicpMaterialId,
        competitorMaterialId,
        benchmarkType: rule.benchmarkType,
        benchmarkDesc: rule.benchmarkDesc,
        vicpValue: rule.vicpValue,
        vicpUnit: rule.vicpUnit,
        competitorValue: rule.competitorValue ?? null,
        competitorUnit: rule.competitorUnit ?? null,
        advantageText: rule.advantageText,
        applicability: rule.applicability,
        mandatoryDisclosure: rule.mandatoryDisclosure,
        forbiddenWording: rule.forbiddenWording ?? null,
        sortOrder: rule.sortOrder ?? 0,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      createdRules.push(created!);
    }

    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_RULE_BATCH_CREATED, targetType: "comparison_version", targetId: versionId,
      afterJson: { materials: materials.length, rules: rules.length }
    });
    const inserted = await tx.select().from(comparisonMaterials).where(eq(comparisonMaterials.versionId, versionId));
    return { materials: inserted, rules: createdRules };
  });
}

// ---------------------------------------------------------------- 证据（子表）

export interface ComparisonEvidenceCreateInput {
  materialId?: string | null;
  side: "VICP" | "COMPETITOR";
  source: string;
  pageRef?: string | null;
  clauseRef?: string | null;
  evidenceLevel: "A" | "B" | "C";
  quote?: string | null;
}

export async function listComparisonEvidence(app: FastifyInstance, versionId: string) {
  return app.db.select().from(comparisonEvidence).where(eq(comparisonEvidence.versionId, versionId))
    .orderBy(desc(comparisonEvidence.createdAt));
}

export async function createComparisonEvidence(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  ruleId: string, input: ComparisonEvidenceCreateInput
) {
  const [rule] = await app.db.select().from(comparisonRules).where(eq(comparisonRules.id, ruleId)).limit(1);
  if (!rule) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "对比规则不存在");
  await requireEditableVersion(app, rule.versionId);
  if (input.materialId) {
    const [material] = await app.db.select().from(comparisonMaterials).where(eq(comparisonMaterials.id, input.materialId)).limit(1);
    if (!material || material.versionId !== rule.versionId) {
      throw new ComparisonError("COMPARISON_STRUCTURE_INVALID", "证据引用的材料必须与规则同属一个版本");
    }
  }
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(comparisonEvidence).values({
      versionId: rule.versionId,
      ruleId,
      materialId: input.materialId ?? null,
      side: input.side,
      source: input.source,
      pageRef: input.pageRef,
      clauseRef: input.clauseRef,
      evidenceLevel: input.evidenceLevel,
      quote: input.quote,
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_EVIDENCE_CREATED, targetType: "comparison_evidence", targetId: created!.id,
      afterJson: { ruleId, side: input.side, source: input.source }
    });
    return created!;
  });
}

export async function updateComparisonEvidence(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<ComparisonEvidenceCreateInput>
) {
  const [row] = await app.db.select().from(comparisonEvidence).where(eq(comparisonEvidence.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "证据不存在");
  await requireEditableVersion(app, row.versionId);
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(comparisonEvidence).set(set)
      .where(eq(comparisonEvidence.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_EVIDENCE_UPDATED, targetType: "comparison_evidence", targetId: id,
      afterJson: { side: updated!.side, source: updated!.source }
    });
    return updated!;
  });
}

export async function deleteComparisonEvidence(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [row] = await app.db.select().from(comparisonEvidence).where(eq(comparisonEvidence.id, id)).limit(1);
  if (!row) throw new ComparisonError("COMPARISON_ENTITY_NOT_FOUND", "证据不存在");
  await requireEditableVersion(app, row.versionId);
  return app.db.transaction(async (tx) => {
    await tx.delete(comparisonEvidence).where(eq(comparisonEvidence.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_EVIDENCE_DELETED, targetType: "comparison_evidence", targetId: id,
      afterJson: { side: row.side, source: row.source }
    });
    return { message: "证据已删除" };
  });
}

// ---------------------------------------------------------------- 结构校验（submit/publish 前置）

export interface ComparisonViolation {
  field: string;
  message: string;
}

export async function collectComparisonViolations(app: FastifyInstance, versionId: string): Promise<ComparisonViolation[]> {
  const violations: ComparisonViolation[] = [];

  const rules = await app.db.select().from(comparisonRules).where(eq(comparisonRules.versionId, versionId));
  if (rules.length === 0) {
    violations.push({ field: "rules", message: "版本没有任何对比规则，无法提交审核" });
    return violations;
  }

  const materialIds = [...new Set(rules.flatMap((r) => [r.vicpMaterialId, r.competitorMaterialId]))];
  const materials = await app.db.select().from(comparisonMaterials).where(inArray(comparisonMaterials.id, materialIds));
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const evidence = await app.db.select().from(comparisonEvidence)
    .where(inArray(comparisonEvidence.ruleId, rules.map((r) => r.id)));

  for (const rule of rules) {
    const vicp = materialMap.get(rule.vicpMaterialId);
    const competitor = materialMap.get(rule.competitorMaterialId);
    if (!vicp || vicp.category !== "VICP") {
      violations.push({ field: `rules.${rule.id}.vicpMaterialId`, message: "VICP 侧材料缺失或类别不正确" });
    }
    if (!competitor || competitor.category === "VICP") {
      violations.push({ field: `rules.${rule.id}.competitorMaterialId`, message: "竞品侧材料缺失或类别不正确" });
    }
    if (rule.vicpValue <= 0) {
      violations.push({ field: `rules.${rule.id}.vicpValue`, message: "VICP 侧数值必须大于 0" });
    }
    if (rule.competitorValue !== null && !rule.competitorUnit?.trim()) {
      violations.push({ field: `rules.${rule.id}.competitorUnit`, message: "填写竞品侧数值时必须同时填写竞品侧单位" });
    }
    const ruleEvidence = evidence.filter((e) => e.ruleId === rule.id);
    if (!ruleEvidence.some((e) => e.side === "VICP")) {
      violations.push({ field: `rules.${rule.id}.evidence`, message: "规则必须至少有一条 VICP 侧证据" });
    }
    if (rule.competitorValue !== null && !ruleEvidence.some((e) => e.side === "COMPETITOR")) {
      violations.push({ field: `rules.${rule.id}.evidence`, message: "填写竞品侧数值时必须提供竞品侧证据" });
    }
    if (!rule.advantageText?.trim() || !rule.applicability?.trim() || !rule.mandatoryDisclosure?.trim()) {
      violations.push({ field: `rules.${rule.id}.texts`, message: "优势文案、适用条件与必要披露均不能为空" });
    }
  }

  const [version] = await app.db.select({
    effectiveAt: comparisonVersions.effectiveAt, expiresAt: comparisonVersions.expiresAt
  }).from(comparisonVersions).where(eq(comparisonVersions.id, versionId)).limit(1);
  if (version?.effectiveAt && version?.expiresAt && version.effectiveAt > version.expiresAt) {
    violations.push({ field: "effectiveAt/expiresAt", message: "生效时间晚于失效时间" });
  }
  return violations;
}

/** submit/publish 前置校验：不通过直接抛 COMPARISON_STRUCTURE_INVALID */
export async function validateComparison(app: FastifyInstance, versionId: string): Promise<void> {
  const violations = await collectComparisonViolations(app, versionId);
  if (violations.length > 0) {
    throw new ComparisonError(
      "COMPARISON_STRUCTURE_INVALID",
      `材料对比版本结构校验未通过：${violations.map((v) => v.message).join("；")}`
    );
  }
}

// ---------------------------------------------------------------- new-version 子表复制（历史快照不漂移）

/**
 * 派生新版本时同事务复制材料/规则/证据，并重映射内部引用：
 * materials -> rules（双方材料引用）-> evidence（ruleId/materialId 引用）。
 */
export async function copyComparisonChildren(
  tx: DbExecutor,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Promise<void> {
  const oldVersionId = oldRow.id as string;
  const newVersionId = newRow.id as string;

  const oldMaterials = await tx.select().from(comparisonMaterials).where(eq(comparisonMaterials.versionId, oldVersionId));
  const materialIdMap = new Map<string, string>();
  for (const material of oldMaterials) {
    const [inserted] = await tx.insert(comparisonMaterials).values({
      versionId: newVersionId,
      category: material.category,
      name: material.name,
      model: material.model,
      density: material.density,
      densityUnit: material.densityUnit,
      testConditions: material.testConditions,
      description: material.description,
      evidenceSource: material.evidenceSource,
      evidenceRef: material.evidenceRef,
      evidenceLevel: material.evidenceLevel,
      effectiveAt: material.effectiveAt,
      expiresAt: material.expiresAt,
      createdById: material.createdById,
      updatedById: material.updatedById
    }).returning({ id: comparisonMaterials.id });
    materialIdMap.set(material.id, inserted!.id);
  }

  const oldRules = await tx.select().from(comparisonRules).where(eq(comparisonRules.versionId, oldVersionId));
  const ruleIdMap = new Map<string, string>();
  for (const rule of oldRules) {
    const [inserted] = await tx.insert(comparisonRules).values({
      versionId: newVersionId,
      dimensionId: rule.dimensionId,
      dimensionName: rule.dimensionName,
      subIndicatorName: rule.subIndicatorName,
      vicpMaterialId: materialIdMap.get(rule.vicpMaterialId) ?? rule.vicpMaterialId,
      competitorMaterialId: materialIdMap.get(rule.competitorMaterialId) ?? rule.competitorMaterialId,
      benchmarkType: rule.benchmarkType,
      benchmarkDesc: rule.benchmarkDesc,
      vicpValue: rule.vicpValue,
      vicpUnit: rule.vicpUnit,
      competitorValue: rule.competitorValue,
      competitorUnit: rule.competitorUnit,
      advantageText: rule.advantageText,
      applicability: rule.applicability,
      mandatoryDisclosure: rule.mandatoryDisclosure,
      forbiddenWording: rule.forbiddenWording,
      sortOrder: rule.sortOrder,
      createdById: rule.createdById,
      updatedById: rule.updatedById
    }).returning({ id: comparisonRules.id });
    ruleIdMap.set(rule.id, inserted!.id);
  }

  const oldEvidence = await tx.select().from(comparisonEvidence).where(eq(comparisonEvidence.versionId, oldVersionId));
  if (oldEvidence.length > 0) {
    await tx.insert(comparisonEvidence).values(oldEvidence.map((evidence) => ({
      versionId: newVersionId,
      ruleId: evidence.ruleId ? (ruleIdMap.get(evidence.ruleId) ?? null) : null,
      materialId: evidence.materialId ? (materialIdMap.get(evidence.materialId) ?? null) : null,
      side: evidence.side,
      source: evidence.source,
      pageRef: evidence.pageRef,
      clauseRef: evidence.clauseRef,
      evidenceLevel: evidence.evidenceLevel,
      quote: evidence.quote,
      createdById: evidence.createdById
    })));
  }
}