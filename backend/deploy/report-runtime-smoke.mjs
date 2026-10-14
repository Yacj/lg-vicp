// 仅验证本地Chromium/字体/PDF，不加载app/config/env，不连接DB/Redis/OSS。
import { writeFile } from "node:fs/promises";
import { renderReportPdf } from "../dist/workers/report-pdf.js";
try {
  const { pdf } = await renderReportPdf('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>蓝格智配 · 部署自检</h1><p>中文字体与PDF输出测试，非客户报告。</p></body></html>',
    { executablePath: process.argv[2], checkChineseFonts: true, headerText: "报告运行环境检查", footerText: "本地自检，无业务数据" });
  if (pdf.length < 1000 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("INVALID_PDF");
  if (process.argv[3]) await writeFile(process.argv[3], pdf);
  console.log(JSON.stringify({ code: "REPORT_RUNTIME_READY", pdfBytes: pdf.length }));
} catch (error) {
  console.error(JSON.stringify({ code: error && typeof error === "object" && "code" in error ? error.code : "REPORT_RUNTIME_SMOKE_FAILED" }));
  process.exitCode = 1;
}
