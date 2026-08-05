import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { enterpriseCertificates, enterpriseProfiles } from "../../db/schema.js";
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
 * 企业内容与证书服务。
 * enterprise_profiles：版本化实体（同 code 多版本行，发布互斥）；enterprise_certificates：文档引用型（fileId），无版本递增，编辑就地改。
 */

// ---------------------------------------------------------------- 企业内容（版本化）

export interface EnterpriseProfileCreateInput {
  code?: string;
  name: string;
  shortName?: string | null;
  intro?: string | null;
  logoFileId?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  changeNote?: string | null;
}

export async function listEnterpriseProfiles(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(enterpriseProfiles.status, query.status) : undefined,
    query.keyword
      ? or(
          ilike(enterpriseProfiles.name, `%${query.keyword}%`),
          ilike(enterpriseProfiles.shortName, `%${query.keyword}%`)
        )
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(enterpriseProfiles).where(where).orderBy(desc(enterpriseProfiles.updatedAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(enterpriseProfiles).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getEnterpriseProfile(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(enterpriseProfiles).where(eq(enterpriseProfiles.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "企业内容不存在");
  return row;
}

export async function createEnterpriseProfile(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: EnterpriseProfileCreateInput
) {
  const meta = MD_ENTITIES.enterpriseProfile!;
  await assertKeyAvailable(app.db, meta, { code: input.code ?? "company_profile" });
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(enterpriseProfiles).values({
      code: input.code ?? "company_profile",
      version: 1,
      name: input.name,
      shortName: input.shortName,
      intro: input.intro,
      logoFileId: input.logoFileId,
      address: input.address,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      website: input.website,
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

export async function updateEnterpriseProfile(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<EnterpriseProfileCreateInput>
) {
  const meta = MD_ENTITIES.enterpriseProfile!;
  const [existing] = await app.db.select().from(enterpriseProfiles).where(eq(enterpriseProfiles.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "企业内容不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT", "PENDING_REVIEW", "REJECTED"]);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(enterpriseProfiles).set({
      name: input.name ?? existing.name,
      shortName: input.shortName === undefined ? existing.shortName : input.shortName,
      intro: input.intro === undefined ? existing.intro : input.intro,
      logoFileId: input.logoFileId === undefined ? existing.logoFileId : input.logoFileId,
      address: input.address === undefined ? existing.address : input.address,
      contactPhone: input.contactPhone === undefined ? existing.contactPhone : input.contactPhone,
      contactEmail: input.contactEmail === undefined ? existing.contactEmail : input.contactEmail,
      website: input.website === undefined ? existing.website : input.website,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      changeNote: input.changeNote === undefined ? existing.changeNote : input.changeNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(enterpriseProfiles.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: meta.kind, targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteEnterpriseProfile(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const meta = MD_ENTITIES.enterpriseProfile!;
  const [existing] = await app.db.select().from(enterpriseProfiles).where(eq(enterpriseProfiles.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "企业内容不存在");
  assertEditable(existing as Record<string, unknown>, meta.label, ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(enterpriseProfiles).where(eq(enterpriseProfiles.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: meta.kind, targetId: id,
      beforeJson: { code: existing.code, version: existing.version }
    });
  });
  return { message: "企业内容草稿已删除" };
}

// ---------------------------------------------------------------- 企业证书（非版本化）

export interface CertificateInput {
  certName: string;
  certNo?: string | null;
  issuer?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  fileId?: string | null;
  description?: string | null;
  evidenceSource?: string | null;
  evidenceRef?: string | null;
  evidenceLevel?: "A" | "B" | "C" | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

export async function listCertificates(
  app: FastifyInstance,
  query: { page: number; pageSize: number; status?: MdReviewStatus; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.status ? eq(enterpriseCertificates.status, query.status) : undefined,
    query.keyword
      ? or(ilike(enterpriseCertificates.certName, `%${query.keyword}%`), ilike(enterpriseCertificates.certNo, `%${query.keyword}%`))
      : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(enterpriseCertificates).where(where).orderBy(desc(enterpriseCertificates.createdAt)).offset(skip).limit(take),
    app.db.select({ value: count() }).from(enterpriseCertificates).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getCertificate(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(enterpriseCertificates).where(eq(enterpriseCertificates.id, id)).limit(1);
  if (!row) throw new MdError("MD_ENTITY_NOT_FOUND", "企业证书不存在");
  return row;
}

export async function createCertificate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, input: CertificateInput
) {
  return app.db.transaction(async (tx) => {
    const [created] = await tx.insert(enterpriseCertificates).values({
      ...input,
      status: "DRAFT",
      createdById: actor.id,
      updatedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_CREATED, targetType: "md_enterprise_certificate", targetId: created!.id,
      afterJson: { certName: created!.certName }
    });
    return created!;
  });
}

export async function updateCertificate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser,
  id: string, input: Partial<CertificateInput>
) {
  const [existing] = await app.db.select().from(enterpriseCertificates).where(eq(enterpriseCertificates.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "企业证书不存在");
  assertEditable(existing as Record<string, unknown>, "企业证书", ["DRAFT", "PENDING_REVIEW", "REJECTED", "DISABLED"]);
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(enterpriseCertificates).set({
      certName: input.certName ?? existing.certName,
      certNo: input.certNo === undefined ? existing.certNo : input.certNo,
      issuer: input.issuer === undefined ? existing.issuer : input.issuer,
      issueDate: input.issueDate === undefined ? existing.issueDate : input.issueDate,
      expiryDate: input.expiryDate === undefined ? existing.expiryDate : input.expiryDate,
      fileId: input.fileId === undefined ? existing.fileId : input.fileId,
      description: input.description === undefined ? existing.description : input.description,
      evidenceSource: input.evidenceSource === undefined ? existing.evidenceSource : input.evidenceSource,
      evidenceRef: input.evidenceRef === undefined ? existing.evidenceRef : input.evidenceRef,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      effectiveAt: input.effectiveAt === undefined ? existing.effectiveAt : input.effectiveAt,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(enterpriseCertificates.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_UPDATED, targetType: "md_enterprise_certificate", targetId: id,
      beforeJson: { status: existing.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

export async function deleteCertificate(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await app.db.select().from(enterpriseCertificates).where(eq(enterpriseCertificates.id, id)).limit(1);
  if (!existing) throw new MdError("MD_ENTITY_NOT_FOUND", "企业证书不存在");
  assertEditable(existing as Record<string, unknown>, "企业证书", ["DRAFT"]);
  await app.db.transaction(async (tx) => {
    await tx.delete(enterpriseCertificates).where(eq(enterpriseCertificates.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.MD_ENTITY_DELETED, targetType: "md_enterprise_certificate", targetId: id,
      beforeJson: { certName: existing.certName }
    });
  });
  return { message: "企业证书草稿已删除" };
}

/** 证书审核工作流：非版本化实体，submit/approve/reject/publish/disable 共用状态机 */
export const certificateWorkflow = {
  submit: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: enterpriseCertificates, idColumn: enterpriseCertificates.id, statusColumn: enterpriseCertificates.status, kind: "md_enterprise_certificate", label: "企业证书" }, id, ["DRAFT", "REJECTED"], "PENDING_REVIEW", AUDIT_ACTIONS.MD_ENTITY_SUBMITTED, MD_REVIEW_SETS.submit(actor)),
  approve: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string) =>
    transitionMdStatus(app, request, actor, { table: enterpriseCertificates, idColumn: enterpriseCertificates.id, statusColumn: enterpriseCertificates.status, kind: "md_enterprise_certificate", label: "企业证书" }, id, ["PENDING_REVIEW"], "APPROVED", AUDIT_ACTIONS.MD_ENTITY_APPROVED, MD_REVIEW_SETS.approve(actor, approvalNote)),
  reject: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string) =>
    transitionMdStatus(app, request, actor, { table: enterpriseCertificates, idColumn: enterpriseCertificates.id, statusColumn: enterpriseCertificates.status, kind: "md_enterprise_certificate", label: "企业证书" }, id, ["PENDING_REVIEW"], "REJECTED", AUDIT_ACTIONS.MD_ENTITY_REJECTED, MD_REVIEW_SETS.reject(actor, rejectReason)),
  publish: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: enterpriseCertificates, idColumn: enterpriseCertificates.id, statusColumn: enterpriseCertificates.status, kind: "md_enterprise_certificate", label: "企业证书" }, id, ["APPROVED"], "PUBLISHED", AUDIT_ACTIONS.MD_ENTITY_PUBLISHED, MD_REVIEW_SETS.publish(actor)),
  disable: (app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) =>
    transitionMdStatus(app, request, actor, { table: enterpriseCertificates, idColumn: enterpriseCertificates.id, statusColumn: enterpriseCertificates.status, kind: "md_enterprise_certificate", label: "企业证书" }, id, ["PUBLISHED"], "DISABLED", AUDIT_ACTIONS.MD_ENTITY_DISABLED)
};