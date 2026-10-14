import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import { confirmedSolutionFixture } from "../src/modules/ai/solution-report.fixture.js";
import { solutionAdviceFixture } from "../src/modules/ai/solution-advice.fixture.js";
import { toSolutionDocumentModel } from "../src/modules/ai/solution-document-model.js";
import { embedReportBranding, renderTemplateHtml, type ReportSnapshotPayload } from "../src/modules/reports/report-template-render.js";
import { createCanvas } from "@napi-rs/canvas";
import { DEFAULT_REPORT_SECTIONS } from "../src/modules/reports/report-template.service.js";
import { renderReportPdf } from "../src/workers/report-pdf.js";

// 只写本地Fixture产物；不连接DB/Redis/OSS，不代表真实确认业务UAT。
const args = process.argv.slice(2);
const argument = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const executablePath = argument("--chromium") ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const output = path.resolve(argument("--output") ?? "output/pdf/solution-fixture");
const snapshot = confirmedSolutionFixture();
const { rows } = solutionAdviceFixture();
snapshot.payload.candidates = rows.flatMap(row => row.model.constructions.map((construction, index) => {
  const option = construction.options[0]!;
  return { ...snapshot.payload.candidates[0]!, id: option.optionId, candidateId: option.optionId, optionId: option.optionId,
    constructionCode: construction.constructionCode!, schemeId: `${row.page.id}-${index}`, substrateMaterial: construction.baseMaterial!,
    substrateThickness: construction.baseThicknessMm, ...option, sourcePageId: row.page.id, sourcePageLabel: row.page.pageLabel };
}));
snapshot.payload.finalCandidateIds = snapshot.payload.candidates.map(c => c.candidateId);
snapshot.payload.selectedCandidateIds = [...snapshot.payload.finalCandidateIds];
snapshot.payload.referencePages = rows.map(row => ({ sourcePageId: row.page.id, documentTitle: "Fixture测试图集（非客户报告）",
  docNumber: "FIXTURE-ATLAS", pageLabel: row.page.pageLabel, physicalPageNumber: row.page.physicalPageNumber, renderModel: row.model }));
// 多档长表仅测试分页；不把这些档位作为Final，也不写业务数据。
const source = snapshot.payload.referencePages[0]!.renderModel as typeof rows[0]["model"];
source.constructions.push({ ...source.constructions[0]!, constructionId: "long-table", constructionCode: "分页测试构造",
  options: Array.from({ length: 65 }, (_, i) => ({ ...source.constructions[0]!.options[0]!, optionId: `fixture-unselected-${i}` })) });
const model = toSolutionDocumentModel(snapshot);
const settingsDemo = args.includes("--settings-demo");
const compact = settingsDemo && args.includes("--compact");
const payload: ReportSnapshotPayload = { title: "正式方案 PDF · Fixture 渲染验证（非业务验收）", reportType: "technical_scheme",
  generatedAt: "2026-10-14T00:00:00Z", template: { sections: DEFAULT_REPORT_SECTIONS }, documentModel: model, referencePages: model.referencePages };
if (settingsDemo) {
  const canvas = createCanvas(420, 100); const context = canvas.getContext("2d");
  context.fillStyle = "#176b57"; context.fillRect(0, 0, 420, 100); context.fillStyle = "white";
  context.font = "bold 38px sans-serif"; context.fillText("FIXTURE BRAND", 22, 65);
  payload.branding = { companyName: "Fixture示例企业（非客户）", companyLogoFileId: "fixture-logo",
    logo: { fileId: "fixture-logo", objectKey: "fixture/logo.png", mimeType: "image/png" } };
  await embedReportBranding(payload, async () => canvas.toBuffer("image/png"));
  payload.settings = { coverTitle: compact ? "Fixture企业方案 · 简版" : "Fixture企业方案 · 完整版", headerText: "Fixture示例企业 · 技术方案",
    footerText: "仅用于报告设置渲染验证 · 非客户正式报告", showCalculationProcess: !compact, showSourceReferences: !compact,
    showDisclaimer: !compact, disclaimerText: "Fixture自定义免责声明：本文件仅验证报告设置与版式。" };
}
const html = renderTemplateHtml(payload);
try {
  console.log(JSON.stringify({ kind: "FIXTURE_ONLY", stage: "RENDER_BEGIN" }));
  const { pdf } = await renderReportPdf(html, { executablePath, checkChineseFonts: true, headerText: payload.settings?.headerText,
    footerText: payload.settings?.footerText, onStage: stage => console.log(JSON.stringify({ kind: "FIXTURE_ONLY", stage })) });
  const extracted = await extractText(new Uint8Array(pdf), { mergePages: true });
  assert.ok(extracted.totalPages >= (compact ? 2 : 4), "测试应生成多页PDF");
  for (const c of model.solutions) for (const fact of [c.constructionCode, c.substrateMaterial, String(c.kValue), String(c.totalThermalResistance)])
    assert.ok(extracted.text.includes(fact!), `PDF缺少冻结事实：${fact}`);
  assert.ok(extracted.text.includes("未进行地区/项目合规性核验"));
  if (!compact) assert.ok(extracted.text.includes("来源图不可用"));
  assert.ok(extracted.text.includes(model.solutionSnapshotId));
  assert.equal(extracted.text.includes("分页测试构造"), !compact);
  if (settingsDemo) {
    assert.ok(html.includes('alt="企业Logo"')); assert.ok(extracted.text.includes("Fixture示例企业"));
    assert.ok(extracted.text.includes(payload.settings!.coverTitle!)); assert.ok(extracted.text.includes("非客户正式报告"));
    assert.equal(extracted.text.includes("Fixture自定义免责声明"), !compact);
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "solution-fixture.html"), html);
  await writeFile(path.join(output, "solution-fixture.pdf"), pdf);
  await writeFile(path.join(output, "verification.json"), JSON.stringify({ kind: "FIXTURE_ONLY", totalPages: extracted.totalPages,
    checkedCandidates: model.solutions.length, pdfBytes: pdf.byteLength, businessUat: "NOT_EXECUTED", workerQueue: "NOT_EXECUTED", oss: "NOT_EXECUTED" }, null, 2));
  console.log(JSON.stringify({ result: "FIXTURE_PDF_PASS", totalPages: extracted.totalPages, checkedCandidates: model.solutions.length, output }));
} catch (error) {
  console.error(JSON.stringify({ result: "FIXTURE_PDF_FAILED", code: error && typeof error === "object" && "code" in error ? error.code : "FIXTURE_ASSERTION_FAILED",
    message: error instanceof assert.AssertionError ? error.message : "PDF渲染检查失败，未完成验收。" }));
  process.exitCode = 1;
}
