import { files } from "../../db/schema.js";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { AppError } from "../../shared/errors.js";

/** Logo 使用文件中心当前允许的图片格式 */
export const COMPANY_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;

/** 资质附件：图片或 PDF */
export const COMPANY_QUALIFICATION_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "application/pdf"
] as const;

export type CompanyFileKind = "logo" | "qualification";

const MIME_BY_KIND: Record<CompanyFileKind, readonly string[]> = {
  logo: COMPANY_LOGO_MIME_TYPES,
  qualification: COMPANY_QUALIFICATION_MIME_TYPES
};

export function isCompanyLogoMime(mimeType: string): boolean {
  return (COMPANY_LOGO_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isCompanyQualificationMime(mimeType: string): boolean {
  return (COMPANY_QUALIFICATION_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function companyFileKindLabel(kind: CompanyFileKind): string {
  return kind === "logo" ? "企业 Logo" : "企业资质附件";
}

type FileRow = typeof files.$inferSelect;

export function assertCompanyFileUsable(file: Pick<FileRow, "status" | "mimeType" | "deletedAt">, kind: CompanyFileKind) {
  if (file.deletedAt || file.status === "DELETED" || file.status === "RECYCLED") {
    throw new AppError("FILE_NOT_USABLE", `${companyFileKindLabel(kind)}文件不可用或已回收`, 400);
  }
  if (file.status !== "READY") {
    throw new AppError("FILE_NOT_READY", `${companyFileKindLabel(kind)}文件尚未就绪`, 400);
  }
  const allowed = MIME_BY_KIND[kind];
  if (!allowed.includes(file.mimeType)) {
    throw new AppError(
      "FILE_MIME_NOT_ALLOWED",
      kind === "logo" ? "企业 Logo 仅支持 PNG、JPEG、SVG" : "企业资质附件仅支持图片或 PDF",
      400
    );
  }
}

/** 校验文件中心 fileId：存在、READY、MIME 符合用途；只保存 fileId，不复制对象存储字段。 */
export async function requireCompanyFile(
  app: FastifyInstance,
  fileId: string,
  kind: CompanyFileKind
): Promise<FileRow> {
  const [file] = await app.db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) {
    throw new AppError("FILE_NOT_FOUND", `${companyFileKindLabel(kind)}文件不存在`, 400);
  }
  assertCompanyFileUsable(file, kind);
  return file;
}
