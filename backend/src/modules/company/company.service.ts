import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { enterpriseCertificates, enterpriseProfiles, files, type EnterpriseCertificate } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { NotFoundError } from "../../shared/errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { requireCompanyFile } from "./company-files.js";
import {
  COMPANY_PROFILE_CODE,
  emptyCompanyProfile,
  isLiveQualificationStatus,
  pickCompanyProfileRow,
  toCompanyAboutView,
  toCompanyProfileView,
  toQualificationView,
  toReportEnterpriseSnapshot,
  type CompanyAboutView,
  type CompanyProfileView,
  type CompanyQualificationView,
  type ReportEnterpriseSnapshot
} from "./company.mapper.js";

type QualificationWriteInput = {
  name?: string;
  fileId?: string | null;
  certificateNo?: string | null;
  expireDate?: string | null;
  sortOrder?: number;
};

type FilePreview = { previewUrl: string | null; mimeType: string | null };

async function signPreviewUrl(app: FastifyInstance, objectKey: string | null | undefined): Promise<string | null> {
  if (!objectKey || !app.storage?.createPreviewUrl) return null;
  const expires = Number(process.env.STORAGE_PRESIGN_EXPIRES_SECONDS) || 900;
  return app.storage.createPreviewUrl(objectKey, expires);
}

async function loadFilePreviews(app: FastifyInstance, fileIds: Array<string | null | undefined>): Promise<Map<string, FilePreview>> {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, FilePreview>();
  if (ids.length === 0) return map;
  const rows = await app.db.select({
    id: files.id,
    objectKey: files.objectKey,
    mimeType: files.mimeType,
    status: files.status
  }).from(files).where(inArray(files.id, ids));
  await Promise.all(rows.map(async (row) => {
    const previewUrl = row.status === "READY" ? await signPreviewUrl(app, row.objectKey) : null;
    map.set(row.id, { previewUrl, mimeType: row.mimeType });
  }));
  return map;
}

export async function loadCompanyProfileRow(app: FastifyInstance) {
  const rows = await app.db.select().from(enterpriseProfiles)
    .where(ne(enterpriseProfiles.status, "DISABLED"))
    .orderBy(desc(enterpriseProfiles.updatedAt));
  return pickCompanyProfileRow(rows);
}

async function loadCompanyProfileRowForWrite(app: FastifyInstance) {
  const live = await loadCompanyProfileRow(app);
  if (live) return live;
  const rows = await app.db.select().from(enterpriseProfiles)
    .orderBy(desc(enterpriseProfiles.version), desc(enterpriseProfiles.updatedAt));
  return rows.find((row) => row.code === COMPANY_PROFILE_CODE) ?? rows[0] ?? null;
}

async function listLiveQualificationRows(app: FastifyInstance): Promise<EnterpriseCertificate[]> {
  return app.db.select().from(enterpriseCertificates)
    .where(ne(enterpriseCertificates.status, "DISABLED"))
    .orderBy(asc(enterpriseCertificates.sortOrder), asc(enterpriseCertificates.createdAt));
}

async function toQualificationViews(app: FastifyInstance, rows: EnterpriseCertificate[]): Promise<CompanyQualificationView[]> {
  const previews = await loadFilePreviews(app, rows.map((row) => row.fileId));
  return rows.map((row) => {
    const extra = row.fileId ? previews.get(row.fileId) : undefined;
    return toQualificationView(row, extra);
  });
}

async function buildCompanyProfileView(app: FastifyInstance): Promise<CompanyProfileView> {
  const row = await loadCompanyProfileRow(app);
  const qualifications = await toQualificationViews(app, await listLiveQualificationRows(app));
  if (!row) {
    return { ...emptyCompanyProfile(), qualifications };
  }
  const previews = await loadFilePreviews(app, [row.logoFileId]);
  const logoPreviewUrl = row.logoFileId ? previews.get(row.logoFileId)?.previewUrl ?? null : null;
  return toCompanyProfileView(row, qualifications, logoPreviewUrl);
}

export async function getCompanyProfile(app: FastifyInstance): Promise<CompanyProfileView> {
  return buildCompanyProfileView(app);
}

export async function updateCompanyProfile(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: {
    name: string;
    shortName?: string | null;
    logoFileId?: string | null;
    description?: string | null;
    website?: string | null;
  }
): Promise<CompanyProfileView> {
  if (input.logoFileId) {
    await requireCompanyFile(app, input.logoFileId, "logo");
  }
  const existing = await loadCompanyProfileRowForWrite(app);
  const now = new Date();
  await app.db.transaction(async (tx) => {
    if (!existing) {
      const [created] = await tx.insert(enterpriseProfiles).values({
        code: COMPANY_PROFILE_CODE,
        version: 1,
        name: input.name,
        shortName: input.shortName ?? null,
        intro: input.description ?? null,
        logoFileId: input.logoFileId ?? null,
        website: input.website ?? null,
        status: "PUBLISHED",
        publishedById: actor.id,
        publishedAt: now,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "company_profile", targetId: created!.id,
        afterJson: { name: created!.name, logoFileId: created!.logoFileId }
      });
      return;
    }
    const [updated] = await tx.update(enterpriseProfiles).set({
      name: input.name,
      shortName: input.shortName === undefined ? existing.shortName : input.shortName,
      intro: input.description === undefined ? existing.intro : input.description,
      logoFileId: input.logoFileId === undefined ? existing.logoFileId : input.logoFileId,
      website: input.website === undefined ? existing.website : input.website,
      status: "PUBLISHED",
      publishedById: existing.publishedById ?? actor.id,
      publishedAt: existing.publishedAt ?? now,
      updatedById: actor.id,
      updatedAt: now
    }).where(eq(enterpriseProfiles.id, existing.id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "company_profile", targetId: existing.id,
      beforeJson: { name: existing.name, logoFileId: existing.logoFileId },
      afterJson: { name: updated!.name, logoFileId: updated!.logoFileId }
    });
  });
  return buildCompanyProfileView(app);
}

export async function listCompanyQualifications(app: FastifyInstance): Promise<{ items: CompanyQualificationView[] }> {
  const items = await toQualificationViews(app, await listLiveQualificationRows(app));
  return { items };
}

export async function createCompanyQualification(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; fileId: string; certificateNo?: string | null; expireDate?: string | null; sortOrder?: number }
): Promise<CompanyQualificationView> {
  await requireCompanyFile(app, input.fileId, "qualification");
  const now = new Date();
  const created = await app.db.transaction(async (tx) => {
    const [row] = await tx.insert(enterpriseCertificates).values({
      certName: input.name,
      fileId: input.fileId,
      certNo: input.certificateNo ?? null,
      expiryDate: input.expireDate ?? null,
      sortOrder: input.sortOrder ?? 0,
      status: "PUBLISHED",
      publishedById: actor.id,
      publishedAt: now,
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "company_qualification", targetId: row!.id,
      afterJson: { name: row!.certName, fileId: row!.fileId }
    });
    return row!;
  });
  const [view] = await toQualificationViews(app, [created]);
  return view!;
}

export async function updateCompanyQualification(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: QualificationWriteInput
): Promise<CompanyQualificationView> {
  const [existing] = await app.db.select().from(enterpriseCertificates).where(eq(enterpriseCertificates.id, id)).limit(1);
  if (!existing || !isLiveQualificationStatus(existing.status)) {
    throw new NotFoundError("企业资质不存在");
  }
  if (input.fileId) {
    await requireCompanyFile(app, input.fileId, "qualification");
  }
  const updated = await app.db.transaction(async (tx) => {
    const [row] = await tx.update(enterpriseCertificates).set({
      certName: input.name ?? existing.certName,
      fileId: input.fileId === undefined ? existing.fileId : input.fileId,
      certNo: input.certificateNo === undefined ? existing.certNo : input.certificateNo,
      expiryDate: input.expireDate === undefined ? existing.expiryDate : input.expireDate,
      sortOrder: input.sortOrder === undefined ? existing.sortOrder : input.sortOrder,
      status: existing.status === "DISABLED" ? existing.status : "PUBLISHED",
      publishedById: existing.publishedById ?? actor.id,
      publishedAt: existing.publishedAt ?? new Date(),
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(enterpriseCertificates.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "company_qualification", targetId: id,
      beforeJson: { name: existing.certName, fileId: existing.fileId },
      afterJson: { name: row!.certName, fileId: row!.fileId }
    });
    return row!;
  });
  const [view] = await toQualificationViews(app, [updated]);
  return view!;
}

export async function deleteCompanyQualification(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string
): Promise<{ message: string }> {
  const [existing] = await app.db.select().from(enterpriseCertificates).where(eq(enterpriseCertificates.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError("企业资质不存在");
  }
  await app.db.transaction(async (tx) => {
    await tx.delete(enterpriseCertificates).where(eq(enterpriseCertificates.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "company_qualification", targetId: id,
      beforeJson: { name: existing.certName, fileId: existing.fileId }
    });
  });
  return { message: "企业资质已删除" };
}

export async function getCompanyAbout(app: FastifyInstance): Promise<CompanyAboutView> {
  const profile = await buildCompanyProfileView(app);
  if (!profile.id || !profile.name.trim()) {
    throw new NotFoundError("企业介绍尚未配置");
  }
  return toCompanyAboutView(profile);
}

/** 报告封面/页眉页脚读取 CompanyProfile；无档案时返回 null。 */
export async function loadReportEnterprise(app: FastifyInstance): Promise<ReportEnterpriseSnapshot | null> {
  const row = await loadCompanyProfileRow(app);
  if (!row) return null;
  return toReportEnterpriseSnapshot(row);
}

export async function loadCompanyLogoFileId(app: FastifyInstance): Promise<string | null> {
  const row = await loadCompanyProfileRow(app);
  return typeof row?.logoFileId === "string" ? row.logoFileId : null;
}

/** 旧 C 端接口兼容包装：字段别名 intro/logoUrl，不返回工商/联系人等内部字段。 */
export async function getLegacyEnterpriseProfileAbout(app: FastifyInstance) {
  const about = await getCompanyAbout(app);
  return {
    profile: {
      name: about.name,
      shortName: about.shortName,
      intro: about.description,
      description: about.description,
      website: about.website,
      logoUrl: about.logo?.previewUrl ?? null,
      logo: about.logo,
      qualifications: about.qualifications
    }
  };
}