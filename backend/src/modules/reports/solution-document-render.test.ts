import "dotenv/config";
import { expect, it } from "vitest";
import { renderTemplateHtml, type ReportSnapshotPayload } from "./report-template-render.js";
import { toSolutionDocumentModel } from "../ai/solution-document-model.js";
import { confirmedSolutionFixture } from "../ai/solution-report.fixture.js";
import { solutionAdviceFixture } from "../ai/solution-advice.fixture.js";
import { DEFAULT_REPORT_SECTIONS } from "./report-template.service.js";
const payload = (): ReportSnapshotPayload => {
  const model = toSolutionDocumentModel(confirmedSolutionFixture());
  return { title: "正式方案Fixture", reportType: "technical_scheme", generatedAt: "2026-10-14T00:00:00Z", template: { sections: DEFAULT_REPORT_SECTIONS }, documentModel: model, referencePages: model.referencePages };
};
it("中文工程章节、单位、独立项目、缺标准未核验；不打印原始对象合同", () => {
  const html = renderTemplateHtml(payload());
  for (const value of ["最终", "产品层热阻 R", "总热阻 R₀", "W/(m²·K)", "(m²·K)/W", "产品厚度 mm", "混凝土", "0.1245", "7.5", "8.03", "未进行地区/项目合规性核验", "独立已确认方案"])
    expect(html).toContain(value);
  expect(html).not.toContain("<th>candidateId</th>"); expect(html).not.toContain("符合规范"); expect(html).not.toContain("备选方案对比");
});
it("A3-1/2/3/4的45mm事实逐候选同源，不跨基层拼接；同页档位仅按optionId高亮", () => {
  const snapshot = confirmedSolutionFixture(); const { rows } = solutionAdviceFixture();
  const candidates = rows.flatMap(row => row.model.constructions.map((construction, index) => {
    const option = construction.options[0]!;
    return { ...snapshot.payload.candidates[0]!, id: option.optionId, candidateId: option.optionId, optionId: option.optionId,
      constructionCode: construction.constructionCode!, schemeId: `${row.page.id}-${index}`, substrateMaterial: construction.baseMaterial!,
      substrateThickness: construction.baseThicknessMm, ...option, sourcePageId: row.page.id, sourcePageLabel: row.page.pageLabel };
  }));
  snapshot.payload.candidates = candidates; snapshot.payload.finalCandidateIds = candidates.map(c => c.candidateId); snapshot.payload.selectedCandidateIds = [...snapshot.payload.finalCandidateIds];
  snapshot.payload.referencePages = rows.map(row => ({ sourcePageId: row.page.id, documentTitle: row.document.title, pageLabel: row.page.pageLabel,
    physicalPageNumber: row.page.physicalPageNumber, renderModel: row.model }));
  const model = toSolutionDocumentModel(snapshot); const html = renderTemplateHtml({ ...payload(), documentModel: model, referencePages: model.referencePages });
  const tables = html.match(/<table>.*?<\/table>/gs)!; const final = tables[0]!;
  for (const candidate of candidates) {
    const row = final.split("<tr>").find(r => r.includes(candidate.constructionCode!))!;
    expect(row).toContain(candidate.substrateMaterial!); expect(row).toContain(String(candidate.totalThermalResistance)); expect(row).toContain(String(candidate.kValue));
  }
  expect(html.match(/class="final-option"/g)).toHaveLength(4);
});
it("图不可取时仍输出冻结完整原表；印刷页与物理页各自标识，不替换其他页", () => {
  const snapshot = confirmedSolutionFixture(); const render = snapshot.payload.referencePages[0]!.renderModel as any;
  render.notes = ["原页适用条件<保留>"]; render.warnings = ["λ口径待复核"];
  const model = toSolutionDocumentModel(snapshot);
  const html = renderTemplateHtml({ ...payload(), documentModel: model, referencePages: model.referencePages });
  expect(html).toContain("来源图不可用"); expect(html).toContain("印刷页：A3"); expect(html).toContain("物理页：7");
  expect(html).toContain("最终采用</td>"); expect(html).not.toContain("<img");
  expect(html).toContain("原页适用条件&lt;保留&gt;"); expect(model.warnings).toContain("原页警告（测试图集（Fixture））：λ口径待复核");
  model.referencePages[0]!.pageLabel = null; model.solutions[0]!.sourcePageLabel = "7";
  const unknownPrint = renderTemplateHtml({ ...payload(), documentModel: model, referencePages: model.referencePages });
  expect(unknownPrint).toContain("印刷页 未提供"); expect(unknownPrint).not.toContain("印刷页 7"); expect(unknownPrint).toContain("物理页：7");
});
it("有项目/备选明确分组，备选不会成为最终采用", () => {
  const p = payload(); const model = p.documentModel as ReturnType<typeof toSolutionDocumentModel>;
  model.project = { name: "测试住宅" }; model.alternatives = [{ ...model.solutions[0]!, id: "alternative", candidateId: "alternative", optionId: "another", constructionCode: "A3-2", kValue: .3 }];
  const html = renderTemplateHtml(p); expect(html).toContain("测试住宅"); expect(html).toContain("备选方案对比（未作为最终采用方案）");
  expect(html.match(/class="final-option"/g)).toHaveLength(1);
});
it("标题、基层、来源文案安全转义，外网图片及SVG被拒绝", () => {
  const p = payload(); p.title = "<script>alert(1)</script>";
  const model = p.documentModel as ReturnType<typeof toSolutionDocumentModel>; model.solutions[0]!.substrateMaterial = "<img src=x onerror=alert(1)>";
  model.referencePages[0]!.imageDataUrl = "https://untrusted.example/image.png?token=secret";
  let html = renderTemplateHtml(p); expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("https://untrusted");
  model.referencePages[0]!.imageDataUrl = "data:image/svg+xml;base64,PHN2Zz4=";
  html = renderTemplateHtml(p); expect(html).not.toContain("data:image/svg"); expect(html).toContain("default-src 'none'");
});
it.each(["empty", "final", "facts"])("无Final或必要工程事实不能渲染正式报告：%s", kind => {
  const p = payload(); const model = p.documentModel as ReturnType<typeof toSolutionDocumentModel>;
  if (kind === "empty") model.solutions = []; if (kind === "final") model.finalCandidateIds = []; if (kind === "facts") model.solutions[0]!.kValue = undefined;
  expect(() => renderTemplateHtml(p)).toThrow();
});
it("计算样例清楚标注引擎来源及缺少客户图集，禁止冒称正式图集参考方案", () => {
  const snapshot = confirmedSolutionFixture(); const c = snapshot.payload.candidates[0]!;
  Object.assign(c, { sourceType: "CALCULATED", constructionCode: "VICP-SHEET-1", sourcePageId: undefined, calculationId: "calculation", calcMode: "LAYERED" });
  snapshot.payload.referencePages = [];
  const model = toSolutionDocumentModel(snapshot); const html = renderTemplateHtml({ ...payload(), documentModel: model, referencePages: [] });
  expect(html).toContain("确定性引擎计算值"); expect(html).toContain("VICP-SHEET-1 为测试计算样例"); expect(html).toContain("缺少可追溯客户图集原页");
});
it("报告追溯标识与DocumentModel必须一致", () => {
  expect(() => renderTemplateHtml({ ...payload(), solutionSnapshotId: "other-confirmation" })).toThrow("确认标识不一致");
});
it("新PDF策略不能用历史字段兼容绕过Final，既有V1报告可按原Final合同读取", () => {
  const p = payload(); const model = p.documentModel as any;
  delete model.finalCandidateIds; p.solutionSnapshotId = model.solutionSnapshotId;
  expect(renderTemplateHtml(p)).toContain("0.1245");
  expect(() => renderTemplateHtml({ ...p, outputPolicy: "SOLUTION_PDF_V1" })).toThrow("最终方案");
});
it("报告设置控制封面、来源附录与免责声明，基本引用、指标及风险不可关闭", () => {
  const p = payload(); p.settings = { coverTitle: "企业方案<封面>", showSourceReferences: false, showDisclaimer: false,
    disclaimerText: "自定义免责声明", footerText: "企业页脚" };
  p.branding = { companyName: "企业<名称>", logoDataUrl: "data:image/png;base64,aW1n" };
  let html = renderTemplateHtml(p);
  expect(html).toContain("企业方案&lt;封面&gt;"); expect(html).toContain("企业&lt;名称&gt;"); expect(html).toContain('alt="企业Logo"');
  expect(html).not.toContain('class="source-page"'); expect(html).toContain("资料编号 TEST-ATLAS");
  expect(html).toContain("0.1245"); expect(html).toContain("未进行地区/项目合规性核验"); expect(html).toContain("风险与限制");
  expect(html).not.toContain("自定义免责声明"); expect(html).toContain("企业页脚");
  p.settings.showDisclaimer = true; html = renderTemplateHtml(p);
  expect(html).toContain("自定义免责声明"); expect(html).not.toContain("免责声明正式措辞待甲方确认");
  p.branding.logoDataUrl = "https://untrusted.example/logo.svg"; expect(renderTemplateHtml(p)).not.toContain("https://untrusted");
});
it("计算开关仅影响冻结步骤，简报不含过程；缺失层厚度不填0、不采用旧合规判定", () => {
  const p = payload(); const model = p.documentModel as ReturnType<typeof toSolutionDocumentModel>;
  Object.assign(model.solutions[0]!, { sourceType: "CALCULATED", calcMode: "LAYERED", calculationId: "calc", resultSnapshot: { compliant: true },
    provenanceSnapshot: { steps: [{ key: "total_resistance", label: "冻结步骤", formula: "R₀=ΣR", value: 8.03 }, { key: "judgment", label: "合格判定：合格", value: 1 }],
      layers: [{ layerName: "冻结层", lambda: .02 }] } });
  p.settings = { showCalculationProcess: true };
  let html = renderTemplateHtml(p); expect(html).toContain("冻结步骤"); expect(html).toContain("冻结层</td><td>未提供");
  expect(html).not.toContain("合格判定"); expect(html).not.toContain("符合规范");
  p.settings.showCalculationProcess = false; html = renderTemplateHtml(p);
  expect(html).not.toContain("冻结步骤"); expect(html).toContain("确定性引擎计算值"); expect(html).toContain("8.03");
  p.settings.showCalculationProcess = true; p.reportType = "project_brief"; expect(renderTemplateHtml(p)).not.toContain("冻结步骤");
});
