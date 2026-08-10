#!/usr/bin/env node
// ============================================================
// 生成图集热工参考选用表导入模板（xlsx）
//
// - 工作表 1「图集选用表」：8 列表头 + 空白数据行（冻结首行）；
// - 工作表 2「填写说明」：字段口径说明，导入解析时会跳过该页；
// - 生成后的模板供 Excel 填数后走导入作业流程
//   （POST /api/v1/platform/thermal/import-jobs -> 预签名直传 -> complete -> 解析）。
//
// 用法：pnpm thermal:template  （输出 ./thermal-import-template.xlsx）
// ============================================================
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ExcelJS from "exceljs";

const HEADERS = ["构造编号", "产品规格", "厚度", "产品层热阻", "总热阻", "K值", "来源文档", "页码"];

/** 与 thermal-import.service.ts buildThermalTemplateWorkbook 保持同口径的说明页文案 */
const GUIDE_NOTES = [
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

function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("图集选用表", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = HEADERS.map((header) => ({ header, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  const guide = workbook.addWorksheet("填写说明");
  guide.columns = [{ width: 24 }, { width: 80 }];
  GUIDE_NOTES.forEach(([name, desc], index) => {
    const row = guide.getRow(index + 1);
    row.getCell(1).value = name;
    row.getCell(2).value = desc;
  });
  return workbook;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "thermal-import-template.xlsx");

const workbook = await buildWorkbook();
await workbook.xlsx.writeFile(outPath);
console.log(`模板已生成：${outPath}`);