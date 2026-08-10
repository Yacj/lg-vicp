import ExcelJS from "exceljs";
import type { DbExecutor } from "../../db/client.js";
import { and, eq } from "drizzle-orm";
import { productSpecs, schemeProductOptions } from "../../db/schema.js";
import { publishedReferenceConditions, effectiveRangeConditions } from "../construction/construction-structure.service.js";
import { listPublishedConstructionSchemes } from "../construction/construction-read.service.js";

/**
 * 图集热工参考选用表 Excel 解析与匹配（纯函数 + 注入 published 查询）。
 * - 表头第 1 行、数据第 2 行起，8 列精确匹配（列名别名不猜）。
 * - 匹配规则全部走已发布取数服务，禁止读取草稿/已停用数据：
 *   构造编号 -> 已发布生效方案（schemeCode）；产品规格 -> 方案产品选项集合内 specCode 精确匹配；
 *   厚度必须落在该规格选项 [minThickness, maxThickness] 区间。
 * - 原始值 raw* 列 = cell.text 原样保存，标准化数值 = 去单位 parseFloat 且 > 0（禁止 AI/OCR 改写后直接发布）。
 * - 错误行绝不静默：分类落 thermal_import_errors，apply 时默认拒绝（显式 ignoreErrors 才跳过）。
 */

export const IMPORT_TEMPLATE_VERSION = 1;
export const THERMAL_TEMPLATE_SHEET = "图集选用表";
export const THERMAL_TEMPLATE_HEADERS = [
  "构造编号", "产品规格", "厚度", "产品层热阻", "总热阻", "K值", "来源文档", "页码"
] as const;

export type ThermalImportErrorType =
  | "UNKNOWN_SCHEME"      // 构造编号未匹配到已发布生效方案
  | "UNKNOWN_SPEC"        // 产品规格不在该方案已发布产品选项中
  | "OUT_OF_RANGE"        // 厚度不在该规格允许区间
  | "PARSE_ERROR"         // 数值解析失败（非正数/非数字）
  | "MISSING_EVIDENCE"    // 来源文档/页码为空
  | "DUPLICATE_IN_FILE";  // 文件内重复键（构造+规格+厚度）

export interface ImportRowError {
  sheetName?: string;
  /** Excel 行号（表头为 1，数据从 2 起；表头级错误为 0） */
  rowNumber: number;
  rawRow: Record<string, unknown>;
  errorType: ThermalImportErrorType;
  message: string;
}

export interface MatchedThermalRow {
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
}

/** 匹配依赖（注入点，测试用桩替换；生产实现只走已发布取数） */
export interface ThermalImportDeps {
  /** 按构造编号取已发布生效方案；无则 null */
  resolveScheme: (schemeCode: string) => Promise<{ id: string } | null>;
  /** 方案下按规格编码取已发布生效产品选项（含厚度区间）；无则 null */
  resolveOption: (schemeId: string, specCode: string) => Promise<{
    productSpecId: string;
    minThickness: number;
    maxThickness: number;
  } | null>;
}

/** 生产依赖：已发布取数 + 进程内缓存（同一次解析内同键只查一次库） */
export function createDefaultThermalImportDeps(db: DbExecutor): ThermalImportDeps {
  const schemeCache = new Map<string, { id: string } | null>();
  const optionCache = new Map<string, { productSpecId: string; minThickness: number; maxThickness: number } | null>();
  return {
    async resolveScheme(schemeCode: string) {
      const cached = schemeCache.get(schemeCode);
      if (cached !== undefined) return cached;
      // published 互斥：同键只存在一个 PUBLISHED 生效版本，取最新
      const [scheme] = await listPublishedConstructionSchemes(db, { schemeCode });
      const result = scheme ? { id: scheme.id } : null;
      schemeCache.set(schemeCode, result);
      return result;
    },
    async resolveOption(schemeId: string, specCode: string) {
      const cacheKey = `${schemeId}|${specCode}`;
      const cached = optionCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const [spec] = await db.select({ id: productSpecs.id }).from(productSpecs)
        .where(and(eq(productSpecs.specCode, specCode), ...publishedReferenceConditions(productSpecs)))
        .limit(1);
      if (!spec) {
        optionCache.set(cacheKey, null);
        return null;
      }
      const [option] = await db.select({
        productSpecId: schemeProductOptions.productSpecId,
        minThickness: schemeProductOptions.minThickness,
        maxThickness: schemeProductOptions.maxThickness
      }).from(schemeProductOptions)
        .where(and(
          eq(schemeProductOptions.schemeId, schemeId),
          eq(schemeProductOptions.productSpecId, spec.id),
          // 产品选项无审核状态列（随方案状态），仅按生效区间过滤
          ...effectiveRangeConditions(schemeProductOptions)
        )).limit(1);
      const result = option ?? null;
      optionCache.set(cacheKey, result);
      return result;
    }
  };
}

/** 数值标准化：去单位解析为正数（"20"、"20mm"、"0.35" 均可）；非数字或 ≤0 返回 null */
export function parsePositiveNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface ThermalParseResult {
  rows: MatchedThermalRow[];
  errors: ImportRowError[];
}

/** 解析工作簿：遍历全部工作表，表头精确匹配（不猜列名），错误行分类收集，重复键仅保留首行 */
export async function parseThermalWorkbook(buffer: Buffer, deps: ThermalImportDeps): Promise<ThermalParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const rows: MatchedThermalRow[] = [];
  const errors: ImportRowError[] = [];
  const seenKeys = new Set<string>();

  for (const worksheet of workbook.worksheets) {
    if (!worksheet || worksheet.rowCount < 1) continue;
    // 说明性工作表（模板自带"填写说明"，用户亦可附加注释页）不参与解析
    if (worksheet.name.includes("说明")) continue;
    const headerCells = worksheet.getRow(1);
    const headerValues = Array.from({ length: THERMAL_TEMPLATE_HEADERS.length }, (_, i) =>
      headerCells.getCell(i + 1).text.trim()
    );
    const headerOk = headerValues.every((value, i) => value === THERMAL_TEMPLATE_HEADERS[i]);
    if (!headerOk) {
      errors.push({
        sheetName: worksheet.name,
        rowNumber: 0,
        rawRow: { headers: headerValues },
        errorType: "PARSE_ERROR",
        message: `工作表「${worksheet.name}」表头与模板不一致（期望：${THERMAL_TEMPLATE_HEADERS.join(" | ")}），已跳过该表`
      });
      continue;
    }

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const cells = Array.from({ length: THERMAL_TEMPLATE_HEADERS.length }, (_, i) => row.getCell(i + 1).text.trim());
      const rawRow: Record<string, unknown> = Object.fromEntries(
        THERMAL_TEMPLATE_HEADERS.map((header, i) => [header, cells[i]])
      );
      // 完全空行跳过
      if (cells.every((cell) => cell === "")) continue;

      const [schemeCode, specCode, rawThickness, rawProductResistance, rawTotalResistance, rawKValue, evidenceSource, evidenceRef] = cells as [
        string, string, string, string, string, string, string, string
      ];
      const fail = (errorType: ThermalImportErrorType, message: string) => {
        errors.push({ sheetName: worksheet.name, rowNumber, rawRow, errorType, message });
      };

      if (!evidenceSource || !evidenceRef) {
        fail("MISSING_EVIDENCE", `第 ${rowNumber} 行来源文档或页码为空`);
        continue;
      }
      const thickness = parsePositiveNumber(rawThickness);
      if (thickness === null) {
        fail("PARSE_ERROR", `第 ${rowNumber} 行厚度「${rawThickness}」不是正数`);
        continue;
      }
      const productResistance = parsePositiveNumber(rawProductResistance);
      if (productResistance === null) {
        fail("PARSE_ERROR", `第 ${rowNumber} 行产品层热阻「${rawProductResistance}」不是正数`);
        continue;
      }
      const totalResistance = parsePositiveNumber(rawTotalResistance);
      if (totalResistance === null) {
        fail("PARSE_ERROR", `第 ${rowNumber} 行总热阻「${rawTotalResistance}」不是正数`);
        continue;
      }
      const kValue = parsePositiveNumber(rawKValue);
      if (kValue === null) {
        fail("PARSE_ERROR", `第 ${rowNumber} 行 K 值「${rawKValue}」不是正数`);
        continue;
      }

      const scheme = await deps.resolveScheme(schemeCode);
      if (!scheme) {
        fail("UNKNOWN_SCHEME", `第 ${rowNumber} 行构造编号「${schemeCode}」未匹配到已发布且生效中的构造方案`);
        continue;
      }
      const option = await deps.resolveOption(scheme.id, specCode);
      if (!option) {
        fail("UNKNOWN_SPEC", `第 ${rowNumber} 行产品规格「${specCode}」不在方案「${schemeCode}」已发布产品选项中`);
        continue;
      }
      if (thickness < option.minThickness || thickness > option.maxThickness) {
        fail("OUT_OF_RANGE", `第 ${rowNumber} 行厚度 ${thickness}mm 超出方案「${schemeCode}」规格「${specCode}」允许区间 [${option.minThickness}, ${option.maxThickness}]mm`);
        continue;
      }

      const key = `${scheme.id}|${option.productSpecId}|${thickness}`;
      if (seenKeys.has(key)) {
        fail("DUPLICATE_IN_FILE", `第 ${rowNumber} 行与文件内已有行重复（构造 ${schemeCode} + 规格 ${specCode} + 厚度 ${thickness}mm），仅保留首行`);
        continue;
      }
      seenKeys.add(key);
      rows.push({
        schemeId: scheme.id,
        productSpecId: option.productSpecId,
        thicknessMm: thickness,
        productThermalResistance: productResistance,
        totalThermalResistance: totalResistance,
        kValue,
        rawThickness,
        rawProductResistance,
        rawTotalResistance,
        rawKValue,
        evidenceSource,
        evidenceRef
      });
    }
  }
  return { rows, errors };
}

/** 导入模板：图集选用表（8 列表头）+ 填写说明（构造编号=方案编码、规格=规格编码、数值可带单位、来源/页码必填） */
export function buildThermalTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(THERMAL_TEMPLATE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = THERMAL_TEMPLATE_HEADERS.map((header) => ({ header, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  const guide = workbook.addWorksheet("填写说明");
  guide.columns = [{ width: 24 }, { width: 80 }];
  const notes: Array<[string, string]> = [
    ["构造编号", "图集构造编号，如 A1-1，必须与已发布的构造方案编码一致"],
    ["产品规格", "产品规格编码，必须在对应方案的产品选项内"],
    ["厚度", "保温层厚度（mm），可带单位如 20mm；须落在方案规格允许区间"],
    ["产品层热阻", "产品层热阻（m²·K/W），正数"],
    ["总热阻", "构造总热阻（m²·K/W），正数"],
    ["K值", "传热系数 K（W/m²·K），正数"],
    ["来源文档", "图集名称/文件，必填，与知识库文档一致"],
    ["页码", "图集页码或表格编号，必填"],
    ["", ""],
    ["注意", "表头不可修改、不可增删列；同一构造+规格+厚度在文件内只能出现一次；错误行导入时默认拒绝，需显式确认忽略"]
  ];
  notes.forEach(([name, desc], index) => {
    const row = guide.getRow(index + 1);
    row.getCell(1).value = name;
    row.getCell(2).value = desc;
  });
  return workbook;
}