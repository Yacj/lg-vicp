import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import {
  enterpriseProfiles,
  files,
  productAttachments,
  productParameters,
  productSeries,
  productSpecs
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { MdError } from "../../shared/md-errors.js";
import { getPagination } from "../../shared/pagination.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertEditable,
  assertKeyAvailable,
  MD_ENTITIES,
  MD_REVIEW_SETS,
  transitionMdStatus,
  type MdReviewStatus
} from "./md-workflow.service.js";

/**
 * 产品主数据服务：产品系列（版本化）、产品规格（版本化，可ⅠⅡⅢ型、尺寸、燃烧等级
 * 在产状态、标准/非标、供应区域）、产品性能参数（版本化，技术规范/图集/检测/企业标称四来源
 * 并存展示冲突）、产品附件（文档引用型，target 多态）。
 */

export type MdSpecClass = "I" | "II" | "III";
export type MdParamSource = "TECHNICAL_REGULATION" | "ATLAS" | "DETECTION" | "ENTERPRISE_NOMINAL";

const SPEC_EDITABLE = ["DRAFT", "PENDING_REVIEW", "REJECTED"] as MdReviewStatus[];
const SIMPLE_EDITABLE = ["DRAFT", "PENDING_REVIEW", "REJECTED", "DISABLED"] as MdReviewStatus[];

// ---------------------------------------------------------------- 产品系列（版本化）

export interface ProductSeriesInput {
  code: string;
  name: string;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listProductSeries(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(productSeries.status, query.status) : undefined,
    query.keyword
      ? or(ilike(productSeries.code, `%${query.keyword}%`), ilike(productSeries.name, `%${query.keyword}%`))
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(productSeries).where(where).orderBy(desc(productSeries.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(productSeries).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getProductSeries(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(productSeries).where(eq(productSeries.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "产品系列不存在");
  return row;
}

export async function createProductSeries(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ProductSeriesInput
) {
  const meta = MD_ENTITIES.productSeries!;
  await assertKeyAvailable(app.db, meta, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(productSeries).values({
      code: input.code,
      version: 1,
      name: input.name,
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

export async function updateProductSeries(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ProductSeriesInput>
) {
  const meta = MD_ENTITIES.productSeries!;
  const [existing] = await app.db.select().from(productSeries).where(eq(productSeries.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品系列不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, SPEC_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(productSeries).set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(productSeries.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteProductSeries(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.productSeries!;
  const [existing] = await app.db.select().from(productSeries).where(eq(productSeries.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品系列不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(productSeries).where(eq(productSeries.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "产品系列草稿已删除" };
}

// ---------------------------------------------------------------- 产品规格（版本化）

export interface ProductSpecInput {
  seriesId: string;
  specCode: string;
  specClass: MdSpecClass;
  thicknessMm: number;
  lengthMm?: number | null;
  widthMm?: number | null;
  combustionGrade?: string | null;
  productionStatus?: "PRODUCING" | "STOPPED";
  standardType?: "STANDARD" | "CUSTOM";
  supplyRegions?: string[];
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listProductSpecs(
  app: FastifyInstance,
  query: {
    page: number; pageSize: number;
    seriesId?: string; specClass?: MdSpecClass; standardType?: "STANDARD" | "CUSTOM";
    productionStatus?: "PRODUCING" | "STOPPED"; status?: MdReviewStatus; keyword?: string;
  }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.seriesId ? eq(productSpecs.seriesId, query.seriesId) : undefined,
    query.specClass ? eq(productSpecs.specClass, query.specClass) : undefined,
    query.standardType ? eq(productSpecs.standardType, query.standardType) : undefined,
    query.productionStatus ? eq(productSpecs.productionStatus, query.productionStatus) : undefined,
    query.status ? eq(productSpecs.status, query.status) : undefined,
    query.keyword ? or(ilike(productSpecs.specCode, `%${query.keyword}%`)) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(productSpecs).where(where).orderBy(desc(productSpecs.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(productSpecs).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getProductSpec(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(productSpecs).where(eq(productSpecs.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "产品规格不存在");
  return row;
}

export async function createProductSpec(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ProductSpecInput
) {
  const meta = MD_ENTITIES.productSpec!;
  const [series] = await app.db.select({ id: productSeries.id }).from(productSeries)
    .where(eq(productSeries.id, input.seriesId)).limit(1);
  if (!series) throw new MdError("MD_ENTITY_NOT_FOUND", "产品系列不存在");
  await assertKeyAvailable(app.db, meta, { seriesId: input.seriesId, specCode: input.specCode });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(productSpecs).values({
      seriesId: input.seriesId,
      specCode: input.specCode,
      version: 1,
      specClass: input.specClass,
      thicknessMm: input.thicknessMm,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      combustionGrade: input.combustionGrade,
      productionStatus: input.productionStatus ?? "PRODUCING",
      standardType: input.standardType ?? "STANDARD",
      supplyRegions: input.supplyRegions ?? [],
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
      afterJson: { seriesId: created!.seriesId, specCode: created!.specCode, version: created!.version }
    });
    return created!;
  });
}

export async function updateProductSpec(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ProductSpecInput>
) {
  const meta = MD_ENTITIES.productSpec!;
  const [existing] = await app.db.select().from(productSpecs).where(eq(productSpecs.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品规格不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, SPEC_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(productSpecs).set({
      seriesId: input.seriesId ?? existing.seriesId,
      specCode: input.specCode ?? existing.specCode,
      specClass: input.specClass ?? existing.specClass,
      thicknessMm: input.thicknessMm ?? existing.thicknessMm,
      lengthMm: input.lengthMm === undefined ? existing.lengthMm : input.lengthMm,
      widthMm: input.widthMm === undefined ? existing.widthMm : input.widthMm,
      combustionGrade: input.combustionGrade === undefined ? existing.combustionGrade : input.combustionGrade,
      productionStatus: input.productionStatus ?? existing.productionStatus,
      standardType: input.standardType ?? existing.standardType,
      supplyRegions: input.supplyRegions ?? existing.supplyRegions,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(productSpecs.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteProductSpec(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.productSpec!;
  const [existing] = await app.db.select().from(productSpecs).where(eq(productSpecs.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品规格不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(productSpecs).where(eq(productSpecs.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { seriesId: existing.seriesId, specCode: existing.specCode, version: existing.version }
    });
  });
  return { message: "产品规格草稿已删除" };
}

// ---------------------------------------------------------------- 产品性能参数（版本化，四来源并存）

export interface ProductParameterInput {
  specId: string;
  parameterCode: string;
  parameterName: string;
  paramSource: MdParamSource;
  value: number;
  unit?: string | null;
  allowedUsage?: string[];
  applicableScope?: string | null;
  testReportFileId?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listProductParameters(
  app: FastifyInstance,
  query: {
    page: number; pageSize: number;
    specId?: string; parameterCode?: string; paramSource?: MdParamSource;
    status?: MdReviewStatus; keyword?: string;
  }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.specId ? eq(productParameters.specId, query.specId) : undefined,
    query.parameterCode ? eq(productParameters.parameterCode, query.parameterCode) : undefined,
    query.paramSource ? eq(productParameters.paramSource, query.paramSource) : undefined,
    query.status ? eq(productParameters.status, query.status) : undefined,
    query.keyword ? or(ilike(productParameters.parameterName, `%${query.keyword}%`)) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(productParameters).where(where).orderBy(
      productParameters.parameterCode, productParameters.paramSource, desc(productParameters.version)
    ).offset(skip).limit(take),
    app.db.select({ value: count() }).from(productParameters).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

/** 参数冲突视图：按 (specId, parameterCode) 分组，组内技术规范/图集/检测/企业标称四来源并存展示*/
export async function listProductParameterGroups(
  app: FastifyInstance,
  query: { specId?: string; status?: MdReviewStatus }
) {
  const where = and(
    query.specId ? eq(productParameters.specId, query.specId) : undefined,
    query.status ? eq(productParameters.status, query.status) : undefined
  );
  const rows = await app.db.select().from(productParameters).where(where).orderBy(
    productParameters.parameterCode, productParameters.paramSource, desc(productParameters.version)
  );
  const groups = new Map<string, { specId: string; parameterCode: string; parameterName: string; sources: typeof rows }>();
  for (const row of rows) {
    const key = `${row.specId}:${row.parameterCode}`;
    const group = groups.get(key) ?? { specId: row.specId, parameterCode: row.parameterCode, parameterName: row.parameterName, sources: [] };
    group.sources.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

export async function getProductParameter(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(productParameters).where(eq(productParameters.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "产品性能参数不存在");
  return row;
}

export async function createProductParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ProductParameterInput
) {
  const meta = MD_ENTITIES.productParameter!;
  const [spec] = await app.db.select({ id: productSpecs.id }).from(productSpecs)
    .where(eq(productSpecs.id, input.specId)).limit(1);
  if (!spec) throw new MdError("MD_ENTITY_NOT_FOUND", "产品规格不存在");
  await assertKeyAvailable(app.db, meta, {
    specId: input.specId, parameterCode: input.parameterCode, paramSource: input.paramSource
  });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(productParameters).values({
      specId: input.specId,
      parameterCode: input.parameterCode,
      parameterName: input.parameterName,
      paramSource: input.paramSource,
      version: 1,
      value: input.value,
      unit: input.unit,
      allowedUsage: input.allowedUsage ?? [],
      applicableScope: input.applicableScope,
      testReportFileId: input.testReportFileId,
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
      afterJson: { specId: created!.specId, parameterCode: created!.parameterCode, paramSource: created!.paramSource }
    });
    return created!;
  });
}

export async function updateProductParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ProductParameterInput>
) {
  const meta = MD_ENTITIES.productParameter!;
  const [existing] = await app.db.select().from(productParameters).where(eq(productParameters.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品性能参数不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, SPEC_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(productParameters).set({
      parameterCode: input.parameterCode ?? existing.parameterCode,
      parameterName: input.parameterName ?? existing.parameterName,
      value: input.value ?? existing.value,
      unit: input.unit === undefined ? existing.unit : input.unit,
      allowedUsage: input.allowedUsage ?? existing.allowedUsage,
      applicableScope: input.applicableScope === undefined ? existing.applicableScope : input.applicableScope,
      testReportFileId: input.testReportFileId === undefined ? existing.testReportFileId : input.testReportFileId,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(productParameters.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteProductParameter(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.productParameter!;
  const [existing] = await app.db.select().from(productParameters).where(eq(productParameters.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品性能参数不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(productParameters).where(eq(productParameters.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { parameterCode: existing.parameterCode, paramSource: existing.paramSource, version: existing.version }
    });
  });
  return { message: "产品性能参数草稿已删除" };
}

// ---------------------------------------------------------------- 产品附件（非版本化，target 多态）

export type MdAttachmentTargetType = "PRODUCT_SERIES" | "PRODUCT_SPEC" | "ENTERPRISE";

export interface AttachmentInput {
  targetType: MdAttachmentTargetType;
  targetId: string;
  fileId: string;
  attachmentType?: string;
  name?: string | null;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

async function assertTargetExists(app: FastifyInstance, targetType: MdAttachmentTargetType, targetId: string) {
  const table =
    targetType === "PRODUCT_SERIES" ? productSeries
    : targetType === "PRODUCT_SPEC" ? productSpecs
    : null;
  if (table) {
    const [row] = await app.db.select({ id: table.id }).from(table).where(eq(table.id, targetId)).limit(1);
    if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", targetType === "PRODUCT_SERIES" ? "产品系列不存在" : "产品规格不存在");
    return;
  }
  const [profile] = await app.db.select({ id: enterpriseProfiles.id }).from(enterpriseProfiles).where(eq(enterpriseProfiles.id, targetId)).limit(1);
  if (!profile) throw new MdError("MD_ENTITY_NOT_FOUND", "企业内容不存在");
}

async function assertFileExists(app: FastifyInstance, fileId: string) {
  const [file] = await app.db.select({ id: files.id }).from(files)
    .where(and(eq(files.id, fileId))).limit(1);
  if (!file) throw new MdError("MD_ENTITY_NOT_FOUND", "附件文件不存在");
}

export async function listAttachments(
  app: FastifyInstance,
  query: { page: number; pageSize: number; targetType?: MdAttachmentTargetType; targetId?: string; status?: MdReviewStatus }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.targetType ? eq(productAttachments.targetType, query.targetType) : undefined,
    query.targetId ? eq(productAttachments.targetId, query.targetId) : undefined,
    query.status ? eq(productAttachments.status, query.status) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(productAttachments).where(where).orderBy(desc(productAttachments.createdAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(productAttachments).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createAttachment(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: AttachmentInput
) {
  await assertTargetExists(app, input.targetType, input.targetId);
  await assertFileExists(app, input.fileId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(productAttachments).values({
      ...input,
      attachmentType: input.attachmentType ?? "OTHER",
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "md_product_attachment", targetId: created!.id,
      afterJson: { targetType: created!.targetType, targetId: created!.targetId, fileId: created!.fileId }
    });
    return created!;
  });
}

export async function updateAttachment(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<Omit<AttachmentInput, "targetType" | "targetId" | "fileId">>
) {
  const [existing] = await app.db.select().from(productAttachments).where(eq(productAttachments.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品附件不存在");
  assertEditable(existing as Record<string, unknown>, "产品附件", SIMPLE_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(productAttachments).set({
      attachmentType: input.attachmentType ?? existing.attachmentType,
      name: input.name === undefined ? existing.name : input.name,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(productAttachments.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "md_product_attachment", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteAttachment(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(productAttachments).where(eq(productAttachments.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "产品附件不存在");
  assertEditable(existing as Record<string, unknown>, "产品附件", ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(productAttachments).where(eq(productAttachments.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "md_product_attachment", targetId: id,
      beforeJson: { fileId: existing.fileId }
    });
  });
  return { message: "产品附件草稿已删除" };
}

/** 附件审核工作流：非版本化实体 */
export const attachmentWorkflow = {
  submit: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: productAttachments, idColumn: productAttachments.id, statusColumn: productAttachments.status, kind: "md_product_attachment", label: "产品附件" }, id, ["DRAFT", "REJECTED"], "PENDING_REVIEW", AUDIT_ACTIONS.MD_ENTITY_SUBMITTED, MD_REVIEW_SETS.submit(actor)),
  approve: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string) =>
    transitionMdStatus(app, request, actor, { table: productAttachments, idColumn: productAttachments.id, statusColumn: productAttachments.status, kind: "md_product_attachment", label: "产品附件" }, id, ["PENDING_REVIEW"], "APPROVED", AUDIT_ACTIONS.MD_ENTITY_APPROVED, MD_REVIEW_SETS.approve(actor, approvalNote)),
  reject: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string) =>
    transitionMdStatus(app, request, actor, { table: productAttachments, idColumn: productAttachments.id, statusColumn: productAttachments.status, kind: "md_product_attachment", label: "产品附件" }, id, ["PENDING_REVIEW"], "REJECTED", AUDIT_ACTIONS.MD_ENTITY_REJECTED, MD_REVIEW_SETS.reject(actor, rejectReason)),
  publish: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: productAttachments, idColumn: productAttachments.id, statusColumn: productAttachments.status, kind: "md_product_attachment", label: "产品附件" }, id, ["APPROVED"], "PUBLISHED", AUDIT_ACTIONS.MD_ENTITY_PUBLISHED, MD_REVIEW_SETS.publish(actor)),
  disable: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: productAttachments, idColumn: productAttachments.id, statusColumn: productAttachments.status, kind: "md_product_attachment", label: "产品附件" }, id, ["PUBLISHED"], "DISABLED", AUDIT_ACTIONS.MD_ENTITY_DISABLED)
};