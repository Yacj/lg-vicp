import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  constructionLayers,
  constructionSchemes,
  insulationSystems,
  schemeDocuments,
  schemeProductOptions
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ConstructionError } from "../../shared/construction-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  createNextVersion,
  MD_ENTITIES,
  registerVersionedEntity,
  type MdReviewStatus
} from "../masterdata/md-workflow.service.js";

/**
 * 保温系统/构造方案/构造层/产品选项/方案文档 服务。
 * - insulation_systems / construction_schemes：版本化实体（同逻辑键多版本行，发布互斥，new-version 派生新草稿）。
 * - 子表（构造层/产品选项/方案文档）：随父方案版本整组复制，无独立审核列，编辑受父方案状态守卫。
 */

// 模块加载时注册版本化实体元数据（masterdata 状态机按名取元数据，构造模块注册后即可复用 submit/approve/...）
registerVersionedEntity("insulationSystem", {
  table: insulationSystems,
  idColumn: insulationSystems.id,
  statusColumn: insulationSystems.status,
  versionColumn: insulationSystems.version,
  keyColumns: [insulationSystems.code],
  kind: "construction_insulation_system",
  label: "保温系统"
});
registerVersionedEntity("constructionScheme", {
  table: constructionSchemes,
  idColumn: constructionSchemes.id,
  statusColumn: constructionSchemes.status,
  versionColumn: constructionSchemes.version,
  keyColumns: [constructionSchemes.systemId, constructionSchemes.schemeCode],
  kind: "construction_scheme",
  label: "构造方案"
});

const SYSTEM_META = () => MD_ENTITIES.insulationSystem!;
const SCHEME_META = () => MD_ENTITIES.constructionScheme!;

/** 子表可编辑状态：父方案（或系统）处于草稿/审核中/已驳回时允许增删改 */
const CHILD_EDITABLE: MdReviewStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

// ---------------------------------------------------------------- 保温系统（版本化）

export interface InsulationSystemCreateInput {
  code: string;
  name: string;
  systemType: string;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listInsulationSystems(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(insulationSystems.status, query.status) : undefined,
    query.keyword
      ? or(
          ilike(insulationSystems.code, `%${query.keyword}%`),
          ilike(insulationSystems.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(insulationSystems).where(where).orderBy(desc(insulationSystems.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(insulationSystems).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getInsulationSystem(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(insulationSystems).where(eq(insulationSystems.id, id)).limit(1);
  if (!row) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "保温系统不存在");
  return row;
}

export async function createInsulationSystem(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: InsulationSystemCreateInput
) {
  const meta = SYSTEM_META();
  await assertKeyAvailable(app.db, meta, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(insulationSystems).values({
      code: input.code,
      version: 1,
      name: input.name,
      systemType: input.systemType,
      description: input.description,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      changeNote: input.changeNote,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: meta.kind, targetId: created!.id,
      afterJson: { code: created!.code, name: created!.name, version: created!.version }
    });
    return created!;
  });
}

export async function updateInsulationSystem(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<InsulationSystemCreateInput>
) {
  const meta = SYSTEM_META();
  const [existing] = await app.db.select().from(insulationSystems).where(eq(insulationSystems.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "保温系统不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, CHILD_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(insulationSystems).set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      systemType: input.systemType ?? existing.systemType,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(insulationSystems.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteInsulationSystem(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = SYSTEM_META();
  const [existing] = await app.db.select().from(insulationSystems).where(eq(insulationSystems.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "保温系统不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(insulationSystems).where(eq(insulationSystems.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "保温系统草稿已删除" };
}

// ---------------------------------------------------------------- 构造方案（版本化）

export interface ConstructionSchemeCreateInput {
  systemId: string;
  schemeCode: string;
  name: string;
  substrateMaterial: string;
  substrateThickness?: number | null;
  drawingFileId?: string | null;
  atlasPage?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listConstructionSchemes(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string; systemId?: string; schemeCode?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(constructionSchemes.status, query.status) : undefined,
    query.systemId ? eq(constructionSchemes.systemId, query.systemId) : undefined,
    query.schemeCode ? eq(constructionSchemes.schemeCode, query.schemeCode) : undefined,
    query.keyword
      ? or(
          ilike(constructionSchemes.schemeCode, `%${query.keyword}%`),
          ilike(constructionSchemes.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(constructionSchemes).where(where).orderBy(desc(constructionSchemes.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(constructionSchemes).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getConstructionScheme(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(constructionSchemes).where(eq(constructionSchemes.id, id)).limit(1);
  if (!row) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造方案不存在");
  return row;
}

export async function createConstructionScheme(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ConstructionSchemeCreateInput
) {
  const meta = SCHEME_META();
  const [system] = await app.db.select({ id: insulationSystems.id }).from(insulationSystems)
    .where(eq(insulationSystems.id, input.systemId)).limit(1);
  if (!system) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "保温系统不存在");
  await assertKeyAvailable(app.db, meta, { systemId: input.systemId, schemeCode: input.schemeCode });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(constructionSchemes).values({
      systemId: input.systemId,
      schemeCode: input.schemeCode,
      version: 1,
      name: input.name,
      substrateMaterial: input.substrateMaterial,
      substrateThickness: input.substrateThickness,
      drawingFileId: input.drawingFileId,
      atlasPage: input.atlasPage,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      changeNote: input.changeNote,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: meta.kind, targetId: created!.id,
      afterJson: { systemId: created!.systemId, schemeCode: created!.schemeCode, version: created!.version }
    });
    return created!;
  });
}

export async function updateConstructionScheme(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ConstructionSchemeCreateInput>
) {
  const meta = SCHEME_META();
  const [existing] = await app.db.select().from(constructionSchemes).where(eq(constructionSchemes.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造方案不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, CHILD_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(constructionSchemes).set({
      schemeCode: input.schemeCode ?? existing.schemeCode,
      name: input.name ?? existing.name,
      substrateMaterial: input.substrateMaterial ?? existing.substrateMaterial,
      substrateThickness: input.substrateThickness === undefined ? existing.substrateThickness : input.substrateThickness,
      drawingFileId: input.drawingFileId === undefined ? existing.drawingFileId : input.drawingFileId,
      atlasPage: input.atlasPage === undefined ? existing.atlasPage : input.atlasPage,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(constructionSchemes.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteConstructionScheme(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = SCHEME_META();
  const [existing] = await app.db.select().from(constructionSchemes).where(eq(constructionSchemes.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造方案不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(constructionSchemes).where(eq(constructionSchemes.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { systemId: existing.systemId, schemeCode: existing.schemeCode, version: existing.version }
    });
  });
  return { message: "构造方案草稿已删除" };
}

// ---------------------------------------------------------------- new-version 子表复制（同事务快照）

/** 复制层/产品选项/文档到新版本方案：id 由数据库重新生成，schemeId 指向新行 */
async function copySchemeChildren(
  tx: DbExecutor,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Promise<void> {
  const oldId = oldRow.id as string;
  const newId = newRow.id as string;

  const layers = await tx.select().from(constructionLayers).where(eq(constructionLayers.schemeId, oldId));
  if (layers.length > 0) {
    await tx.insert(constructionLayers).values(layers.map((layer) => ({
      schemeId: newId,
      layerOrder: layer.layerOrder,
      layerType: layer.layerType,
      layerName: layer.layerName,
      materialId: layer.materialId,
      thickness: layer.thickness,
      evidenceSource: layer.evidenceSource,
      evidenceRef: layer.evidenceRef,
      evidenceLevel: layer.evidenceLevel,
      effectiveAt: layer.effectiveAt,
      expiresAt: layer.expiresAt,
      createdById: layer.createdById,
      updatedById: layer.updatedById
    })));
  }

  const options = await tx.select().from(schemeProductOptions).where(eq(schemeProductOptions.schemeId, oldId));
  if (options.length > 0) {
    await tx.insert(schemeProductOptions).values(options.map((option) => ({
      schemeId: newId,
      productSpecId: option.productSpecId,
      minThickness: option.minThickness,
      maxThickness: option.maxThickness,
      defaultThickness: option.defaultThickness,
      evidenceSource: option.evidenceSource,
      evidenceRef: option.evidenceRef,
      evidenceLevel: option.evidenceLevel,
      effectiveAt: option.effectiveAt,
      expiresAt: option.expiresAt,
      createdById: option.createdById,
      updatedById: option.updatedById
    })));
  }

  const documents = await tx.select().from(schemeDocuments)
    .where(and(eq(schemeDocuments.targetType, "SCHEME"), eq(schemeDocuments.targetId, oldId)));
  if (documents.length > 0) {
    await tx.insert(schemeDocuments).values(documents.map((doc) => ({
      targetType: "SCHEME" as const,
      targetId: newId,
      knowledgeDocumentId: doc.knowledgeDocumentId,
      atlasPage: doc.atlasPage,
      evidenceSource: doc.evidenceSource,
      evidenceRef: doc.evidenceRef,
      evidenceLevel: doc.evidenceLevel,
      effectiveAt: doc.effectiveAt,
      expiresAt: doc.expiresAt,
      createdById: doc.createdById,
      updatedById: doc.updatedById
    })));
  }
}

/** 派生方案新版本：PUBLISHED/DISABLED 版本 -> DRAFT 新行（version+1），同事务复制子表 */
export function createSchemeNextVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, changeNote?: string
) {
  return createNextVersion(app, request, actor, "constructionScheme", id, changeNote, copySchemeChildren);
}

// ---------------------------------------------------------------- 构造层（子表，随父方案状态守卫）

export interface ConstructionLayerInput {
  layerOrder: number;
  layerType: "BASE_LAYER" | "PRODUCT_LAYER" | "FIXING_LAYER" | "VARIABLE_LAYER";
  layerName: string;
  materialId?: string | null;
  thickness?: number | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

async function requireEditableScheme(app: FastifyInstance, schemeId: string) {
  const [scheme] = await app.db.select().from(constructionSchemes).where(eq(constructionSchemes.id, schemeId)).limit(1);
  if (!scheme) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造方案不存在");
  assertEditable(scheme as Record<string, unknown>, SCHEME_META().label, CHILD_EDITABLE);
  return scheme;
}

export async function listConstructionLayers(
  app: FastifyInstance,
  schemeId: string,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    eq(constructionLayers.schemeId, schemeId),
    query.keyword ? ilike(constructionLayers.layerName, `%${query.keyword}%`) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(constructionLayers).where(where).orderBy(constructionLayers.layerOrder).offset(skip).limit(take),
    app.db.select({ value: count() }).from(constructionLayers).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createConstructionLayer(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  schemeId: string, input: ConstructionLayerInput
) {
  await requireEditableScheme(app, schemeId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(constructionLayers).values({
      schemeId,
      layerOrder: input.layerOrder,
      layerType: input.layerType,
      layerName: input.layerName,
      materialId: input.materialId,
      thickness: input.thickness,
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
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "construction_layer", targetId: created!.id,
      afterJson: { schemeId, layerOrder: created!.layerOrder, layerType: created!.layerType }
    });
    return created!;
  });
}

export async function updateConstructionLayer(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ConstructionLayerInput>
) {
  const [existing] = await app.db.select().from(constructionLayers).where(eq(constructionLayers.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造层不存在");
  await requireEditableScheme(app, existing.schemeId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(constructionLayers).set({
      layerOrder: input.layerOrder ?? existing.layerOrder,
      layerType: input.layerType ?? existing.layerType,
      layerName: input.layerName ?? existing.layerName,
      materialId: input.materialId === undefined ? existing.materialId : input.materialId,
      thickness: input.thickness === undefined ? existing.thickness : input.thickness,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(constructionLayers.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "construction_layer", targetId: id,
      beforeJson: { layerOrder: existing.layerOrder }, afterJson: { layerOrder: updated!.layerOrder }
    });
    return updated!;
  });
}

export async function deleteConstructionLayer(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(constructionLayers).where(eq(constructionLayers.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造层不存在");
  await requireEditableScheme(app, existing.schemeId);
  await app.db.transaction(async (tx) => {
    await tx.delete(constructionLayers).where(eq(constructionLayers.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "construction_layer", targetId: id,
      beforeJson: { layerOrder: existing.layerOrder, layerType: existing.layerType }
    });
  });
  return { message: "构造层已删除" };
}

// ---------------------------------------------------------------- 产品选项（子表，随父方案状态守卫）

export interface SchemeProductOptionInput {
  productSpecId: string;
  minThickness: number;
  maxThickness: number;
  defaultThickness?: number | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listSchemeProductOptions(
  app: FastifyInstance,
  schemeId: string,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = eq(schemeProductOptions.schemeId, schemeId);
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(schemeProductOptions).where(where).orderBy(desc(schemeProductOptions.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(schemeProductOptions).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createSchemeProductOption(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  schemeId: string, input: SchemeProductOptionInput
) {
  await requireEditableScheme(app, schemeId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(schemeProductOptions).values({
      schemeId,
      productSpecId: input.productSpecId,
      minThickness: input.minThickness,
      maxThickness: input.maxThickness,
      defaultThickness: input.defaultThickness,
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
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "construction_product_option", targetId: created!.id,
      afterJson: { schemeId, productSpecId: created!.productSpecId }
    });
    return created!;
  });
}

export async function updateSchemeProductOption(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<SchemeProductOptionInput>
) {
  const [existing] = await app.db.select().from(schemeProductOptions).where(eq(schemeProductOptions.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "产品选项不存在");
  await requireEditableScheme(app, existing.schemeId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(schemeProductOptions).set({
      productSpecId: input.productSpecId ?? existing.productSpecId,
      minThickness: input.minThickness ?? existing.minThickness,
      maxThickness: input.maxThickness ?? existing.maxThickness,
      defaultThickness: input.defaultThickness === undefined ? existing.defaultThickness : input.defaultThickness,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(schemeProductOptions.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "construction_product_option", targetId: id,
      beforeJson: { productSpecId: existing.productSpecId }, afterJson: { productSpecId: updated!.productSpecId }
    });
    return updated!;
  });
}

export async function deleteSchemeProductOption(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(schemeProductOptions).where(eq(schemeProductOptions.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "产品选项不存在");
  await requireEditableScheme(app, existing.schemeId);
  await app.db.transaction(async (tx) => {
    await tx.delete(schemeProductOptions).where(eq(schemeProductOptions.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "construction_product_option", targetId: id,
      beforeJson: { productSpecId: existing.productSpecId }
    });
  });
  return { message: "产品选项已删除" };
}

// ---------------------------------------------------------------- 方案文档（子表，随目标实体状态守卫）

export interface SchemeDocumentInput {
  targetType: "SYSTEM" | "SCHEME";
  targetId: string;
  knowledgeDocumentId?: string | null;
  atlasPage?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

/** 校验文档目标存在且可编辑（保温系统或构造方案处于草稿/审核中/已驳回） */
async function requireEditableDocumentTarget(app: FastifyInstance, targetType: "SYSTEM" | "SCHEME", targetId: string) {
  if (targetType === "SYSTEM") {
    const [row] = await app.db.select().from(insulationSystems).where(eq(insulationSystems.id, targetId)).limit(1);
    if (!row) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "保温系统不存在");
    assertEditable(row as Record<string, unknown>, SYSTEM_META().label, CHILD_EDITABLE);
  } else {
    const [row] = await app.db.select().from(constructionSchemes).where(eq(constructionSchemes.id, targetId)).limit(1);
    if (!row) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "构造方案不存在");
    assertEditable(row as Record<string, unknown>, SCHEME_META().label, CHILD_EDITABLE);
  }
}

export async function listSchemeDocuments(
  app: FastifyInstance,
  query: { page: number; pageSize: number; targetType?: "SYSTEM" | "SCHEME"; targetId?: string; status?: MdReviewStatus }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.targetType ? eq(schemeDocuments.targetType, query.targetType) : undefined,
    query.targetId ? eq(schemeDocuments.targetId, query.targetId) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(schemeDocuments).where(where).orderBy(desc(schemeDocuments.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(schemeDocuments).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createSchemeDocument(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: SchemeDocumentInput
) {
  await requireEditableDocumentTarget(app, input.targetType, input.targetId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(schemeDocuments).values({
      targetType: input.targetType,
      targetId: input.targetId,
      knowledgeDocumentId: input.knowledgeDocumentId,
      atlasPage: input.atlasPage,
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
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "construction_document", targetId: created!.id,
      afterJson: { targetType: created!.targetType, targetId: created!.targetId }
    });
    return created!;
  });
}

export async function updateSchemeDocument(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<SchemeDocumentInput>
) {
  const [existing] = await app.db.select().from(schemeDocuments).where(eq(schemeDocuments.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "方案文档不存在");
  await requireEditableDocumentTarget(app, existing.targetType, existing.targetId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(schemeDocuments).set({
      knowledgeDocumentId: input.knowledgeDocumentId === undefined ? existing.knowledgeDocumentId : input.knowledgeDocumentId,
      atlasPage: input.atlasPage === undefined ? existing.atlasPage : input.atlasPage,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(schemeDocuments.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "construction_document", targetId: id,
      beforeJson: { targetType: existing.targetType }, afterJson: { targetType: updated!.targetType }
    });
    return updated!;
  });
}

export async function deleteSchemeDocument(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(schemeDocuments).where(eq(schemeDocuments.id, id)).limit(1);
  if (!existing) throw new ConstructionError("CONSTRUCTION_ENTITY_NOT_FOUND", "方案文档不存在");
  await requireEditableDocumentTarget(app, existing.targetType, existing.targetId);
  await app.db.transaction(async (tx) => {
    await tx.delete(schemeDocuments).where(eq(schemeDocuments.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "construction_document", targetId: id,
      beforeJson: { targetType: existing.targetType, targetId: existing.targetId }
    });
  });
  return { message: "方案文档已删除" };
}