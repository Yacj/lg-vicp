import "dotenv/config";
import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  assertCompanyFileUsable,
  isCompanyLogoMime,
  isCompanyQualificationMime
} from "./company-files.js";
import {
  COMPANY_PROFILE_CODE,
  emptyCompanyProfile,
  pickCompanyProfileRow,
  toCompanyAboutView,
  toCompanyProfileView,
  toQualificationView,
  toReportEnterpriseSnapshot
} from "./company.mapper.js";
import {
  companyProfileUpdateSchema,
  companyQualificationUpdateSchema,
  companyQualificationWriteSchema
} from "./company.schemas.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const FILE_ID = "123e4567-e89b-42d3-a456-426614174001";

describe("企业信息普通 schema", () => {
  it("PUT profile 只接受名称/简称/Logo/简介/官网", () => {
    expect(companyProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(companyProfileUpdateSchema.safeParse({ name: "蓝格节能" }).success).toBe(true);
    expect(companyProfileUpdateSchema.safeParse({
      name: "蓝格节能",
      shortName: "蓝格",
      logoFileId: FILE_ID,
      description: "简介",
      website: "https://example.com"
    }).success).toBe(true);
    expect(companyProfileUpdateSchema.safeParse({
      name: "蓝格节能",
      address: "苏州市",
      contactPhone: "13800000000",
      unifiedSocialCreditCode: "9132"
    }).success).toBe(true);
    const parsed = companyProfileUpdateSchema.parse({
      name: "蓝格节能",
      address: "苏州市",
      contactPhone: "13800000000"
    });
    expect(parsed).toEqual({ name: "蓝格节能" });
  });

  it("资质创建必须有名称和附件，编号与有效期可选", () => {
    expect(companyQualificationWriteSchema.safeParse({ name: "ISO9001" }).success).toBe(false);
    expect(companyQualificationWriteSchema.safeParse({ name: "ISO9001", fileId: FILE_ID }).success).toBe(true);
    expect(companyQualificationWriteSchema.safeParse({
      name: "ISO9001",
      fileId: FILE_ID,
      certificateNo: "A-1",
      expireDate: "2028-12-31",
      sortOrder: 2
    }).success).toBe(true);
    expect(companyQualificationWriteSchema.safeParse({
      name: "ISO9001",
      fileId: FILE_ID,
      expireDate: "2028/12/31"
    }).success).toBe(false);
  });

  it("资质更新至少提供一个字段", () => {
    expect(companyQualificationUpdateSchema.safeParse({}).success).toBe(false);
    expect(companyQualificationUpdateSchema.safeParse({ name: "新名称" }).success).toBe(true);
  });
});

describe("企业信息文件校验", () => {
  it("Logo 仅允许系统图片格式，资质允许图片或 PDF", () => {
    expect(isCompanyLogoMime("image/png")).toBe(true);
    expect(isCompanyLogoMime("application/pdf")).toBe(false);
    expect(isCompanyQualificationMime("application/pdf")).toBe(true);
    expect(isCompanyQualificationMime("application/msword")).toBe(false);
  });

  it("未就绪或回收文件不可绑定", () => {
    expect(() => assertCompanyFileUsable({ status: "UPLOADING", mimeType: "image/png", deletedAt: null }, "logo"))
      .toThrow(AppError);
    expect(() => assertCompanyFileUsable({ status: "RECYCLED", mimeType: "image/png", deletedAt: null }, "logo"))
      .toThrow("不可用或已回收");
    expect(() => assertCompanyFileUsable({ status: "READY", mimeType: "application/pdf", deletedAt: null }, "logo"))
      .toThrow("仅支持 PNG、JPEG、SVG");
    expect(() => assertCompanyFileUsable({ status: "READY", mimeType: "application/pdf", deletedAt: null }, "qualification"))
      .not.toThrow();
  });
});

describe("CompanyProfile / Qualification 映射", () => {
  it("历史 intro 映射为 description，certName/certNo/expiryDate 映射为普通字段", () => {
    const qualification = toQualificationView({
      id: UUID,
      certName: "安全生产许可证",
      fileId: FILE_ID,
      certNo: "T-01",
      expiryDate: "2027-01-01",
      sortOrder: 3
    }, { previewUrl: "https://signed/q", mimeType: "application/pdf" });
    expect(qualification).toMatchObject({
      name: "安全生产许可证",
      certificateNo: "T-01",
      expireDate: "2027-01-01",
      sortOrder: 3,
      previewUrl: "https://signed/q"
    });

    const profile = toCompanyProfileView({
      id: UUID,
      name: "蓝格节能科技有限公司",
      shortName: "蓝格",
      intro: "企业简介",
      logoFileId: FILE_ID,
      website: "https://lg.example",
      updatedAt: new Date("2026-09-15T08:00:00.000Z")
    }, [qualification], "https://signed/logo");
    expect(profile).toMatchObject({
      description: "企业简介",
      logoFileId: FILE_ID,
      logoPreviewUrl: "https://signed/logo"
    });
    expect(profile.updatedAt).toBe("2026-09-15T08:00:00.000Z");

    const about = toCompanyAboutView(profile);
    expect(about.logo).toEqual({ fileId: FILE_ID, previewUrl: "https://signed/logo" });
    expect(about.qualifications[0]?.file).toMatchObject({ fileId: FILE_ID, mimeType: "application/pdf" });
    expect(about).not.toHaveProperty("address");
    expect(about).not.toHaveProperty("contactPhone");
  });

  it("报告快照只冻结普通字段，intro 与 description 同值兼容旧渲染", () => {
    const snapshot = toReportEnterpriseSnapshot({
      id: UUID,
      name: "蓝格节能科技有限公司",
      shortName: "蓝格",
      intro: "简介",
      logoFileId: FILE_ID,
      website: null
    });
    expect(snapshot).toEqual({
      id: UUID,
      name: "蓝格节能科技有限公司",
      shortName: "蓝格",
      logoFileId: FILE_ID,
      description: "简介",
      intro: "简介",
      website: null
    });
    expect(snapshot).not.toHaveProperty("address");
  });

  it("未配置时返回空档案而不是抛错", () => {
    expect(emptyCompanyProfile()).toMatchObject({ id: null, name: "", qualifications: [] });
  });

  it("普通读取优先 company_profile 的已发布行，DISABLED 不参与", () => {
    const picked = pickCompanyProfileRow([
      { code: "other", status: "PUBLISHED", version: 9, updatedAt: "2026-01-01" },
      { code: COMPANY_PROFILE_CODE, status: "DISABLED", version: 4, updatedAt: "2026-09-01" },
      { code: COMPANY_PROFILE_CODE, status: "DRAFT", version: 2, updatedAt: "2026-08-01" },
      { code: COMPANY_PROFILE_CODE, status: "PUBLISHED", version: 3, updatedAt: "2026-07-01" }
    ]);
    expect(picked).toMatchObject({ status: "PUBLISHED", version: 3 });
  });
});
