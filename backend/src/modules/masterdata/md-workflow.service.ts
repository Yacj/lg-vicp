import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, ne, sql } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../db/client.js";
import {
  enterpriseProfiles,
  materialParameterVersions,
  materials,
  productParameters,
  productSeries,
  productSpecs
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { MdError } from "../../shared/md-errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

/**
 * 主数据通用审核状态机（事务+审计）：
 * DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED -> DISABLED；PENDING_REVIEW 可驳回为 REJECTED。
 * PUBLISHED/DISABLED 通过 createNextVersion 派生新草稿（version+1），历史版本保留不漂移。
 * 版本化实体（主数据6 个+ 构造模块通过 registerVersionedEntity 注册的实体）使用
 * MD_ENTITIES 元数据；证书与附件为非版本化实体，通过 transitionMdStatus 直接走状态机（编辑就地改）。
 */

export type MdReviewStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "PUBLISHED" | "DISABLED" | "REJECTED";

export interface VersionedEntityMeta {
  table: AnyPgTable;
  idColumn: PgColumn;
  statusColumn: PgColumn;
  versionColumn: PgColumn;
  /** 逻辑键列：发布时同键其他 PUBLISHED 行自动 DISABLED，保证同键无并存已发布版本*/
  keyColumns: PgColumn[];
  /** 审计 targetType */
  kind: string;
  /** 中文实体名（错误提示）*/
  label: string;
}

export const MD_ENTITIES: Record<string, VersionedEntityMeta> = {
  enterpriseProfile: {
    table: enterpriseProfiles,
    idColumn: enterpriseProfiles.id,
    statusColumn: enterpriseProfiles.status,
    versionColumn: enterpriseProfiles.version,
    keyColumns: [enterpriseProfiles.code],
    kind: "md_enterprise_profile",
    label: "企业内容"
  },
  productSeries: {
    table: productSeries,
    idColumn: productSeries.id,
    statusColumn: productSeries.status,
    versionColumn: productSeries.version,
    keyColumns: [productSeries.code],
    kind: "md_product_series",
    label: "产品系列"
  },
  productSpec: {
    table: productSpecs,
    idColumn: productSpecs.id,
    statusColumn: productSpecs.status,
    versionColumn: productSpecs.version,
    keyColumns: [productSpecs.seriesId, productSpecs.specCode],
    kind: "md_product_spec",
    label: "产品规格"
  },
  productParameter: {
    table: productParameters,
    idColumn: productParameters.id,
    statusColumn: productParameters.status,
    versionColumn: productParameters.version,
    keyColumns: [productParameters.specId, productParameters.parameterCode, productParameters.paramSource],
    kind: "md_product_parameter",
    label: "产品性能参数"
  },
  material: {
    table: materials,
    idColumn: materials.id,
    statusColumn: materials.status,
    versionColumn: materials.version,
    keyColumns: [materials.code],
    kind: "md_material",
    label: "材料"
  },
  materialParameterVersion: {
    table: materialParameterVersions,
    idColumn: materialParameterVersions.id,
    statusColumn: materialParameterVersions.status,
    versionColumn: materialParameterVersions.version,
    keyColumns: [materialParameterVersions.materialId],
    kind: "md_material_parameter_version",
    label: "材料参数版本"
  }
};

export type MdEntityName = string;

/**
 * 外部模块注册版本化实体（如构造模块的保温系统/构造方案）。
 * 注册后即可使用submitForReview/approveEntity/rejectEntity/publishEntity/disableEntity/createNextVersion）
 * 注意：实体表必须包含与约定一致的 id/status/version/审核/时间戳列
 */
export function registerVersionedEntity(name: string, meta: VersionedEntityMeta) {
  (MD_ENTITIES as Record<string, VersionedEntityMeta>)[name] = meta;
}

/** 取实体元数据；未注册实体属程序错误（业务路由只会传合法实体名）*/
export function getEntityMeta(entity: MdEntityName): VersionedEntityMeta {
  const meta = MD_ENTITIES[entity];
  if (!meta) throw new Error(`未注册的审核实体：${entity}`);
  return meta;
}

// 派生新版本时不复制的系统列（保留业务字段与证据列，重新记录审核操作人）
const SYSTEM_COLUMNS = new Set([
  "id", "version", "status",
  "createdAt", "updatedAt",
  "createdById", "updatedById",
  "submittedById", "submittedAt",
  "approvedById", "approvedAt", "approvalNote",
  "rejectedById", "rejectedAt", "rejectReason",
  "publishedById", "publishedAt"
]);

async function requireRow(app: FastifyInstance, meta: VersionedEntityMeta, id: string): Promise<Record<string, unknown>> {
  const [row] = await app.db.select().from(meta.table).where(eq(meta.idColumn, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", `${meta.label}不存在`);
  return row as Record<string, unknown>;
}

function assertStatus(row: Record<string, unknown>, label: string, allowed: MdReviewStatus[]) {
  const current = row.status as MdReviewStatus;
  if (!allowed.includes(current)) {
    throw new MdError("MD_STATUS_CONFLICT", `${label}当前状态（${current}）不允许执行该操作`);
  }
}

function keyConditions(meta: VersionedEntityMeta, row: Record<string, unknown>) {
  return meta.keyColumns.map((column) => eq(column as never, row[column.name]));
}

/** 创建时校验：同逻辑键记录是否已存在（同键重复抛 409，与唯一索引双保险） */
export async function assertKeyAvailable(
  db: DbExecutor,
  meta: VersionedEntityMeta,
  keyValues: Record<string, unknown>
) {
  const conditions = meta.keyColumns.map((column) => eq(column as never, keyValues[column.name]));
  const [existing] = await db.select({ id: meta.idColumn }).from(meta.table).where(and(...conditions)).limit(1);
  if (existing) {
    throw new MdError("MD_DUPLICATE_KEY", `${meta.label}同键记录已存在，请先处理已有草稿或使用新版本`);
  }
}

/** 编辑守卫：行不存在抛 404，状态不允许抛 409 */
export function assertEditable(
  row: Record<string, unknown>,
  label: string,
  allowed: MdReviewStatus[]
) {
  assertStatus(row, label, allowed);
}

/** 状态转换：查行 -> 状态守卫 -> 事务内更新 + 审计；before 回调用于发布互斥等副作用 */
async function transition(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  meta: VersionedEntityMeta,
  id: string,
  from: MdReviewStatus[],
  to: MdReviewStatus,
  action: string,
  options: {
    extraSet?: Record<string, unknown>;
    before?: (tx: DbExecutor, row: Record<string, unknown>) => Promise<void>;
  } = {}
) {
  const row = await requireRow(app, meta, id);
  assertStatus(row, meta.label, from);
  return app.db.transaction(async (tx) => {
    if (options.before) await options.before(tx, row);
    const [updated] = await tx.update(meta.table)
      .set({ ...(options.extraSet ?? {}), status: to, updatedAt: new Date() } as never)
      .where(eq(meta.idColumn, id))
      .returning();
    await writeAuditLog({
      db: tx, request, actor,
      action, targetType: meta.kind, targetId: id,
      beforeJson: { status: row.status },
      afterJson: { status: to }
    });
    return updated!;
  });
}

async function nextVersionNumber(db: DbExecutor, meta: VersionedEntityMeta, row: Record<string, unknown>): Promise<number> {
  const conditions = and(...keyConditions(meta, row));
  const [result] = await db.select({ max: sql<number>`coalesce(max(${meta.versionColumn}), 0)` })
    .from(meta.table).where(conditions);
  return (result?.max ?? 0) + 1;
}

// ---------------------------------------------------------------- 版本化实体工作流

/** 提交审核：DRAFT / REJECTED -> PENDING_REVIEW */
export async function submitForReview(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string
) {
  const meta = getEntityMeta(entity);
  return transition(app, request, actor, meta, id, ["DRAFT", "REJECTED"], "PENDING_REVIEW",
    AUDIT_ACTIONS.MD_ENTITY_SUBMITTED,
    { extraSet: { submittedById: actor.id, submittedAt: new Date() } });
}

/** 审核通过：PENDING_REVIEW -> APPROVED，记录审核意见*/
export async function approveEntity(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string, approvalNote?: string
) {
  const meta = getEntityMeta(entity);
  return transition(app, request, actor, meta, id, ["PENDING_REVIEW"], "APPROVED",
    AUDIT_ACTIONS.MD_ENTITY_APPROVED,
    { extraSet: { approvedById: actor.id, approvedAt: new Date(), approvalNote: approvalNote ?? null } });
}

/** 驳回：PENDING_REVIEW -> REJECTED，必须填写驳回原因（审核决议）*/
export async function rejectEntity(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string, rejectReason: string
) {
  const meta = getEntityMeta(entity);
  return transition(app, request, actor, meta, id, ["PENDING_REVIEW"], "REJECTED",
    AUDIT_ACTIONS.MD_ENTITY_REJECTED,
    { extraSet: { rejectedById: actor.id, rejectedAt: new Date(), rejectReason } });
}

/** 发布：APPROVED -> PUBLISHED；同逻辑键其他 PUBLISHED 版本自动 DISABLED */
export async function publishEntity(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string
) {
  const meta = getEntityMeta(entity);
  return transition(app, request, actor, meta, id, ["APPROVED"], "PUBLISHED",
    AUDIT_ACTIONS.MD_ENTITY_PUBLISHED,
    {
      extraSet: { publishedById: actor.id, publishedAt: new Date() },
      before: async (tx, row) => {
        const conditions = [
          ...keyConditions(meta, row),
          ne(meta.idColumn, id),
          eq(meta.statusColumn, "PUBLISHED")
        ];
        await tx.update(meta.table).set({ status: "DISABLED", updatedAt: new Date() } as never)
          .where(and(...conditions));
      }
    });
}

/** 停用：PUBLISHED -> DISABLED */
export async function disableEntity(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string
) {
  const meta = getEntityMeta(entity);
  return transition(app, request, actor, meta, id, ["PUBLISHED"], "DISABLED",
    AUDIT_ACTIONS.MD_ENTITY_DISABLED);
}

/** 派生新版本：PUBLISHED / DISABLED -> 新行 DRAFT（version+1），业务字段复制，历史版本保留*/
export async function createNextVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  entity: MdEntityName, id: string, changeNote?: string,
  copyChildren?: (tx: DbExecutor, oldRow: Record<string, unknown>, newRow: Record<string, unknown>) => Promise<void>
) {
  const meta = getEntityMeta(entity);
  const row = await requireRow(app, meta, id);
  assertStatus(row, meta.label, ["PUBLISHED", "DISABLED"]);
  const next = await nextVersionNumber(app.db, meta, row);
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!SYSTEM_COLUMNS.has(key)) clone[key] = value;
  }
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(meta.table).values({
      ...clone,
      version: next,
      status: "DRAFT",
      changeNote: changeNote ?? (row.changeNote as string | null),
      createdById: actor.id,
      updatedById: actor.id
    } as never).returning();
    // 子表随父版本复制（如构造方案的层/产品选项/文档），与父版本同一事务，保证历史快照不漂移
    if (copyChildren) await copyChildren(tx, row, created!);
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_VERSION_CREATED, targetType: meta.kind, targetId: created!.id as string,
      beforeJson: { sourceId: id, sourceVersion: row.version },
      afterJson: { version: next, changeNote: changeNote ?? null }
    });
    return created!;
  });
}

// ---------------------------------------------------------------- 非版本化实体状态机（证书/附件）

export interface SimpleStatusEntity {
  table: AnyPgTable;
  idColumn: PgColumn;
  statusColumn: PgColumn;
  kind: string;
  label: string;
}

/** 非版本化实体状态转换：submit / approve / reject / publish / disable 共用 */
export async function transitionMdStatus(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  meta: SimpleStatusEntity,
  id: string,
  from: MdReviewStatus[],
  to: MdReviewStatus,
  action: string,
  extraSet: Record<string, unknown> = {}
) {
  const row = await requireRow(app, { ...meta, versionColumn: meta.idColumn, keyColumns: [] }, id);
  assertStatus(row, meta.label, from);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(meta.table)
      .set({ ...extraSet, status: to, updatedAt: new Date() } as never)
      .where(eq(meta.idColumn, id))
      .returning();
    await writeAuditLog({
      db: tx, request, actor,
      action, targetType: meta.kind, targetId: id,
      beforeJson: { status: row.status },
      afterJson: { status: to }
    });
    return updated!;
  });
}

/** 非版本化实体审核辅助：submittedById/approvedById 等决策字段*/
export const MD_REVIEW_SETS = {
  submit: (actor: AuthUser) => ({ submittedById: actor.id, submittedAt: new Date() }),
  approve: (actor: AuthUser, approvalNote?: string) => ({
    approvedById: actor.id, approvedAt: new Date(), approvalNote: approvalNote ?? null
  }),
  reject: (actor: AuthUser, rejectReason: string) => ({
    rejectedById: actor.id, rejectedAt: new Date(), rejectReason
  }),
  publish: (actor: AuthUser) => ({ publishedById: actor.id, publishedAt: new Date() })
} as const;