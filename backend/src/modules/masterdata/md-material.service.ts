import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { materialParameterVersions, materials } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { MdError } from "../../shared/md-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  MD_ENTITIES,
  type MdReviewStatus
} from "./md-workflow.service.js";

/**
 * 材料主数据服务：材料（版本化主行，类别值域待甲方确认）与材料参数版本
 * （版本化，导热系数/修正系数/密度/强度/燃烧等级/来源/适用标准，确定性计算唯一参数来源）。
 */

const EDITABLE = ["DRAFT", "PENDING_REVIEW", "REJECTED"] as MdReviewStatus[];

// ---------------------------------------------------------------- 材料（版本化）

export interface MaterialInput {
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listMaterials(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; category?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(materials.status, query.status) : undefined,
    query.category ? eq(materials.category, query.category) : undefined,
    query.keyword ? or(ilike(materials.code, `%${query.keyword}%`), ilike(materials.name, `%${query.keyword}%`)) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(materials).where(where).orderBy(desc(materials.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(materials).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getMaterial(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(materials).where(eq(materials.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "材料不存在");
  return row;
}

export async function createMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: MaterialInput
) {
  const meta = MD_ENTITIES.material!;
  await assertKeyAvailable(app.db, meta, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(materials).values({
      code: input.code,
      version: 1,
      name: input.name,
      category: input.category,
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

export async function updateMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<MaterialInput>
) {
  const meta = MD_ENTITIES.material!;
  const [existing] = await app.db.select().from(materials).where(eq(materials.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "材料不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(materials).set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      category: input.category === undefined ? existing.category : input.category,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(materials.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteMaterial(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.material!;
  const [existing] = await app.db.select().from(materials).where(eq(materials.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "材料不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(materials).where(eq(materials.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "材料草稿已删除" };
}

// ---------------------------------------------------------------- 材料参数版本（版本化）

export interface MaterialParameterInput {
  materialId: string;
  thermalConductivity: number;
  correctionFactor?: number | null;
  density?: number | null;
  compressiveStrength?: number | null;
  bondStrength?: number | null;
  combustionGrade?: string | null;
  applicableStandard?: string | null;
  source?: string | null;
  allowedUsage?: string[];
  applicableScope?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listMaterialParameters(
  app: FastifyInstance,
  query: { page: number; pageSize: number; materialId?: string; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.materialId ? eq(materialParameterVersions.materialId, query.materialId) : undefined,
    query.status ? eq(materialParameterVersions.status, query.status) : undefined,
    query.keyword ? or(
      ilike(materialParameterVersions.applicableStandard, `%${query.keyword}%`),
      ilike(materialParameterVersions.source, `%${query.keyword}%`)
    ) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(materialParameterVersions).where(where)
      .orderBy(desc(materialParameterVersions.version)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(materialParameterVersions).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getMaterialParameter(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(materialParameterVersions).where(eq(materialParameterVersions.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "材料参数版本不存在");
  return row;
}

export async function createMaterialParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: MaterialParameterInput
) {
  const meta = MD_ENTITIES.materialParameterVersion!;
  const [material] = await app.db.select({ id: materials.id }).from(materials)
    .where(eq(materials.id, input.materialId)).limit(1);
  if (!material) throw new MdError("MD_ENTITY_NOT_FOUND", "材料不存在");
  await assertKeyAvailable(app.db, meta, { materialId: input.materialId });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(materialParameterVersions).values({
      materialId: input.materialId,
      version: 1,
      thermalConductivity: input.thermalConductivity,
      correctionFactor: input.correctionFactor,
      density: input.density,
      compressiveStrength: input.compressiveStrength,
      bondStrength: input.bondStrength,
      combustionGrade: input.combustionGrade,
      applicableStandard: input.applicableStandard,
      source: input.source,
      allowedUsage: input.allowedUsage ?? [],
      applicableScope: input.applicableScope,
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
      afterJson: { materialId: created!.materialId, version: created!.version }
    });
    return created!;
  });
}

export async function updateMaterialParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<MaterialParameterInput>
) {
  const meta = MD_ENTITIES.materialParameterVersion!;
  const [existing] = await app.db.select().from(materialParameterVersions).where(eq(materialParameterVersions.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "材料参数版本不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(materialParameterVersions).set({
      thermalConductivity: input.thermalConductivity ?? existing.thermalConductivity,
      correctionFactor: input.correctionFactor === undefined ? existing.correctionFactor : input.correctionFactor,
      density: input.density === undefined ? existing.density : input.density,
      compressiveStrength: input.compressiveStrength === undefined ? existing.compressiveStrength : input.compressiveStrength,
      bondStrength: input.bondStrength === undefined ? existing.bondStrength : input.bondStrength,
      combustionGrade: input.combustionGrade === undefined ? existing.combustionGrade : input.combustionGrade,
      applicableStandard: input.applicableStandard === undefined ? existing.applicableStandard : input.applicableStandard,
      source: input.source === undefined ? existing.source : input.source,
      allowedUsage: input.allowedUsage ?? existing.allowedUsage,
      applicableScope: input.applicableScope === undefined ? existing.applicableScope : input.applicableScope,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(materialParameterVersions.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteMaterialParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.materialParameterVersion!;
  const [existing] = await app.db.select().from(materialParameterVersions).where(eq(materialParameterVersions.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "材料参数版本不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(materialParameterVersions).where(eq(materialParameterVersions.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { materialId: existing.materialId, version: existing.version }
    });
  });
  return { message: "材料参数草稿已删除" };
}