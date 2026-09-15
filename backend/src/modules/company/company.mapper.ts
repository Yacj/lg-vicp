import type { EnterpriseCertificate, EnterpriseProfile } from "../../db/schema.js";

export const COMPANY_PROFILE_CODE = "company_profile";

export interface CompanyQualificationView {
  id: string;
  name: string;
  fileId: string | null;
  certificateNo: string | null;
  expireDate: string | null;
  sortOrder: number;
  previewUrl: string | null;
  mimeType: string | null;
}

export interface CompanyProfileView {
  id: string | null;
  name: string;
  shortName: string | null;
  logoFileId: string | null;
  description: string | null;
  website: string | null;
  logoPreviewUrl: string | null;
  qualifications: CompanyQualificationView[];
  updatedAt: string | null;
}

export interface CompanyAboutView {
  name: string;
  shortName: string | null;
  logo: { fileId: string; previewUrl: string } | null;
  description: string | null;
  website: string | null;
  qualifications: Array<{
    id: string;
    name: string;
    fileId: string | null;
    certificateNo: string | null;
    expireDate: string | null;
    sortOrder: number;
    file: { fileId: string; previewUrl: string; mimeType: string | null } | null;
  }>;
}

/** 报告封面/页眉冻结用的企业摘要；intro 与 description 同值，兼容旧快照渲染键。 */
export interface ReportEnterpriseSnapshot {
  id: string;
  name: string;
  shortName: string | null;
  logoFileId: string | null;
  description: string | null;
  intro: string | null;
  website: string | null;
}

export function emptyCompanyProfile(): CompanyProfileView {
  return {
    id: null,
    name: "",
    shortName: null,
    logoFileId: null,
    description: null,
    website: null,
    logoPreviewUrl: null,
    qualifications: [],
    updatedAt: null
  };
}

export function toQualificationView(
  row: Pick<EnterpriseCertificate, "id" | "certName" | "fileId" | "certNo" | "expiryDate" | "sortOrder">,
  extras: { previewUrl?: string | null; mimeType?: string | null } = {}
): CompanyQualificationView {
  return {
    id: row.id,
    name: row.certName,
    fileId: row.fileId,
    certificateNo: row.certNo,
    expireDate: row.expiryDate,
    sortOrder: row.sortOrder ?? 0,
    previewUrl: extras.previewUrl ?? null,
    mimeType: extras.mimeType ?? null
  };
}

export function toCompanyProfileView(
  row: Pick<EnterpriseProfile, "id" | "name" | "shortName" | "intro" | "logoFileId" | "website" | "updatedAt">,
  qualifications: CompanyQualificationView[],
  logoPreviewUrl: string | null = null
): CompanyProfileView {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    logoFileId: row.logoFileId,
    description: row.intro,
    website: row.website,
    logoPreviewUrl,
    qualifications,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

export function toReportEnterpriseSnapshot(
  row: Pick<EnterpriseProfile, "id" | "name" | "shortName" | "intro" | "logoFileId" | "website">
): ReportEnterpriseSnapshot {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    logoFileId: row.logoFileId,
    description: row.intro,
    intro: row.intro,
    website: row.website
  };
}

export function toCompanyAboutView(
  profile: CompanyProfileView
): CompanyAboutView {
  return {
    name: profile.name,
    shortName: profile.shortName,
    logo: profile.logoFileId && profile.logoPreviewUrl
      ? { fileId: profile.logoFileId, previewUrl: profile.logoPreviewUrl }
      : null,
    description: profile.description,
    website: profile.website,
    qualifications: profile.qualifications.map((item) => ({
      id: item.id,
      name: item.name,
      fileId: item.fileId,
      certificateNo: item.certificateNo,
      expireDate: item.expireDate,
      sortOrder: item.sortOrder,
      file: item.fileId && item.previewUrl
        ? { fileId: item.fileId, previewUrl: item.previewUrl, mimeType: item.mimeType }
        : null
    }))
  };
}

/**
 * 从多行企业内容中选出普通业务使用的那一份：
 * 优先 company_profile + PUBLISHED，再退回最新版本；排除 DISABLED。
 */
export function pickCompanyProfileRow<T extends {
  code: string;
  status: string;
  version: number;
  updatedAt: Date | string;
}>(rows: T[]): T | null {
  const live = rows.filter((row) => row.status !== "DISABLED");
  if (live.length === 0) return null;
  const ranked = [...live].sort((left, right) => {
    const codeScore = Number(right.code === COMPANY_PROFILE_CODE) - Number(left.code === COMPANY_PROFILE_CODE);
    if (codeScore !== 0) return codeScore;
    const publishedScore = Number(right.status === "PUBLISHED") - Number(left.status === "PUBLISHED");
    if (publishedScore !== 0) return publishedScore;
    if (right.version !== left.version) return right.version - left.version;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  return ranked[0] ?? null;
}

export function isLiveQualificationStatus(status: string): boolean {
  return status !== "DISABLED";
}
