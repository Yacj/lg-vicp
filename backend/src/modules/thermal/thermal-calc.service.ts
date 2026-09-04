import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, inArray, or, ilike, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  productParameters,
  projects as projectsTable,
  thermalCalcRecords,
  thermalCalcRules,
  thermalReferenceRows,
  thermalStandardLimits,
  type ProductParameter
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ThermalError } from "../../shared/thermal-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { canViewProject, isSuperAdmin } from "../../shared/permissions.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  registerVersionedEntity,
  type MdReviewStatus
} from "../masterdata/md-workflow.service.js";
import { listPublishedMaterialParameters, listPublishedProductParameters } from "../masterdata/md-read.service.js";
import { getPublishedConstructionSchemeDetail } from "../construction/construction-read.service.js";
import { effectiveRangeConditions, publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { listPublishedThermalSets } from "./thermal-read.service.js";
import {
  calculateThermal,
  judgeCompliance,
  roundBy,
  type CalcLayer,
  type ResolvedRules
} from "./thermal-calculator.js";

/**
 * 确定性热工计算引擎服务。
 * - 规则 / 标准限值：版本化实体（复用 masterdata 状态机），只读 PUBLISHED + 生效中数据；
 * - 计算执行：只接受标识入参，数值参数（λ/修正系数/限值）全部从已发布数据加载；
 * - 结果落库保存输入/构造层/参数/规则/标准/公式/中间过程快照，历史结果不随后台参数漂移；
 * - 计算失败返回字段级 errors（{field, code, message}），不吞来源、版本、适用条件与错误信息。
 */

/** 计算审计动作（audit_logs.action 为 varchar，直接使用稳定字符串） */
const THERMAL_CALC_EXECUTED = "thermal.calc_executed";

// 模块加载时注册版本化实体元数据（复用 masterdata 状态机）
registerVersionedEntity("thermalCalcRule", {
  table: thermalCalcRules,
  idColumn: thermalCalcRules.id,
  statusColumn: thermalCalcRules.status,
  versionColumn: thermalCalcRules.version,
  keyColumns: [thermalCalcRules.code],
  kind: "thermal_calc_rule",
  label: "热工计算规则"
});
registerVersionedEntity("thermalStandardLimit", {
  table: thermalStandardLimits,
  idColumn: thermalStandardLimits.id,
  statusColumn: thermalStandardLimits.status,
  versionColumn: thermalStandardLimits.version,
  keyColumns: [thermalStandardLimits.regionCode, thermalStandardLimits.basisCode],
  kind: "thermal_standard_limit",
  label: "地区标准限值"
});

const RULE_META = () => ({
  label: "热工计算规则",
  editable: ["DRAFT", "PENDING_REVIEW", "REJECTED"] as MdReviewStatus[]
});
const LIMIT_META = () => ({
  label: "地区标准限值",
  editable: ["DRAFT", "PENDING_REVIEW", "REJECTED"] as MdReviewStatus[]
});

// ---------------------------------------------------------------- 计算规则 CRUD

export interface CalcRuleInput {
  code: string;
  name: string;
  formulaVersion: string;
  interiorSurfaceResistance: number;
  exteriorSurfaceResistance: number;
  precision: number;
  roundingMode: "HALF_UP" | "HALF_EVEN" | "TRUNCATE" | "NONE";
  compareField: "K_VALUE" | "TOTAL_RESISTANCE";
  compareOperator: "LTE" | "GTE";
  includeNonProductLayers: boolean;
  includeSurfaceResistances: boolean;
  parameterCodes: { equivalentConductivity: string; correctionFactor: string };
  paramSourcePriority: string[];
  usage?: string | null;
  applicableScope?: string | null;
  changeNote?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listCalcRules(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(thermalCalcRules.status, query.status as never) : undefined,
    query.keyword
      ? or(
          ilike(thermalCalcRules.code, `%${query.keyword}%`),
          ilike(thermalCalcRules.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalCalcRules).where(where).orderBy(desc(thermalCalcRules.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalCalcRules).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getCalcRule(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(thermalCalcRules).where(eq(thermalCalcRules.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "热工计算规则不存在");
  return row;
}

export async function createCalcRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: CalcRuleInput
) {
  const meta = RULE_META();
  await assertKeyAvailable(app.db, {
    table: thermalCalcRules,
    idColumn: thermalCalcRules.id,
    statusColumn: thermalCalcRules.status,
    versionColumn: thermalCalcRules.version,
    keyColumns: [thermalCalcRules.code],
    kind: "thermal_calc_rule",
    label: meta.label
  }, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalCalcRules).values({
      code: input.code,
      version: 1,
      name: input.name,
      formulaVersion: input.formulaVersion,
      interiorSurfaceResistance: input.interiorSurfaceResistance,
      exteriorSurfaceResistance: input.exteriorSurfaceResistance,
      precision: input.precision,
      roundingMode: input.roundingMode,
      compareField: input.compareField,
      compareOperator: input.compareOperator,
      includeNonProductLayers: input.includeNonProductLayers,
      includeSurfaceResistances: input.includeSurfaceResistances,
      parameterCodes: input.parameterCodes,
      paramSourcePriority: input.paramSourcePriority,
      usage: input.usage ?? null,
      applicableScope: input.applicableScope ?? null,
      evidenceSource: input.evidenceSource ?? null,
      evidenceRef: input.evidenceRef ?? null,
      evidenceLevel: input.evidenceLevel ?? null,
      effectiveAt: input.effectiveAt ?? null,
      expiresAt: input.expiresAt ?? null,
      changeNote: input.changeNote ?? null,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "thermal_calc_rule", targetId: created!.id,
      afterJson: { code: created!.code, name: created!.name, version: created!.version }
    });
    return created!;
  });
}

export async function updateCalcRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<CalcRuleInput>
) {
  const meta = RULE_META();
  const [existing] = await app.db.select().from(thermalCalcRules).where(eq(thermalCalcRules.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "热工计算规则不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, meta.editable);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(thermalCalcRules).set({
      name: input.name ?? existing.name,
      formulaVersion: input.formulaVersion ?? existing.formulaVersion,
      interiorSurfaceResistance: input.interiorSurfaceResistance ?? existing.interiorSurfaceResistance,
      exteriorSurfaceResistance: input.exteriorSurfaceResistance ?? existing.exteriorSurfaceResistance,
      precision: input.precision ?? existing.precision,
      roundingMode: input.roundingMode ?? existing.roundingMode,
      compareField: input.compareField ?? existing.compareField,
      compareOperator: input.compareOperator ?? existing.compareOperator,
      includeNonProductLayers: input.includeNonProductLayers ?? existing.includeNonProductLayers,
      includeSurfaceResistances: input.includeSurfaceResistances ?? existing.includeSurfaceResistances,
      parameterCodes: input.parameterCodes ?? existing.parameterCodes,
      paramSourcePriority: input.paramSourcePriority ?? existing.paramSourcePriority,
      usage: input.usage === undefined ? existing.usage : input.usage,
      applicableScope: input.applicableScope === undefined ? existing.applicableScope : input.applicableScope,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(thermalCalcRules.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "thermal_calc_rule", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteCalcRule(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = RULE_META();
  const [existing] = await app.db.select().from(thermalCalcRules).where(eq(thermalCalcRules.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "热工计算规则不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(thermalCalcRules).where(eq(thermalCalcRules.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "thermal_calc_rule", targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "热工计算规则草稿已删除" };
}

/** 规则结构校验：精度/公式版本/参数码映射/表面换热阻/生效区间合法 */
export function collectCalcRuleViolations(input: {
  precision?: number;
  interiorSurfaceResistance?: number;
  exteriorSurfaceResistance?: number;
  formulaVersion?: string;
  parameterCodes?: { equivalentConductivity?: string; correctionFactor?: string };
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}) {
  const violations: { field: string; message: string }[] = [];
  if (input.precision !== undefined && (input.precision < 0 || input.precision > 8)) {
    violations.push({ field: "precision", message: "精度必须在 0 到 8 位小数之间" });
  }
  if (input.interiorSurfaceResistance !== undefined && input.interiorSurfaceResistance <= 0) {
    violations.push({ field: "interiorSurfaceResistance", message: "内表面换热阻必须大于 0" });
  }
  if (input.exteriorSurfaceResistance !== undefined && input.exteriorSurfaceResistance <= 0) {
    violations.push({ field: "exteriorSurfaceResistance", message: "外表面换热阻必须大于 0" });
  }
  if (input.formulaVersion !== undefined && !input.formulaVersion.trim()) {
    violations.push({ field: "formulaVersion", message: "公式版本必填" });
  }
  if (input.parameterCodes !== undefined && (!input.parameterCodes.equivalentConductivity?.trim() || !input.parameterCodes.correctionFactor?.trim())) {
    violations.push({ field: "parameterCodes", message: "当量导热系数与修正系数的参数码必填" });
  }
  if (input.evidenceSource !== undefined && !input.evidenceSource?.trim()) {
    violations.push({ field: "evidenceSource", message: "来源文档必填" });
  }
  if (input.evidenceRef !== undefined && !input.evidenceRef?.trim()) {
    violations.push({ field: "evidenceRef", message: "条款/页码必填" });
  }
  if (input.effectiveAt && input.expiresAt && input.effectiveAt > input.expiresAt) {
    violations.push({ field: "effectiveAt/expiresAt", message: "生效时间晚于失效时间" });
  }
  return violations;
}

export async function validateCalcRule(app: FastifyInstance, id: string): Promise<void> {
  const violations = await collectCalcRuleViolationsById(app, id);
  if (violations.length > 0) {
    throw new ThermalError("THERMAL_STRUCTURE_INVALID", `热工计算规则结构校验未通过：${violations.map((v) => v.message).join("；")}`);
  }
}

/** 显式结构校验（validate 端点用）：查行后返回违规明细，行不存在抛 404 */
export async function collectCalcRuleViolationsById(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(thermalCalcRules).where(eq(thermalCalcRules.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "热工计算规则不存在");
  return collectCalcRuleViolations(row);
}

// ---------------------------------------------------------------- 地区标准限值 CRUD

export interface StandardLimitInput {
  regionCode: string;
  regionName: string;
  basisCode: string;
  basisName: string;
  clauseRef: string;
  limitKValue: number;
  changeNote?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listStandardLimits(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: string; regionCode?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(thermalStandardLimits.status, query.status as never) : undefined,
    query.regionCode ? eq(thermalStandardLimits.regionCode, query.regionCode) : undefined,
    query.keyword
      ? or(
          ilike(thermalStandardLimits.regionName, `%${query.keyword}%`),
          ilike(thermalStandardLimits.basisName, `%${query.keyword}%`),
          ilike(thermalStandardLimits.clauseRef, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalStandardLimits).where(where).orderBy(desc(thermalStandardLimits.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalStandardLimits).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getStandardLimit(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(thermalStandardLimits).where(eq(thermalStandardLimits.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "地区标准限值不存在");
  return row;
}

export async function createStandardLimit(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: StandardLimitInput
) {
  const meta = LIMIT_META();
  await assertKeyAvailable(app.db, {
    table: thermalStandardLimits,
    idColumn: thermalStandardLimits.id,
    statusColumn: thermalStandardLimits.status,
    versionColumn: thermalStandardLimits.version,
    keyColumns: [thermalStandardLimits.regionCode, thermalStandardLimits.basisCode],
    kind: "thermal_standard_limit",
    label: meta.label
  }, { regionCode: input.regionCode, basisCode: input.basisCode });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalStandardLimits).values({
      regionCode: input.regionCode,
      version: 1,
      regionName: input.regionName,
      basisCode: input.basisCode,
      basisName: input.basisName,
      clauseRef: input.clauseRef,
      limitKValue: input.limitKValue,
      changeNote: input.changeNote ?? null,
      evidenceSource: input.evidenceSource ?? null,
      evidenceRef: input.evidenceRef ?? null,
      evidenceLevel: input.evidenceLevel ?? null,
      effectiveAt: input.effectiveAt ?? null,
      expiresAt: input.expiresAt ?? null,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "thermal_standard_limit", targetId: created!.id,
      afterJson: { regionCode: created!.regionCode, basisCode: created!.basisCode, version: created!.version }
    });
    return created!;
  });
}

export async function updateStandardLimit(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<StandardLimitInput>
) {
  const meta = LIMIT_META();
  const [existing] = await app.db.select().from(thermalStandardLimits).where(eq(thermalStandardLimits.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "地区标准限值不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, meta.editable);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(thermalStandardLimits).set({
      regionName: input.regionName ?? existing.regionName,
      basisName: input.basisName ?? existing.basisName,
      clauseRef: input.clauseRef ?? existing.clauseRef,
      limitKValue: input.limitKValue ?? existing.limitKValue,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(thermalStandardLimits.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "thermal_standard_limit", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteStandardLimit(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = LIMIT_META();
  const [existing] = await app.db.select().from(thermalStandardLimits).where(eq(thermalStandardLimits.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "地区标准限值不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(thermalStandardLimits).where(eq(thermalStandardLimits.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "thermal_standard_limit", targetId: id,
      beforeJson: { regionCode: existing.regionCode, basisCode: existing.basisCode, version: existing.version }
    });
  });
  return { message: "地区标准限值草稿已删除" };
}

/** 限值结构校验：K 值限值 > 0、证据必填、生效区间合法 */
export function collectStandardLimitViolations(input: {
  limitKValue?: number;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}) {
  const violations: { field: string; message: string }[] = [];
  if (input.limitKValue !== undefined && input.limitKValue <= 0) {
    violations.push({ field: "limitKValue", message: "K 值限值必须大于 0" });
  }
  if (input.evidenceSource !== undefined && !input.evidenceSource?.trim()) {
    violations.push({ field: "evidenceSource", message: "来源文档必填" });
  }
  if (input.evidenceRef !== undefined && !input.evidenceRef?.trim()) {
    violations.push({ field: "evidenceRef", message: "条款/页码必填" });
  }
  if (input.effectiveAt && input.expiresAt && input.effectiveAt > input.expiresAt) {
    violations.push({ field: "effectiveAt/expiresAt", message: "生效时间晚于失效时间" });
  }
  return violations;
}

export async function validateStandardLimit(app: FastifyInstance, id: string): Promise<void> {
  const violations = await collectStandardLimitViolationsById(app, id);
  if (violations.length > 0) {
    throw new ThermalError("THERMAL_STRUCTURE_INVALID", `地区标准限值结构校验未通过：${violations.map((v) => v.message).join("；")}`);
  }
}

/** 显式结构校验（validate 端点用）：查行后返回违规明细，行不存在抛 404 */
export async function collectStandardLimitViolationsById(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(thermalStandardLimits).where(eq(thermalStandardLimits.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "地区标准限值不存在");
  return collectStandardLimitViolations(row);
}

// ---------------------------------------------------------------- 已发布取数

/** 取最新已发布规则：ruleCode 指定时精确匹配，否则取最新版本；无则返回 null */
async function resolvePublishedRule(app: FastifyInstance, ruleCode?: string) {
  const [rule] = await app.db.select().from(thermalCalcRules)
    .where(and(
      eq(thermalCalcRules.status, "PUBLISHED"),
      ...effectiveRangeConditions(thermalCalcRules),
      ruleCode ? eq(thermalCalcRules.code, ruleCode) : undefined
    ))
    .orderBy(desc(thermalCalcRules.version)).limit(1);
  return rule ?? null;
}

/** 取已发布标准限值（regionCode + 最新版本）；无则返回 null（不阻断计算，compliant=null） */
async function resolvePublishedLimit(app: FastifyInstance, regionCode?: string) {
  if (!regionCode) return null;
  const [limit] = await app.db.select().from(thermalStandardLimits)
    .where(and(
      eq(thermalStandardLimits.regionCode, regionCode),
      ...publishedReferenceConditions(thermalStandardLimits)
    ))
    .orderBy(desc(thermalStandardLimits.version)).limit(1);
  return limit ?? null;
}

/** 按来源优先级取产品参数：空优先级取最新版本；配置优先级取第一个命中的来源；无命中返回 null */
function pickParameter(rows: ProductParameter[], priority: string[]): ProductParameter | null {
  if (rows.length === 0) return null;
  if (priority.length === 0) {
    return rows.reduce((best, row) => (row.version > best.version ? row : best));
  }
  for (const source of priority) {
    const hit = rows.find((row) => row.paramSource === source);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- 计算执行

export interface ThermalCalcInput {
  mode: "REFERENCE_TABLE" | "EQUIVALENT" | "LAYERED";
  schemeId: string;
  productSpecId: string;
  thicknessMm: number;
  regionCode?: string;
  ruleCode?: string;
  projectId?: string | null;
}

export interface ThermalCalcFieldError {
  field: string;
  code: string;
  message: string;
}

export interface ThermalCalcExecution {
  valid: boolean;
  errors: ThermalCalcFieldError[];
  notes: string[];
  record: ReturnType<typeof toRecordDto> | null;
}

/**
 * 执行确定性计算并落库快照：
 * - 取数只走已发布读取（方案/规格/参数/规则/限值），禁止读取草稿与待审核数据；
 * - REFERENCE_TABLE：精确匹配已发布图集行，不重复计算、不插值；
 * - EQUIVALENT / LAYERED：calculator 纯函数计算；
 * - 落库与审计同一事务；输入校验失败不落库（未发生计算）。
 */
export async function executeThermalCalc(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ThermalCalcInput
): Promise<ThermalCalcExecution> {
  const errors: ThermalCalcFieldError[] = [];
  const notes: string[] = [];

  // 1) 构造方案与产品选项（已发布生效）
  const scheme = await getPublishedConstructionSchemeDetail(app.db, input.schemeId);
  const option = scheme.productOptions.find((o) => o.productSpecId === input.productSpecId);
  if (!option) {
    return {
      valid: false,
      errors: [{ field: "productSpecId", code: "CALC_OPTION_MISSING", message: "该产品规格不在构造方案的产品选项内" }],
      notes, record: null
    };
  }
  if (input.thicknessMm < option.minThickness || input.thicknessMm > option.maxThickness) {
    return {
      valid: false,
      errors: [{
        field: "thicknessMm",
        code: "CALC_THICKNESS_OUT_OF_RANGE",
        message: `产品厚度 ${input.thicknessMm}mm 不在方案允许区间 [${option.minThickness}, ${option.maxThickness}]mm 内`
      }],
      notes, record: null
    };
  }

  // 2) 规则与标准限值（REFERENCE_TABLE 无规则也可查表，判定缺省）
  const rule = await resolvePublishedRule(app, input.ruleCode);
  if (input.mode !== "REFERENCE_TABLE" && !rule) {
    return {
      valid: false,
      errors: [{
        field: "ruleCode",
        code: "THERMAL_CALC_RULE_NOT_PUBLISHED",
        message: "没有已发布且生效中的计算规则，图集查表无结果时不允许自行计算（请先在后台配置并审核发布规则）"
      }],
      notes, record: null
    };
  }
  const limit = await resolvePublishedLimit(app, input.regionCode);
  if (input.regionCode && !limit) {
    notes.push(`地区 ${input.regionCode} 没有已发布且生效中的标准限值，合格判定暂缺`);
  }

  // 3) REFERENCE_TABLE：直接返回已发布图集行（精确匹配，不重复计算、不插值）
  if (input.mode === "REFERENCE_TABLE") {
    return executeReferenceTable(app, request, actor, input, rule, limit, notes);
  }

  // 4) 材料参数（LAYERED 与 EQUIVALENT 其余层）：已发布材料参数版本
  const materialParams = new Map<string, { lambda: number; correctionFactor: number | null; snapshot: Record<string, unknown> }>();
  const materialIds = [...new Set(scheme.layers.map((l) => l.materialId).filter((id): id is string => id !== null))];
  for (const materialId of materialIds) {
    const rows = await listPublishedMaterialParameters(app.db, { materialId });
    const latest = rows[0];
    if (!latest) {
      errors.push({
        field: "materialId",
        code: "CALC_PARAM_MISSING",
        message: `构造层引用的材料 ${materialId} 没有已发布且生效中的材料参数版本`
      });
      continue;
    }
    materialParams.set(materialId, {
      lambda: latest.thermalConductivity,
      correctionFactor: latest.correctionFactor,
      snapshot: {
        id: latest.id, version: latest.version, materialId: latest.materialId,
        thermalConductivity: latest.thermalConductivity, correctionFactor: latest.correctionFactor,
        evidenceSource: latest.evidenceSource, evidenceRef: latest.evidenceRef, evidenceLevel: latest.evidenceLevel
      }
    });
  }

  // 5) 产品层参数（EQUIVALENT：已发布产品参数；LAYERED：产品层材料参数）
  const productLayer = scheme.layers.find((l) => l.layerType === "PRODUCT_LAYER");
  let equivalentParams: { conductivity: number; correctionFactor: number; snapshots: Record<string, unknown>[] } | null = null;
  if (input.mode === "EQUIVALENT") {
    if (!rule) {
      errors.push({ field: "ruleCode", code: "THERMAL_CALC_RULE_NOT_PUBLISHED", message: "整体当量法必须使用已发布计算规则" });
    } else if (!productLayer) {
      errors.push({ field: "schemeId", code: "CALC_SCHEME_INVALID", message: "构造方案没有产品层，无法进行整体当量法计算" });
    } else {
      const conductivityRows = await listPublishedProductParameters(app.db, {
        specId: input.productSpecId,
        parameterCode: rule.parameterCodes.equivalentConductivity,
        usage: rule.usage ?? undefined
      });
      const correctionRows = await listPublishedProductParameters(app.db, {
        specId: input.productSpecId,
        parameterCode: rule.parameterCodes.correctionFactor,
        usage: rule.usage ?? undefined
      });
      const conductivity = pickParameter(conductivityRows, rule.paramSourcePriority);
      const correction = pickParameter(correctionRows, rule.paramSourcePriority);
      if (!conductivity || !correction) {
        errors.push({
          field: "equivalentParams",
          code: "CALC_PARAM_MISSING",
          message: `产品规格 ${input.productSpecId} 缺少已发布且用途允许的当量导热系数（${rule.parameterCodes.equivalentConductivity}）或修正系数（${rule.parameterCodes.correctionFactor}）参数，请先在后台配置并发布`
        });
      } else {
        equivalentParams = {
          conductivity: conductivity.value,
          correctionFactor: correction.value,
          snapshots: [conductivity, correction].map((p) => ({
            id: p.id, version: p.version, parameterCode: p.parameterCode, parameterName: p.parameterName,
            paramSource: p.paramSource, value: p.value, unit: p.unit,
            evidenceSource: p.evidenceSource, evidenceRef: p.evidenceRef, evidenceLevel: p.evidenceLevel
          }))
        };
      }
    }
  }

  // 6) REFERENCE_TABLE 分支已返回；此处为 EQUIVALENT / LAYERED：构造层快照（产品层厚度 = 输入厚度）
  const calcLayers: CalcLayer[] = [];
  const layersSnapshot: Record<string, unknown>[] = [];
  const orderedLayers = [...scheme.layers].sort((a, b) => a.layerOrder - b.layerOrder);
  for (const layer of orderedLayers) {
    const isProduct = layer.layerType === "PRODUCT_LAYER";
    const thicknessM = isProduct ? input.thicknessMm / 1000 : (layer.thickness ?? 0) / 1000;
    const material = layer.materialId ? materialParams.get(layer.materialId) : undefined;
    if (!isProduct && !layer.materialId) {
      errors.push({
        field: `layers[${layer.layerOrder}].materialId`,
        code: "CALC_PARAM_MISSING",
        message: `构造层「${layer.layerName}」未配置材料，无法参与计算`
      });
      continue;
    }
    // 材料存在但未解析成功时，缺失原因已在材料参数循环中报过，避免重复错误
    if (!isProduct && layer.materialId && !material) continue;
    const lambda = isProduct && input.mode === "EQUIVALENT" ? null : (material?.lambda ?? null);
    const correctionFactor = isProduct && input.mode === "EQUIVALENT" ? null : (material?.correctionFactor ?? null);
    calcLayers.push({
      layerOrder: layer.layerOrder,
      layerType: layer.layerType,
      layerName: layer.layerName,
      materialId: layer.materialId,
      thicknessM,
      lambda,
      correctionFactor,
      evidenceRef: layer.evidenceRef
    });
    layersSnapshot.push({
      layerOrder: layer.layerOrder,
      layerType: layer.layerType,
      layerName: layer.layerName,
      materialId: layer.materialId,
      thicknessM,
      lambda: isProduct && input.mode === "EQUIVALENT" ? equivalentParams?.conductivity : lambda,
      correctionFactor: isProduct && input.mode === "EQUIVALENT" ? equivalentParams?.correctionFactor : correctionFactor,
      evidenceSource: layer.evidenceSource,
      evidenceRef: layer.evidenceRef,
      evidenceLevel: layer.evidenceLevel
    });
  }
  if (errors.length > 0) {
    return { valid: false, errors, notes, record: null };
  }

  const resolvedRules: ResolvedRules = {
    ruleId: rule!.id,
    ruleVersion: rule!.version,
    ruleCode: rule!.code,
    formulaVersion: rule!.formulaVersion,
    interiorSurfaceResistance: rule!.interiorSurfaceResistance,
    exteriorSurfaceResistance: rule!.exteriorSurfaceResistance,
    precision: rule!.precision,
    roundingMode: rule!.roundingMode,
    compareField: rule!.compareField,
    compareOperator: rule!.compareOperator,
    includeNonProductLayers: rule!.includeNonProductLayers,
    includeSurfaceResistances: rule!.includeSurfaceResistances
  };

  const outcome = calculateThermal({
    mode: input.mode,
    rules: resolvedRules,
    layers: calcLayers,
    equivalentParams: equivalentParams
      ? { conductivity: equivalentParams.conductivity, correctionFactor: equivalentParams.correctionFactor }
      : undefined,
    standardLimit: limit ? { limitKValue: limit.limitKValue } : null
  });

  if (!outcome.valid) {
    return { valid: false, errors: outcome.errors, notes, record: null };
  }

  // 7) 快照落库 + 审计（同一事务）
  const parametersSnapshot = [
    ...[...materialParams.values()].map((m) => m.snapshot),
    ...(equivalentParams?.snapshots ?? [])
  ];
  const record = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalCalcRecords).values({
      mode: input.mode,
      projectId: input.projectId ?? null,
      ruleId: rule!.id,
      ruleVersion: rule!.version,
      standardLimitId: limit?.id ?? null,
      limitVersion: limit?.version ?? null,
      inputJson: {
        mode: input.mode,
        schemeId: input.schemeId,
        productSpecId: input.productSpecId,
        thicknessMm: input.thicknessMm,
        regionCode: input.regionCode ?? null,
        ruleCode: input.ruleCode ?? null,
        projectId: input.projectId ?? null
      },
      layersJson: layersSnapshot,
      parametersJson: parametersSnapshot,
      ruleJson: rule
        ? {
            id: rule.id, version: rule.version, code: rule.code, name: rule.name,
            formulaVersion: rule.formulaVersion,
            interiorSurfaceResistance: rule.interiorSurfaceResistance,
            exteriorSurfaceResistance: rule.exteriorSurfaceResistance,
            precision: rule.precision, roundingMode: rule.roundingMode,
            compareField: rule.compareField, compareOperator: rule.compareOperator,
            includeNonProductLayers: rule.includeNonProductLayers,
            includeSurfaceResistances: rule.includeSurfaceResistances,
            parameterCodes: rule.parameterCodes, paramSourcePriority: rule.paramSourcePriority, usage: rule.usage,
            evidenceSource: rule.evidenceSource, evidenceRef: rule.evidenceRef, evidenceLevel: rule.evidenceLevel
          }
        : null,
      standardJson: limit
        ? {
            id: limit.id, version: limit.version, regionCode: limit.regionCode, regionName: limit.regionName,
            basisCode: limit.basisCode, basisName: limit.basisName, clauseRef: limit.clauseRef,
            limitKValue: limit.limitKValue,
            evidenceSource: limit.evidenceSource, evidenceRef: limit.evidenceRef, evidenceLevel: limit.evidenceLevel
          }
        : null,
      formulaJson: outcome.formulas,
      stepsJson: outcome.steps,
      resultJson: {
        valid: true,
        mode: input.mode,
        productResistance: outcome.productResistance,
        productResistanceRounded: outcome.productResistanceRounded,
        totalResistance: outcome.totalResistance,
        totalResistanceRounded: outcome.totalResistanceRounded,
        kValue: outcome.kValue,
        kValueRounded: outcome.kValueRounded,
        compliant: outcome.compliant,
        limitKValue: outcome.limitKValue,
        errors: outcome.errors,
        notes
      },
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: THERMAL_CALC_EXECUTED, targetType: "thermal_calc_record", targetId: created!.id,
      afterJson: {
        mode: input.mode, schemeId: input.schemeId, productSpecId: input.productSpecId,
        thicknessMm: input.thicknessMm, regionCode: input.regionCode ?? null,
        ruleVersion: rule!.version, limitVersion: limit?.version ?? null,
        kValue: outcome.kValueRounded, compliant: outcome.compliant
      }
    });
    return created!;
  });

  return { valid: true, errors: [], notes, record: toRecordDto(record) };
}

/** REFERENCE_TABLE：查已发布集精确行，返回候选 + 逐候选判定；无匹配返回空候选 + 提示（不插值） */
async function executeReferenceTable(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: ThermalCalcInput,
  rule: (typeof thermalCalcRules.$inferSelect) | null,
  limit: (typeof thermalStandardLimits.$inferSelect) | null,
  notes: string[]
): Promise<ThermalCalcExecution> {
  const sets = await listPublishedThermalSets(app.db, { schemeId: input.schemeId, productSpecId: input.productSpecId });
  const setIds = sets.map((s) => s.id);
  const rows = setIds.length > 0
    ? await app.db.select().from(thermalReferenceRows).where(
        and(
          inArray(thermalReferenceRows.setId, setIds),
          eq(thermalReferenceRows.schemeId, input.schemeId),
          eq(thermalReferenceRows.productSpecId, input.productSpecId),
          eq(thermalReferenceRows.thicknessMm, input.thicknessMm)
        )
      )
    : [];
  if (rows.length === 0) {
    notes.push("图集参考表中没有该构造/规格/厚度的精确匹配行（禁止插值）；可改用整体当量法或分层法计算（需已发布计算规则）");
  }

  const precision = rule?.precision ?? 4;
  const roundingMode = rule?.roundingMode ?? "HALF_UP";
  const candidates = rows.map((row) => {
    const set = sets.find((s) => s.id === row.setId);
    const kValueRounded = roundBy(row.kValue, precision, roundingMode);
    const totalRounded = roundBy(row.totalThermalResistance, precision, roundingMode);
    const compareValue = rule?.compareField === "K_VALUE" ? kValueRounded : totalRounded;
    const compliant = rule && limit
      ? judgeCompliance(compareValue, limit.limitKValue, rule.compareField, rule.compareOperator)
      : null;
    return {
      setId: row.setId,
      setCode: set?.code ?? null,
      setVersion: set?.version ?? null,
      schemeId: row.schemeId,
      productSpecId: row.productSpecId,
      thicknessMm: row.thicknessMm,
      productThermalResistance: row.productThermalResistance,
      totalThermalResistance: row.totalThermalResistance,
      kValue: row.kValue,
      kValueRounded,
      totalThermalResistanceRounded: totalRounded,
      rawThickness: row.rawThickness,
      rawProductResistance: row.rawProductResistance,
      rawTotalResistance: row.rawTotalResistance,
      rawKValue: row.rawKValue,
      evidenceSource: row.evidenceSource,
      evidenceRef: row.evidenceRef,
      evidenceLevel: row.evidenceLevel,
      compliant
    };
  });

  const record = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalCalcRecords).values({
      mode: "REFERENCE_TABLE",
      projectId: input.projectId ?? null,
      ruleId: rule?.id ?? null,
      ruleVersion: rule?.version ?? null,
      standardLimitId: limit?.id ?? null,
      limitVersion: limit?.version ?? null,
      inputJson: {
        mode: input.mode,
        schemeId: input.schemeId,
        productSpecId: input.productSpecId,
        thicknessMm: input.thicknessMm,
        regionCode: input.regionCode ?? null,
        ruleCode: input.ruleCode ?? null,
        projectId: input.projectId ?? null
      },
      layersJson: [],
      parametersJson: [],
      ruleJson: rule ? { id: rule.id, version: rule.version, code: rule.code, formulaVersion: rule.formulaVersion } : null,
      standardJson: limit
        ? {
            id: limit.id, version: limit.version, regionCode: limit.regionCode, basisCode: limit.basisCode,
            clauseRef: limit.clauseRef, limitKValue: limit.limitKValue,
            evidenceSource: limit.evidenceSource, evidenceRef: limit.evidenceRef
          }
        : null,
      formulaJson: { mode: "REFERENCE_TABLE", note: "直接读取已发布图集参考行，不重复计算" },
      stepsJson: [],
      resultJson: {
        valid: true,
        mode: "REFERENCE_TABLE",
        candidates,
        compliant: candidates.some((c) => c.compliant === true)
          ? true
          : candidates.length > 0 && candidates.every((c) => c.compliant === false)
            ? false
            : null,
        errors: [],
        notes
      },
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: THERMAL_CALC_EXECUTED, targetType: "thermal_calc_record", targetId: created!.id,
      afterJson: {
        mode: "REFERENCE_TABLE", schemeId: input.schemeId, productSpecId: input.productSpecId,
        thicknessMm: input.thicknessMm, regionCode: input.regionCode ?? null,
        candidateCount: candidates.length, compliant: candidates.some((c) => c.compliant === true)
      }
    });
    return created!;
  });

  return { valid: true, errors: [], notes, record: toRecordDto(record) };
}

// ---------------------------------------------------------------- 计算记录查询

export function toRecordDto(record: (typeof thermalCalcRecords.$inferSelect) | null) {
  if (!record) return null;
  return {
    id: record.id,
    requestId: record.requestId,
    mode: record.mode,
    projectId: record.projectId,
    ruleId: record.ruleId,
    ruleVersion: record.ruleVersion,
    standardLimitId: record.standardLimitId,
    limitVersion: record.limitVersion,
    input: record.inputJson,
    layers: record.layersJson,
    parameters: record.parametersJson,
    rule: record.ruleJson,
    standard: record.standardJson,
    formulas: record.formulaJson,
    steps: record.stepsJson,
    result: record.resultJson,
    createdById: record.createdById,
    createdAt: record.createdAt
  };
}

export async function listCalcRecords(
  app: FastifyInstance,
  query: { page: number; pageSize: number; mode?: string; projectId?: string },
  actor?: AuthUser
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  let projectScope;
  if (actor && !isSuperAdmin(actor)) {
    const accessibleProjects = await app.db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(
        isNull(projectsTable.deletedAt),
        or(eq(projectsTable.createdById, actor.id), eq(projectsTable.visibility, "PUBLIC"))
      ));
    projectScope = or(
      eq(thermalCalcRecords.createdById, actor.id),
      accessibleProjects.length > 0
        ? inArray(thermalCalcRecords.projectId, accessibleProjects.map(({ id }) => id))
        : undefined
    );
  }
  const where = and(
    query.mode ? eq(thermalCalcRecords.mode, query.mode as never) : undefined,
    query.projectId ? eq(thermalCalcRecords.projectId, query.projectId) : undefined,
    projectScope
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalCalcRecords).where(where).orderBy(desc(thermalCalcRecords.createdAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalCalcRecords).where(where)
  ]);
  return {
    items: items.map((row) => toRecordDto(row)!),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

/** 计算记录详情：本人记录、SUPER_ADMIN 与有项目查看权者可见 */
export async function getCalcRecord(app: FastifyInstance, actor: AuthUser, id: string) {
  const [row] = await app.db.select().from(thermalCalcRecords).where(eq(thermalCalcRecords.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "计算记录不存在");
  const mine = row.createdById === actor.id;
  if (mine || actor.role === "SUPER_ADMIN") return toRecordDto(row)!;
  if (row.projectId === null) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "计算记录不存在或无权查看");
  const [project] = await app.db.select({
    id: projectsTable.id, createdById: projectsTable.createdById, visibility: projectsTable.visibility
  }).from(projectsTable).where(and(eq(projectsTable.id, row.projectId), isNull(projectsTable.deletedAt))).limit(1);
  if (!project || !canViewProject(actor, project)) {
    throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "计算记录不存在或无权查看");
  }
  return toRecordDto(row)!;
}