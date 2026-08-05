import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  approveBodySchema,
  attachmentCreateSchema,
  enterpriseProfileCreateSchema,
  materialParameterCreateSchema,
  productParameterCreateSchema,
  productSpecCreateSchema,
  rejectBodySchema
} from "./md.schemas.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("产品规格 schema", () => {
  it("厚度必须大于 0", () => {
    expect(productSpecCreateSchema.safeParse({
      seriesId: UUID, specCode: "A-01", specClass: "I", thicknessMm: 0
    }).success).toBe(false);
    expect(productSpecCreateSchema.safeParse({
      seriesId: UUID, specCode: "A-01", specClass: "I", thicknessMm: 30
    }).success).toBe(true);
  });

  it("specClass 仅允许 I/II/III", () => {
    const base = { seriesId: UUID, specCode: "A-01", thicknessMm: 30 };
    expect(productSpecCreateSchema.safeParse({ ...base, specClass: "IV" }).success).toBe(false);
    expect(productSpecCreateSchema.safeParse({ ...base, specClass: "II" }).success).toBe(true);
  });

  it("supplyRegions 必须为字符串数组", () => {
    const base = { seriesId: UUID, specCode: "A-01", specClass: "I", thicknessMm: 30 };
    expect(productSpecCreateSchema.safeParse({ ...base, supplyRegions: ["华东"] }).success).toBe(true);
    expect(productSpecCreateSchema.safeParse({ ...base, supplyRegions: [123] }).success).toBe(false);
  });
});

describe("产品性能参数 schema", () => {
  const base = {
    specId: UUID, parameterCode: "K", parameterName: "导热系数",
    paramSource: "ATLAS", value: 0.032
  };

  it("paramSource 仅允许四来源", () => {
    expect(productParameterCreateSchema.safeParse({ ...base, paramSource: "GUESS" }).success).toBe(false);
    expect(productParameterCreateSchema.safeParse({ ...base, paramSource: "DETECTION" }).success).toBe(true);
  });

  it("value 必须为数字", () => {
    expect(productParameterCreateSchema.safeParse({ ...base, value: "0.03" }).success).toBe(false);
    expect(productParameterCreateSchema.safeParse({ ...base, value: 0.03 }).success).toBe(true);
  });

  it("update 场景：可空字段用 null 清空、必填数值字段禁止清空", () => {
    expect(productParameterCreateSchema.partial().safeParse({ unit: null }).success).toBe(true);
    expect(productParameterCreateSchema.partial().safeParse({ value: null }).success).toBe(false);
  });
});

describe("工作流请求体 schema", () => {
  it("reject 的驳回原因必填", () => {
    expect(rejectBodySchema.safeParse({}).success).toBe(false);
    expect(rejectBodySchema.safeParse({ rejectReason: "" }).success).toBe(false);
    expect(rejectBodySchema.safeParse({ rejectReason: "检测报告页码缺失" }).success).toBe(true);
  });

  it("approve 意见可选", () => {
    expect(approveBodySchema.safeParse({}).success).toBe(true);
    expect(approveBodySchema.safeParse({ approvalNote: "同意发布" }).success).toBe(true);
  });
});

describe("企业内容 schema", () => {
  it("name 必填且非空", () => {
    expect(enterpriseProfileCreateSchema.safeParse({}).success).toBe(false);
    expect(enterpriseProfileCreateSchema.safeParse({ name: "示例企业" }).success).toBe(true);
  });

  it("logoFileId 必须为 UUID", () => {
    expect(enterpriseProfileCreateSchema.safeParse({ name: "示例企业", logoFileId: "not-uuid" }).success).toBe(false);
    expect(enterpriseProfileCreateSchema.safeParse({ name: "示例企业", logoFileId: UUID }).success).toBe(true);
  });
});

describe("材料参数 schema", () => {
  it("materialId 与 thermalConductivity 必填", () => {
    expect(materialParameterCreateSchema.safeParse({ materialId: UUID }).success).toBe(false);
    expect(materialParameterCreateSchema.safeParse({
      materialId: UUID, thermalConductivity: 0.03
    }).success).toBe(true);
  });

  it("修正系数允许为空但不可为字符串", () => {
    expect(materialParameterCreateSchema.safeParse({
      materialId: UUID, thermalConductivity: 0.03, correctionFactor: "1.1"
    }).success).toBe(false);
  });
});

describe("附件 schema", () => {
  it("targetType 仅允许三种目标", () => {
    const base = { targetType: "PRODUCT_SPEC", targetId: UUID, fileId: UUID };
    expect(attachmentCreateSchema.safeParse({ ...base, targetType: "BANNER" }).success).toBe(false);
    expect(attachmentCreateSchema.safeParse(base).success).toBe(true);
  });
});