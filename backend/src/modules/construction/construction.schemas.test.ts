import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  approveBodySchema,
  constructionLayerCreateSchema,
  constructionSchemeCreateSchema,
  constructionSchemeListQuerySchema,
  insulationSystemCreateSchema,
  newVersionBodySchema,
  rejectBodySchema,
  schemeDocumentCreateSchema,
  schemeProductOptionCreateSchema
} from "./construction.schemas.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("保温系统 schema", () => {
  it("code/name/systemType 必填且非空", () => {
    expect(insulationSystemCreateSchema.safeParse({}).success).toBe(false);
    expect(insulationSystemCreateSchema.safeParse({ code: "ETICS", name: "外墙外保温", systemType: "外墙外保温" }).success).toBe(true);
    expect(insulationSystemCreateSchema.safeParse({ code: "  ", name: "外墙外保温", systemType: "外墙外保温" }).success).toBe(false);
  });
});

describe("构造方案 schema", () => {
  it("systemId 必须为 UUID，schemeCode/substrateMaterial 必填", () => {
    const base = { systemId: UUID, schemeCode: "A1-1", name: "A1-1 外墙外保温", substrateMaterial: "钢筋混凝土" };
    expect(constructionSchemeCreateSchema.safeParse(base).success).toBe(true);
    expect(constructionSchemeCreateSchema.safeParse({ ...base, systemId: "not-uuid" }).success).toBe(false);
    expect(constructionSchemeCreateSchema.safeParse({ ...base, schemeCode: "" }).success).toBe(false);
    expect(constructionSchemeCreateSchema.safeParse({ ...base, substrateMaterial: "" }).success).toBe(false);
  });

  it("update 场景：partial 空对象通过，substrateThickness 可 null 清空", () => {
    const update = constructionSchemeCreateSchema.partial();
    expect(update.safeParse({}).success).toBe(true);
    expect(update.safeParse({ substrateThickness: null }).success).toBe(true);
    expect(update.safeParse({ substrateThickness: -5 }).success).toBe(false);
  });

  it("列表查询支持 systemId/schemeCode 过滤", () => {
    expect(constructionSchemeListQuerySchema.safeParse({}).success).toBe(true);
    expect(constructionSchemeListQuerySchema.safeParse({ systemId: UUID, schemeCode: "A1-1" }).success).toBe(true);
    expect(constructionSchemeListQuerySchema.safeParse({ systemId: "bad" }).success).toBe(false);
    expect(constructionSchemeListQuerySchema.safeParse({ status: "UNKNOWN" }).success).toBe(false);
  });
});

describe("构造层 schema", () => {
  const base = { layerOrder: 1, layerType: "PRODUCT_LAYER", layerName: "XPS 保温板" };

  it("layerOrder 必须为正整数，layerType 仅允许四种层型", () => {
    expect(constructionLayerCreateSchema.safeParse(base).success).toBe(true);
    expect(constructionLayerCreateSchema.safeParse({ ...base, layerOrder: 0 }).success).toBe(false);
    expect(constructionLayerCreateSchema.safeParse({ ...base, layerOrder: 1.5 }).success).toBe(false);
    expect(constructionLayerCreateSchema.safeParse({ ...base, layerType: "FINISH_LAYER" }).success).toBe(false);
    expect(constructionLayerCreateSchema.safeParse({ ...base, layerType: "BASE_LAYER" }).success).toBe(true);
  });

  it("thickness 必须为正数（毫米），materialId 必须为 UUID", () => {
    expect(constructionLayerCreateSchema.safeParse({ ...base, thickness: 30 }).success).toBe(true);
    expect(constructionLayerCreateSchema.safeParse({ ...base, thickness: 0 }).success).toBe(false);
    expect(constructionLayerCreateSchema.safeParse({ ...base, materialId: "mat-1" }).success).toBe(false);
    expect(constructionLayerCreateSchema.safeParse({ ...base, materialId: UUID }).success).toBe(true);
  });
});

describe("产品选项 schema", () => {
  it("min/max 厚度必须为正数，defaultThickness 可空", () => {
    const base = { productSpecId: UUID, minThickness: 10, maxThickness: 30 };
    expect(schemeProductOptionCreateSchema.safeParse(base).success).toBe(true);
    expect(schemeProductOptionCreateSchema.safeParse({ ...base, minThickness: 0 }).success).toBe(false);
    expect(schemeProductOptionCreateSchema.safeParse({ ...base, defaultThickness: -1 }).success).toBe(false);
    expect(schemeProductOptionCreateSchema.safeParse({ ...base, defaultThickness: 20 }).success).toBe(true);
  });
});

describe("方案文档 schema", () => {
  it("targetType 仅允许 SYSTEM/SCHEME，targetId 必须为 UUID", () => {
    expect(schemeDocumentCreateSchema.safeParse({ targetType: "SCHEME", targetId: UUID }).success).toBe(true);
    expect(schemeDocumentCreateSchema.safeParse({ targetType: "FILE", targetId: UUID }).success).toBe(false);
    expect(schemeDocumentCreateSchema.safeParse({ targetType: "SYSTEM", targetId: "bad" }).success).toBe(false);
  });
});

describe("日期输入", () => {
  it("effectiveAt 接受 ISO 字符串并转为 Date", () => {
    const parsed = constructionSchemeCreateSchema.safeParse({
      systemId: UUID, schemeCode: "A1-1", name: "A1-1", substrateMaterial: "钢筋混凝土",
      effectiveAt: "2025-01-01T00:00:00.000Z"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.effectiveAt).toBeInstanceOf(Date);
  });

  it("非法日期字符串被拒绝", () => {
    expect(constructionSchemeCreateSchema.safeParse({
      systemId: UUID, schemeCode: "A1-1", name: "A1-1", substrateMaterial: "钢筋混凝土",
      effectiveAt: "not-a-date"
    }).success).toBe(false);
  });
});

describe("工作流请求体 schema", () => {
  it("reject 的驳回原因必填且非空", () => {
    expect(rejectBodySchema.safeParse({}).success).toBe(false);
    expect(rejectBodySchema.safeParse({ rejectReason: "" }).success).toBe(false);
    expect(rejectBodySchema.safeParse({ rejectReason: "构造层证据页码缺失" }).success).toBe(true);
  });

  it("approve 意见与新版本说明可选", () => {
    expect(approveBodySchema.safeParse({}).success).toBe(true);
    expect(approveBodySchema.safeParse({ approvalNote: "同意" }).success).toBe(true);
    expect(newVersionBodySchema.safeParse({}).success).toBe(true);
    expect(newVersionBodySchema.safeParse({ changeNote: "v2 参数修订" }).success).toBe(true);
  });
});