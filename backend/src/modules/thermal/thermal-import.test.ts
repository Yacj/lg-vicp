import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildThermalTemplateWorkbook,
  parsePositiveNumber,
  parseThermalWorkbook,
  THERMAL_TEMPLATE_HEADERS,
  type ThermalImportDeps
} from "./thermal-import.service.js";

/** 内存构建导入工作簿（第 1 行表头，第 2 行起数据） */
async function makeWorkbookBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("图集选用表");
  sheet.addRow(THERMAL_TEMPLATE_HEADERS as unknown as string[]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 匹配桩：A1-1 -> scheme-1；XPS-50 -> 区间 [10, 50] */
const deps: ThermalImportDeps = {
  resolveScheme: async (code: string) => (code === "A1-1" ? { id: "scheme-1" } : null),
  resolveOption: async (_schemeId: string, specCode: string) =>
    specCode === "XPS-50" ? { productSpecId: "spec-1", minThickness: 10, maxThickness: 50 } : null
};

const validRow = ["A1-1", "XPS-50", "20mm", "2.31", "3.15", "0.35", "图集 X 节能计算表", "P12"];

describe("parsePositiveNumber 数值标准化", () => {
  it("去单位解析正数", () => {
    expect(parsePositiveNumber("20")).toBe(20);
    expect(parsePositiveNumber("20mm")).toBe(20);
    expect(parsePositiveNumber("0.35")).toBe(0.35);
  });
  it("空/非数字/非正数返回 null", () => {
    expect(parsePositiveNumber("")).toBeNull();
    expect(parsePositiveNumber("abc")).toBeNull();
    expect(parsePositiveNumber("0")).toBeNull();
    expect(parsePositiveNumber("-5")).toBeNull();
  });
});

describe("parseThermalWorkbook 解析与匹配", () => {
  it("有效行：raw 原样保存、标准化数值、evidence 落库", async () => {
    const buffer = await makeWorkbookBuffer([validRow]);
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schemeId: "scheme-1",
      productSpecId: "spec-1",
      thicknessMm: 20,
      productThermalResistance: 2.31,
      totalThermalResistance: 3.15,
      kValue: 0.35,
      rawThickness: "20mm",
      rawProductResistance: "2.31",
      evidenceSource: "图集 X 节能计算表",
      evidenceRef: "P12"
    });
  });

  it("表头不一致：整表跳过并记 PARSE_ERROR（rowNumber 0）", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("错误表头").addRow(["构造", "规格", "厚度"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ rowNumber: 0, errorType: "PARSE_ERROR" });
  });

  it("错误分类：UNKNOWN_SCHEME / UNKNOWN_SPEC / OUT_OF_RANGE", async () => {
    const buffer = await makeWorkbookBuffer([
      ["B2-1", "XPS-50", "20", "2.31", "3.15", "0.35", "图集 X", "P12"],
      ["A1-1", "XPS-999", "20", "2.31", "3.15", "0.35", "图集 X", "P12"],
      ["A1-1", "XPS-50", "60", "2.31", "3.15", "0.35", "图集 X", "P12"]
    ]);
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(rows).toEqual([]);
    expect(errors.map((error) => error.errorType)).toEqual(["UNKNOWN_SCHEME", "UNKNOWN_SPEC", "OUT_OF_RANGE"]);
    expect(errors[2]!.message).toContain("[10, 50]");
  });

  it("错误分类：PARSE_ERROR / MISSING_EVIDENCE", async () => {
    const buffer = await makeWorkbookBuffer([
      ["A1-1", "XPS-50", "abc", "2.31", "3.15", "0.35", "图集 X", "P12"],
      ["A1-1", "XPS-50", "20", "2.31", "3.15", "0.35", "", "P12"],
      ["A1-1", "XPS-50", "20", "2.31", "3.15", "0.35", "图集 X", ""]
    ]);
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(rows).toEqual([]);
    expect(errors.map((error) => error.errorType)).toEqual(["PARSE_ERROR", "MISSING_EVIDENCE", "MISSING_EVIDENCE"]);
  });

  it("文件内重复键：仅保留首行，后续行 DUPLICATE_IN_FILE", async () => {
    const buffer = await makeWorkbookBuffer([
      validRow,
      ["A1-1", "XPS-50", "20", "2.5", "3.2", "0.32", "图集 X", "P13"]
    ]);
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errorType).toBe("DUPLICATE_IN_FILE");
    expect(errors[0]!.message).toContain("仅保留首行");
  });

  it("空行跳过、完全空表不报错", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("图集选用表");
    sheet.addRow(THERMAL_TEMPLATE_HEADERS as unknown as string[]);
    sheet.addRow([]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("buildThermalTemplateWorkbook 模板", () => {
  it("模板可重新解析：表头匹配且无数据行错误", async () => {
    const workbook = buildThermalTemplateWorkbook();
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows, errors } = await parseThermalWorkbook(buffer, deps);
    expect(errors).toEqual([]);
    expect(rows).toEqual([]);
  });
});