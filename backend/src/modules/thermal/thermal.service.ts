import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, or, ilike } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import type { DbExecutor } from "../../db/client.js";
import { env } from "../../config/env.js";
import {
  constructionSchemes,
  files,
  productSpecs,
  schemeProductOptions,
  thermalImportErrors,
  thermalImportJobs,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ForbiddenError, ServiceUnavailableError } from "../../shared/errors.js";
import { ThermalError } from "../../shared/thermal-errors.js";
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
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { IMPORT_TEMPLATE_VERSION, type ImportRowError, type MatchedThermalRow } from "./thermal-import.service.js";

/**
 * 图集热工参考选用表服务。
 * - thermal_reference_sets：版本化实体（同 code 多版本行，发布互斥，new-version 派生新草稿并复制参考行）。
 * - thermal_reference_rows：随集版本化，无独立审核列，编辑受集状态守卫；保存原始值（raw*）与标准化数值。
 * - thermal_import_jobs / thermal_import_errors：Excel 导入作业（创建/确认/投递/预览/差异对比/事务应用）。
 */

/** 导入作业应用审计动作（audit_logs.action 为 varchar，直接使用稳定字符串） */
const THERMAL_IMPORT_APPLIED = "thermal.import_applied";
const THERMAL_IMPORT_CREATED = "thermal.import_created";
const THERMAL_IMPORT_COMPLETED = "thermal.import_upload_completed";

// 模块加载时注册版本化实体元数据（复用 masterdata 状态机）
registerVersionedEntity("thermalReferenceSet", {
  table: thermalReferenceSets,
  idColumn: thermalReferenceSets.id,
  statusColumn: thermalReferenceSets.status,
  versionColumn: thermalReferenceSets.version,
  keyColumns: [thermalReferenceSets.code],
  kind: "thermal_reference_set",
  label: "图集热工参考集"
});

const SET_META = () => MD_ENTITIES.thermalReferenceSet!;

/** 子表可编辑状态：集处于草稿/审核中/已驳回时允许增删改行 */
const CHILD_EDITABLE: MdReviewStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

/** 应用导入时目标集可复用状态：DRAFT / REJECTED（REJECTED 驳回后可修正重提） */
const APPLYABLE_SET_STATUS: MdReviewStatus[] = ["DRAFT", "REJECTED"];

// ---------------------------------------------------------------- 参考集（版本化）

export interface ThermalSetCreateInput {
  code: string;
  name: string;
  description?: string | null;
  atlasDocumentId?: string | null;
  changeNote?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listThermalSets(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(thermalReferenceSets.status, query.status) : undefined,
    query.keyword
      ? or(
          ilike(thermalReferenceSets.code, `%${query.keyword}%`),
          ilike(thermalReferenceSets.name, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalReferenceSets).where(where).orderBy(desc(thermalReferenceSets.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalReferenceSets).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getThermalSet(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(thermalReferenceSets).where(eq(thermalReferenceSets.id, id)).limit(1);
  if (!row) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考集不存在");
  return row;
}

export async function createThermalSet(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ThermalSetCreateInput
) {
  const meta = SET_META();
  await assertKeyAvailable(app.db, meta, { code: input.code });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalReferenceSets).values({
      code: input.code,
      version: 1,
      name: input.name,
      description: input.description,
      atlasDocumentId: input.atlasDocumentId,
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

export async function updateThermalSet(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ThermalSetCreateInput>
) {
  const meta = SET_META();
  const [existing] = await app.db.select().from(thermalReferenceSets).where(eq(thermalReferenceSets.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考集不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, CHILD_EDITABLE);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(thermalReferenceSets).set({
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      atlasDocumentId: input.atlasDocumentId === undefined ? existing.atlasDocumentId : input.atlasDocumentId,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(thermalReferenceSets.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteThermalSet(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = SET_META();
  const [existing] = await app.db.select().from(thermalReferenceSets).where(eq(thermalReferenceSets.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考集不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(thermalReferenceSets).where(eq(thermalReferenceSets.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "图集热工参考集草稿已删除" };
}

// ---------------------------------------------------------------- 参考行（子表，随集状态守卫）

export interface ThermalRowInput {
  schemeId: string;
  productSpecId: string;
  thicknessMm: number;
  productThermalResistance: number;
  totalThermalResistance: number;
  kValue: number;
  rawThickness: string;
  rawProductResistance: string;
  rawTotalResistance: string;
  rawKValue: string;
  evidenceSource: string;
  evidenceRef: string;
  evidenceLevel?: "A" | "B" | "C";
}

/** 引用的构造方案/产品规格必须已发布且生效（禁止引用草稿/已停用/失效数据） */
async function assertRowReferencesPublished(app: FastifyInstance, schemeId: string, productSpecId: string) {
  const [scheme] = await app.db.select({ id: constructionSchemes.id })
    .from(constructionSchemes)
    .where(and(eq(constructionSchemes.id, schemeId), ...publishedReferenceConditions(constructionSchemes)))
    .limit(1);
  if (!scheme) throw new ThermalError("THERMAL_REFERENCE_NOT_PUBLISHED", "构造方案未发布或已失效，不能引用");
  const [spec] = await app.db.select({ id: productSpecs.id })
    .from(productSpecs)
    .where(and(eq(productSpecs.id, productSpecId), ...publishedReferenceConditions(productSpecs)))
    .limit(1);
  if (!spec) throw new ThermalError("THERMAL_REFERENCE_NOT_PUBLISHED", "产品规格未发布或已失效，不能引用");
}

/** 集可编辑守卫（行级操作前置）：集不存在抛 404，状态不允许抛 409 */
async function requireEditableSet(app: FastifyInstance, setId: string) {
  const [set] = await app.db.select().from(thermalReferenceSets).where(eq(thermalReferenceSets.id, setId)).limit(1);
  if (!set) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考集不存在");
  assertEditable(set as Record<string, unknown>, SET_META().label, CHILD_EDITABLE);
  return set;
}

export async function listThermalRows(
  app: FastifyInstance,
  setId: string,
  query: { page: number; pageSize: number; schemeId?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    eq(thermalReferenceRows.setId, setId),
    query.schemeId ? eq(thermalReferenceRows.schemeId, query.schemeId) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalReferenceRows).where(where)
      .orderBy(thermalReferenceRows.schemeId, thermalReferenceRows.thicknessMm).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalReferenceRows).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createThermalRow(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  setId: string, input: ThermalRowInput
) {
  await requireEditableSet(app, setId);
  await assertRowReferencesPublished(app, input.schemeId, input.productSpecId);
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(thermalReferenceRows).values({
      setId,
      schemeId: input.schemeId,
      productSpecId: input.productSpecId,
      thicknessMm: input.thicknessMm,
      productThermalResistance: input.productThermalResistance,
      totalThermalResistance: input.totalThermalResistance,
      kValue: input.kValue,
      rawThickness: input.rawThickness,
      rawProductResistance: input.rawProductResistance,
      rawTotalResistance: input.rawTotalResistance,
      rawKValue: input.rawKValue,
      evidenceSource: input.evidenceSource,
      evidenceRef: input.evidenceRef,
      evidenceLevel: input.evidenceLevel ?? "A",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "thermal_reference_row", targetId: created!.id,
      afterJson: { setId, schemeId: created!.schemeId, productSpecId: created!.productSpecId, thicknessMm: created!.thicknessMm }
    });
    return created!;
  });
}

export async function updateThermalRow(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<ThermalRowInput>
) {
  const [existing] = await app.db.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考行不存在");
  await requireEditableSet(app, existing.setId);
  const schemeId = input.schemeId ?? existing.schemeId;
  const productSpecId = input.productSpecId ?? existing.productSpecId;
  await assertRowReferencesPublished(app, schemeId, productSpecId);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(thermalReferenceRows).set({
      schemeId,
      productSpecId,
      thicknessMm: input.thicknessMm ?? existing.thicknessMm,
      productThermalResistance: input.productThermalResistance ?? existing.productThermalResistance,
      totalThermalResistance: input.totalThermalResistance ?? existing.totalThermalResistance,
      kValue: input.kValue ?? existing.kValue,
      rawThickness: input.rawThickness ?? existing.rawThickness,
      rawProductResistance: input.rawProductResistance ?? existing.rawProductResistance,
      rawTotalResistance: input.rawTotalResistance ?? existing.rawTotalResistance,
      rawKValue: input.rawKValue ?? existing.rawKValue,
      evidenceSource: input.evidenceSource ?? existing.evidenceSource,
      evidenceRef: input.evidenceRef ?? existing.evidenceRef,
      evidenceLevel: input.evidenceLevel ?? existing.evidenceLevel,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(thermalReferenceRows.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "thermal_reference_row", targetId: id,
      beforeJson: { thicknessMm: existing.thicknessMm }, afterJson: { thicknessMm: updated!.thicknessMm }
    });
    return updated!;
  });
}

export async function deleteThermalRow(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.id, id)).limit(1);
  if (!existing) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "图集热工参考行不存在");
  await requireEditableSet(app, existing.setId);
  await app.db.transaction(async (tx) => {
    await tx.delete(thermalReferenceRows).where(eq(thermalReferenceRows.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "thermal_reference_row", targetId: id,
      beforeJson: { schemeId: existing.schemeId, productSpecId: existing.productSpecId, thicknessMm: existing.thicknessMm }
    });
  });
  return { message: "图集热工参考行已删除" };
}

// ---------------------------------------------------------------- new-version 子表复制（同事务快照）

/** 复制参考行到新版本集：setId 指向新行，业务字段原样保留（历史版本快照不漂移） */
export async function copyThermalRows(
  tx: DbExecutor,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Promise<void> {
  const oldSetId = oldRow.id as string;
  const newSetId = newRow.id as string;
  const rows = await tx.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.setId, oldSetId));
  if (rows.length === 0) return;
  await tx.insert(thermalReferenceRows).values(rows.map((row) => ({
    setId: newSetId,
    schemeId: row.schemeId,
    productSpecId: row.productSpecId,
    thicknessMm: row.thicknessMm,
    productThermalResistance: row.productThermalResistance,
    totalThermalResistance: row.totalThermalResistance,
    kValue: row.kValue,
    rawThickness: row.rawThickness,
    rawProductResistance: row.rawProductResistance,
    rawTotalResistance: row.rawTotalResistance,
    rawKValue: row.rawKValue,
    evidenceSource: row.evidenceSource,
    evidenceRef: row.evidenceRef,
    evidenceLevel: row.evidenceLevel,
    createdById: row.createdById,
    updatedById: row.updatedById
  })));
}

/** 派生集新版本：PUBLISHED/DISABLED 版本 -> DRAFT 新行（version+1），同事务复制参考行 */
export function createThermalSetNextVersion(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, changeNote?: string
) {
  return createNextVersion(app, request, actor, "thermalReferenceSet", id, changeNote, copyThermalRows);
}

// ---------------------------------------------------------------- 结构校验（submit/publish 前强制）

export interface ThermalStructureViolation {
  field: string;
  message: string;
}

function violationsError(details: ThermalStructureViolation[]): never {
  const summary = details.map((d) => d.message).join("；");
  throw new ThermalError("THERMAL_STRUCTURE_INVALID", `图集热工参考集结构校验未通过：${summary}`);
}

/** 收集集的结构违规项（不抛错）：集非空、行引用已发布生效、数值>0、证据必填、厚度落在方案选项区间、生效区间合法 */
export async function collectThermalSetViolations(
  app: FastifyInstance,
  setId: string
): Promise<ThermalStructureViolation[]> {
  const violations: ThermalStructureViolation[] = [];

  const rows = await app.db.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.setId, setId));
  if (rows.length === 0) {
    violations.push({ field: "rows", message: "参考集没有任何参考行，无法提交审核" });
    return violations;
  }

  const now = new Date();
  const schemeIds = [...new Set(rows.map((row) => row.schemeId))];
  const schemes = await app.db.select().from(constructionSchemes)
    .where(inArray(constructionSchemes.id, schemeIds));
  const publishedSchemeIds = new Set(
    schemes.filter((s) =>
      s.status === "PUBLISHED" &&
      (s.effectiveAt === null || s.effectiveAt <= now) &&
      (s.expiresAt === null || s.expiresAt >= now)
    ).map((s) => s.id)
  );
  const options = await app.db.select().from(schemeProductOptions)
    .where(inArray(schemeProductOptions.schemeId, schemeIds));

  for (const row of rows) {
    if (!publishedSchemeIds.has(row.schemeId)) {
      violations.push({
        field: "rows.schemeId",
        message: `参考行 ${row.schemeId} 引用的构造方案未发布或已失效`
      });
      continue;
    }
    const option = options.find(
      (o) => o.schemeId === row.schemeId && o.productSpecId === row.productSpecId
    );
    if (!option) {
      violations.push({
        field: "rows.productSpecId",
        message: `参考行（构造 ${row.schemeId}）引用的产品规格不在该方案的产品选项中`
      });
      continue;
    }
    if (row.thicknessMm < option.minThickness || row.thicknessMm > option.maxThickness) {
      violations.push({
        field: "rows.thicknessMm",
        message: `参考行厚度 ${row.thicknessMm}mm 不在方案允许区间 [${option.minThickness}, ${option.maxThickness}]mm 内`
      });
    }
    if (row.productThermalResistance <= 0 || row.totalThermalResistance <= 0 || row.kValue <= 0) {
      violations.push({ field: "rows.numeric", message: "参考行的产品层热阻/总热阻/K 值必须大于 0" });
    }
    if (!row.evidenceSource?.trim() || !row.evidenceRef?.trim()) {
      violations.push({ field: "rows.evidence", message: "参考行的来源文档与页码必填" });
    }
  }

  const [set] = await app.db.select({ effectiveAt: thermalReferenceSets.effectiveAt, expiresAt: thermalReferenceSets.expiresAt })
    .from(thermalReferenceSets).where(eq(thermalReferenceSets.id, setId)).limit(1);
  if (set?.effectiveAt && set?.expiresAt && set.effectiveAt > set.expiresAt) {
    violations.push({ field: "effectiveAt/expiresAt", message: "生效时间晚于失效时间" });
  }
  return violations;
}

/** submit/publish 前置校验：不通过直接抛 THERMAL_STRUCTURE_INVALID */
export async function validateThermalSet(app: FastifyInstance, setId: string): Promise<void> {
  const violations = await collectThermalSetViolations(app, setId);
  if (violations.length > 0) violationsError(violations);
}

// ---------------------------------------------------------------- 导入作业

export interface ThermalImportJobCreateInput {
  setCode: string;
  name?: string;
  fileName: string;
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  sizeBytes: number;
  sha256?: string;
}

function safeExtension(fileName: string): string {
  const match = /\.(xlsx)$/i.exec(fileName);
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

/** 创建导入作业：建 files(UPLOADING) + job(CREATED)，返回预签名直传地址 */
export async function createThermalImportJob(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: ThermalImportJobCreateInput
) {
  if (input.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new ForbiddenError(`文件不能超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  }
  const fileId = randomUUID();
  const objectKey = `thermal/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(input.fileName)}`;
  const job = await app.db.transaction(async (tx) => {
    await tx.insert(files).values({
      id: fileId,
      ownerUserId: actor.id,
      storageProvider: app.storage.provider,
      bucket: app.storage.bucket,
      objectKey,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256 ?? null,
      source: "THERMAL_IMPORT",
      status: "UPLOADING"
    });
    const [created] = await tx.insert(thermalImportJobs).values({
      setCode: input.setCode,
      name: input.name?.trim() || input.setCode,
      fileId,
      templateVersion: IMPORT_TEMPLATE_VERSION,
      status: "CREATED",
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: THERMAL_IMPORT_CREATED, targetType: "thermal_import_job", targetId: created!.id,
      afterJson: { setCode: input.setCode, fileName: input.fileName }
    });
    return created!;
  });
  const upload = await app.storage.createUploadUrl(objectKey, input.mimeType, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
  return { ...job, uploadUrl: upload.url, headers: upload.headers, expiresAt: upload.expiresAt };
}

async function requireImportJob(app: FastifyInstance, jobId: string) {
  const [job] = await app.db.select().from(thermalImportJobs).where(eq(thermalImportJobs.id, jobId)).limit(1);
  if (!job) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "导入作业不存在");
  return job;
}

/** 确认上传完成：校验对象大小/哈希/MIME，置 QUEUED 并投递 thermal-import 队列解析 */
export async function completeThermalImportJob(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, jobId: string
) {
  const job = await requireImportJob(app, jobId);
  if (job.status !== "CREATED") throw new ThermalError("THERMAL_STATUS_CONFLICT", "该导入作业已确认过上传，不能重复确认");
  const [file] = await app.db.select().from(files).where(eq(files.id, job.fileId)).limit(1);
  if (!file) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "导入文件不存在");
  if (file.ownerUserId !== actor.id && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("只能操作本人上传的导入文件");
  }
  const object = await app.storage.statObject(file.objectKey);
  if (!object) throw new ForbiddenError("对象存储中未找到上传文件");
  if (object.size !== file.sizeBytes) throw new ForbiddenError("上传文件大小与申请信息不一致");
  const data = await app.storage.getObject(file.objectKey);
  if (file.sha256) {
    const actualSha256 = createHash("sha256").update(data).digest("hex");
    if (actualSha256.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new ForbiddenError("上传文件哈希与申请信息不一致，文件可能被篡改");
    }
  }
  const detected = await fileTypeFromBuffer(data);
  if (detected && detected.mime !== file.mimeType) {
    throw new ForbiddenError("上传文件实际类型与申请信息不一致");
  }
  await app.db.transaction(async (tx) => {
    await tx.update(files).set({ status: "QUEUED", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, file.id));
    await tx.update(thermalImportJobs).set({ status: "QUEUED", updatedAt: new Date() })
      .where(eq(thermalImportJobs.id, jobId));
    await writeAuditLog({
      db: tx, request, actor,
      action: THERMAL_IMPORT_COMPLETED, targetType: "thermal_import_job", targetId: jobId,
      afterJson: { fileId: file.id, fileName: file.originalName }
    });
  });
  try {
    await app.queues.thermalImport.add("parse_thermal_import", { jobId }, { jobId });
  } catch (error) {
    await app.db.update(thermalImportJobs).set({
      status: "FAILED", errorMessage: "解析任务投递失败，请稍后重试", updatedAt: new Date()
    }).where(eq(thermalImportJobs.id, jobId));
    throw new ServiceUnavailableError("解析任务投递失败，请稍后重试");
  }
  return { message: "文件上传确认完成，解析任务已提交", jobId };
}

export async function listThermalImportJobs(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: string; setCode?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(thermalImportJobs.status, query.status as never) : undefined,
    query.setCode ? eq(thermalImportJobs.setCode, query.setCode) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(thermalImportJobs).where(where).orderBy(desc(thermalImportJobs.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(thermalImportJobs).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

/** 作业详情：job + 错误清单 */
export async function getThermalImportJob(app: FastifyInstance, jobId: string) {
  const job = await requireImportJob(app, jobId);
  const errors = await app.db.select().from(thermalImportErrors)
    .where(eq(thermalImportErrors.jobId, jobId))
    .orderBy(thermalImportErrors.rowNumber);
  return { ...job, errors };
}

// ---------------------------------------------------------------- 预览 / 差异对比 / 应用

const rowKey = (schemeId: string, productSpecId: string, thicknessMm: number) =>
  `${schemeId}|${productSpecId}|${thicknessMm}`;

function validRowsOf(job: { result: unknown }): MatchedThermalRow[] {
  return Array.isArray(job.result) ? (job.result as MatchedThermalRow[]) : [];
}

/** 差异对比：目标集（setCode 最新 DRAFT/REJECTED）现有行 vs 导入行（键 = 方案+规格+厚度） */
export async function diffThermalImportJob(app: FastifyInstance, jobId: string) {
  const job = await requireImportJob(app, jobId);
  if (job.status !== "PARSED") throw new ThermalError("THERMAL_STATUS_CONFLICT", "仅解析完成的导入作业可以预览差异");
  const rows = validRowsOf(job);
  const targetSet = await latestApplyableSet(app, job.setCode);
  const existing = targetSet
    ? await app.db.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.setId, targetSet.id))
    : [];

  const existingByKey = new Map(existing.map((row) => [rowKey(row.schemeId, row.productSpecId, row.thicknessMm), row]));
  const added: MatchedThermalRow[] = [];
  const changed: Array<{ row: MatchedThermalRow; changes: string[] }> = [];
  for (const row of rows) {
    const current = existingByKey.get(rowKey(row.schemeId, row.productSpecId, row.thicknessMm));
    if (!current) {
      added.push(row);
      continue;
    }
    const changes: string[] = [];
    if (current.productThermalResistance !== row.productThermalResistance) changes.push("产品层热阻");
    if (current.totalThermalResistance !== row.totalThermalResistance) changes.push("总热阻");
    if (current.kValue !== row.kValue) changes.push("K值");
    if (current.evidenceSource !== row.evidenceSource) changes.push("来源文档");
    if (current.evidenceRef !== row.evidenceRef) changes.push("页码");
    if (changes.length > 0) changed.push({ row, changes });
  }
  const incomingKeys = new Set(rows.map((row) => rowKey(row.schemeId, row.productSpecId, row.thicknessMm)));
  const removed = existing.filter((row) => !incomingKeys.has(rowKey(row.schemeId, row.productSpecId, row.thicknessMm)));
  return { set: targetSet, added, changed, removed };
}

/** setCode 最新可复用集：无则 null；非 DRAFT/REJECTED 抛版本冲突（提示先派生新草稿） */
async function latestApplyableSet(app: FastifyInstance, setCode: string) {
  const [latest] = await app.db.select().from(thermalReferenceSets)
    .where(eq(thermalReferenceSets.code, setCode))
    .orderBy(desc(thermalReferenceSets.version)).limit(1);
  if (!latest) return null;
  if (!APPLYABLE_SET_STATUS.includes(latest.status as MdReviewStatus)) {
    throw new ThermalError("THERMAL_SET_VERSION_CONFLICT", `参考集「${setCode}」最新版本状态为 ${latest.status}，请先派生新版本草稿或更换集编码`);
  }
  return latest;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * 应用导入作业（单事务，全有或全无）：
 * - 错误行默认拒绝（body.ignoreErrors=true 显式确认才跳过，错误清单保留，绝不静默）；
 * - 目标集：无则创建 DRAFT v1，有最新 DRAFT/REJECTED 则复用，其余状态拒绝；
 * - added 插入 / changed 更新 / removed 跳过（响应提示，不删除旧行）；
 * - DB 唯一冲突（23505）整体回滚，写 APPLY_CONFLICT 错误行。
 */
export async function applyThermalImportJob(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  jobId: string, ignoreErrors: boolean
) {
  const job = await requireImportJob(app, jobId);
  if (job.status !== "PARSED") throw new ThermalError("THERMAL_STATUS_CONFLICT", "仅解析完成的导入作业可以应用");
  if (job.errorCount > 0 && !ignoreErrors) {
    throw new ThermalError("THERMAL_IMPORT_INVALID", `导入文件存在 ${job.errorCount} 行错误，需显式确认忽略（ignoreErrors=true）后才会跳过错误行`);
  }
  const rows = validRowsOf(job);

  let result: {
    set: { id: string; code: string; status: MdReviewStatus; version: number } | null;
    applied: number;
    updated: number;
    skippedRemoved: number;
  };
  try {
    result = await app.db.transaction(async (tx) => {
      const [latest] = await tx.select().from(thermalReferenceSets)
        .where(eq(thermalReferenceSets.code, job.setCode))
        .orderBy(desc(thermalReferenceSets.version)).limit(1);
      let targetSet = latest;
      if (!latest) {
        const [created] = await tx.insert(thermalReferenceSets).values({
          code: job.setCode,
          version: 1,
          name: job.name ?? job.setCode,
          status: "DRAFT",
          createdById: actor.id,
          updatedById: actor.id
        }).returning();
        await writeAuditLog({
          db: tx, request, actor,
          action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "thermal_reference_set", targetId: created!.id,
          afterJson: { code: created!.code, name: created!.name, version: created!.version, importedFrom: jobId }
        });
        targetSet = created!;
      } else if (!APPLYABLE_SET_STATUS.includes(latest.status as MdReviewStatus)) {
        throw new ThermalError("THERMAL_SET_VERSION_CONFLICT", `参考集「${job.setCode}」最新版本状态为 ${latest.status}，请先派生新版本草稿或更换集编码`);
      }

      const existing = await tx.select().from(thermalReferenceRows).where(eq(thermalReferenceRows.setId, targetSet!.id));
      const existingByKey = new Map(existing.map((row) => [rowKey(row.schemeId, row.productSpecId, row.thicknessMm), row]));

      const added = rows.filter((row) => !existingByKey.has(rowKey(row.schemeId, row.productSpecId, row.thicknessMm)));
      const changed = rows.filter((row) => {
        const current = existingByKey.get(rowKey(row.schemeId, row.productSpecId, row.thicknessMm));
        return current !== undefined && (current.productThermalResistance !== row.productThermalResistance ||
          current.totalThermalResistance !== row.totalThermalResistance || current.kValue !== row.kValue ||
          current.evidenceSource !== row.evidenceSource || current.evidenceRef !== row.evidenceRef);
      });

      if (added.length > 0) {
        await tx.insert(thermalReferenceRows).values(added.map((row) => ({
          setId: targetSet!.id,
          schemeId: row.schemeId,
          productSpecId: row.productSpecId,
          thicknessMm: row.thicknessMm,
          productThermalResistance: row.productThermalResistance,
          totalThermalResistance: row.totalThermalResistance,
          kValue: row.kValue,
          rawThickness: row.rawThickness,
          rawProductResistance: row.rawProductResistance,
          rawTotalResistance: row.rawTotalResistance,
          rawKValue: row.rawKValue,
          evidenceSource: row.evidenceSource,
          evidenceRef: row.evidenceRef,
          evidenceLevel: "A" as const,
          createdById: actor.id,
          updatedById: actor.id
        })));
      }
      for (const row of changed) {
        const current = existingByKey.get(rowKey(row.schemeId, row.productSpecId, row.thicknessMm))!;
        await tx.update(thermalReferenceRows).set({
          productThermalResistance: row.productThermalResistance,
          totalThermalResistance: row.totalThermalResistance,
          kValue: row.kValue,
          rawProductResistance: row.rawProductResistance,
          rawTotalResistance: row.rawTotalResistance,
          rawKValue: row.rawKValue,
          evidenceSource: row.evidenceSource,
          evidenceRef: row.evidenceRef,
          updatedById: actor.id,
          updatedAt: new Date()
        }).where(eq(thermalReferenceRows.id, current.id));
      }

      const incomingKeys = new Set(rows.map((row) => rowKey(row.schemeId, row.productSpecId, row.thicknessMm)));
      const removed = existing.filter((row) => !incomingKeys.has(rowKey(row.schemeId, row.productSpecId, row.thicknessMm)));

      const [updatedJob] = await tx.update(thermalImportJobs).set({
        status: "APPLIED",
        setId: targetSet!.id,
        appliedById: actor.id,
        appliedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(thermalImportJobs.id, jobId)).returning();
      await writeAuditLog({
        db: tx, request, actor,
        action: THERMAL_IMPORT_APPLIED, targetType: "thermal_import_job", targetId: jobId,
        afterJson: { setId: targetSet!.id, added: added.length, updated: changed.length, skippedRemoved: removed.length, ignoreErrors }
      });
      return {
        set: updatedJob!.setId ? { id: updatedJob!.setId, code: job.setCode, status: targetSet!.status, version: targetSet!.version } : null,
        applied: added.length,
        updated: changed.length,
        skippedRemoved: removed.length
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      await app.db.insert(thermalImportErrors).values({
        jobId,
        rowNumber: 0,
        errorType: "APPLY_CONFLICT",
        message: "应用时发生唯一约束冲突：同一参考集内相同构造、规格与厚度的参考行已存在，整个导入已回滚"
      });
      throw new ThermalError("THERMAL_DUPLICATE_KEY", "参考行唯一约束冲突，导入已整体回滚，请修正数据后重试");
    }
    throw error;
  }
  return result;
}