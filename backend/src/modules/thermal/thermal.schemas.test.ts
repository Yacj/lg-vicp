import { describe, expect, it } from "vitest";
import {
  thermalImportApplySchema,
  thermalImportJobCreateSchema,
  thermalRowCreateSchema,
  thermalSetCreateSchema,
  thermalSetUpdateSchema
} from "./thermal.schemas.js";

describe("thermalSetCreateSchema", () => {
  it("接受合法输入，日期字符串转 Date", () => {
    const result = thermalSetCreateSchema.parse({
      code: "ATLAS-2026",
      name: "图集 X 选用表",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null
    });
    expect(result.code).toBe("ATLAS-2026");
    expect(result.effectiveAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeNull();
  });

  it("拒绝空 code / 超长 evidenceSource", () => {
    expect(() => thermalSetCreateSchema.parse({ code: "  ", name: "x" })).toThrow();
    expect(() => thermalSetCreateSchema.parse({
      code: "A", name: "x", evidenceSource: "x".repeat(501)
    })).toThrow();
  });

  it("拒绝非法证据等级", () => {
    expect(() => thermalSetCreateSchema.parse({ code: "A", name: "x", evidenceLevel: "D" }))
      .toThrow();
  });

  it("update 支持部分字段", () => {
    const parsed = thermalSetUpdateSchema.parse({ name: "改名" });
    expect(parsed).toEqual({ name: "改名" });
  });
});

describe("thermalRowCreateSchema", () => {
  const base = {
    schemeId: "00000000-0000-4000-8000-000000000001",
    productSpecId: "00000000-0000-4000-8000-000000000002",
    thicknessMm: 20,
    productThermalResistance: 2.31,
    totalThermalResistance: 3.15,
    kValue: 0.35,
    rawThickness: "20mm",
    rawProductResistance: "2.31",
    rawTotalResistance: "3.15",
    rawKValue: "0.35",
    evidenceSource: "图集 X",
    evidenceRef: "P12"
  };

  it("接受合法输入，evidenceLevel 默认 A", () => {
    const result = thermalRowCreateSchema.parse(base);
    expect(result.evidenceLevel).toBe("A");
  });

  it("拒绝 0 / 负数厚度", () => {
    expect(() => thermalRowCreateSchema.parse({ ...base, thicknessMm: 0 })).toThrow();
    expect(() => thermalRowCreateSchema.parse({ ...base, kValue: -1 })).toThrow();
  });

  it("拒绝缺 raw 原值列（禁止 AI/OCR 改写后发布）", () => {
    const { rawThickness: _omit, ...missing } = base;
    void _omit;
    expect(() => thermalRowCreateSchema.parse(missing)).toThrow();
  });

  it("拒绝非法 uuid 引用", () => {
    expect(() => thermalRowCreateSchema.parse({ ...base, schemeId: "not-a-uuid" })).toThrow();
  });
});

describe("thermalImportJobCreateSchema", () => {
  const base = {
    setCode: "ATLAS-2026",
    fileName: "atlas.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 1024
  };

  it("接受合法输入（sha256 可选）", () => {
    expect(thermalImportJobCreateSchema.parse(base).sizeBytes).toBe(1024);
    expect(thermalImportJobCreateSchema.parse({
      ...base, sha256: "a".repeat(64)
    }).sha256).toBe("a".repeat(64));
  });

  it("拒绝非 xlsx MIME / 错误 sha256 长度", () => {
    expect(() => thermalImportJobCreateSchema.parse({ ...base, mimeType: "text/csv" })).toThrow();
    expect(() => thermalImportJobCreateSchema.parse({ ...base, sha256: "abc" })).toThrow();
  });
});

describe("thermalImportApplySchema", () => {
  it("ignoreErrors 默认 false", () => {
    expect(thermalImportApplySchema.parse({}).ignoreErrors).toBe(false);
    expect(thermalImportApplySchema.parse({ ignoreErrors: true }).ignoreErrors).toBe(true);
  });
});