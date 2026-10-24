import type { SolutionDocumentModel } from "../ai/solution-document-model.js";
import { solutionCandidateSchema } from "../ai/solution-workflow.js";
import type { KnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { ReportSnapshotPayload } from "./report-template-render.js";
import { escapeHtml } from "./report-template-render.js";
import { AppError } from "../../shared/errors.js";
import { buildThermalCalcPresentation } from "../thermal/thermal-calc-presentation.js";

const text = (value: unknown) => escapeHtml(value == null || value === "" ? "未提供" : String(value));
// 仅排版投影，避免二进制浮点长尾撑破表格；冻结事实与正式引擎取整均不改写。
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? text(Number(value.toPrecision(10))) : "未提供";
const section = (title: string, body: string, keepTogether = false) => `<section${keepTogether ? ' class="keep-together"' : ""}><h2>${text(title)}</h2>${body}</section>`;
const table = (headers: string[], rows: string[][]) => `<table><thead><tr>${headers.map(h => `<th>${text(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const list = (items: string[]) => `<ul>${items.map(item => `<li>${text(item)}</li>`).join("")}</ul>`;

/** 仅允许由对象存储字节生成的封闭data图片格式，不接受外网URL/SVG/HTML。 */
export function isEmbeddedReportImage(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
}

export function assertSolutionDocument(model: SolutionDocumentModel) {
  if (model.schemaVersion !== 1 || !model.solutionSnapshotId || !model.confirmedBy || !model.confirmedAt
    || !model.solutions?.length || !model.finalCandidateIds?.length
    || new Set(model.finalCandidateIds).size !== model.finalCandidateIds.length
    || model.finalCandidateIds.length !== model.solutions.length
    || model.finalCandidateIds.some(id => !model.solutions.some(c => c.candidateId === id))
    || model.alternatives.some(c => model.finalCandidateIds.includes(c.candidateId)))
    throw new AppError("SOLUTION_DOCUMENT_INVALID", "正式方案文档缺少有效确认标识或最终方案。", 400, { errorCode: "SOLUTION_DOCUMENT_INVALID" });
  for (const candidate of model.solutions) {
    const parsed = solutionCandidateSchema.safeParse(candidate);
    if (!parsed.success || !candidate.systemName || !candidate.constructionCode || !candidate.systemId || !candidate.schemeId || !candidate.productSpecId
      || ![candidate.thicknessMm, candidate.kValue, candidate.productThermalResistance, candidate.totalThermalResistance].every(v => typeof v === "number" && Number.isFinite(v) && v > 0))
      throw new AppError("SOLUTION_FACTS_INCOMPLETE", "最终方案冻结工程事实不完整，不能生成正式报告。", 400, { errorCode: "SOLUTION_FACTS_INCOMPLETE" });
  }
}

function solutionTable(model: SolutionDocumentModel, alternatives = false) {
  const candidates = alternatives ? model.alternatives : model.solutions;
  const layerInput = candidates.some(candidate => candidate.inputThicknessLayerName);
  return table(["体系 / 构造", "基层 / 基层厚度 mm", layerInput ? "产品 / 计算层厚度 mm" : "产品 / 产品厚度 mm", "热阻 R（口径见各行）\n(m²·K)/W", "总热阻 R₀\n(m²·K)/W", "K\nW/(m²·K)"], candidates.map(c => [
    `${text(c.systemName)}<br><strong>${text(c.constructionCode)}</strong>`, `${text(c.substrateMaterial)}<br>${number(c.substrateThickness)}`,
    `${text(c.productName ?? c.specCode ?? c.specClass)}${c.inputThicknessLayerName ? `<br>计算输入层：${text(c.inputThicknessLayerName)}` : ""}<br>${number(c.thicknessMm)}`,
    `${c.productThermalResistanceScope === "PRODUCT_LAYER_ROWS_ONLY" ? "仅产品层行；" : "产品层热阻 R；"}${number(c.productThermalResistance)}`, number(c.totalThermalResistance), number(c.kValue)
  ]));
}

/** 只投影确认快照已包含的步骤/分层，不运行热工引擎、不推导工程数值。 */
function calculationDetails(model: SolutionDocumentModel): string {
  return model.solutions.filter(c => c.sourceType === "CALCULATED").map(c => {
    if (c.calcMode === "REFERENCE_TABLE") return `<p>${text(c.constructionCode)}：已发布参考表取值，无需重复计算。</p>`;
    if (!["EQUIVALENT", "LAYERED"].includes(c.calcMode ?? ""))
      return `<p>${text(c.constructionCode)}：快照未包含可展示的计算过程。</p>`;
    const p = buildThermalCalcPresentation({ mode: c.calcMode!, result: c.resultSnapshot,
      steps: c.provenanceSnapshot?.steps, layers: c.provenanceSnapshot?.layers });
    // DocumentModel未带正式合规核验合同；既有计算器judgment步骤不能冒充报告合规结论。
    const engineeringSteps = p.steps.filter(step => step.key !== "judgment");
    const steps = engineeringSteps.length ? table(["计算步骤", "公式", "冻结结果", "单位"], engineeringSteps.map(step =>
      [text(step.label), text(step.formula), typeof step.value === "number" ? number(step.value) : text(step.value), text(step.unit)])) : "<p>快照未包含计算步骤。</p>";
    const frozenLayers = Array.isArray(c.provenanceSnapshot?.layers) ? c.provenanceSnapshot.layers : [];
    const layers = frozenLayers.length ? table(["构造层", "厚度 mm", "λ W/(m·K)", "修正系数"], frozenLayers.map(value => {
      const layer = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return [text(layer.layerName), number(typeof layer.thicknessM === "number" ? layer.thicknessM * 1000 : undefined),
        number(layer.lambda), number(layer.correctionFactor)];
    })) : "";
    return `<h3>${text(c.constructionCode)} · 冻结计算过程</h3>${steps}${layers}`;
  }).join("");
}

/** 冻结完整原表，逐页optionId绑定Final/备选；不按数值猜高亮。 */
export function renderFrozenReferenceTables(pages: unknown, model?: SolutionDocumentModel): string {
  if (!Array.isArray(pages)) return "";
  return pages.map(page => {
    const render = page.renderModel as KnowledgePageRenderModel | null;
    if (!render?.constructions?.length) return "";
    return render.constructions.map(construction => {
      const rows = construction.options.map(option => {
        const final = model?.solutions.some(c => c.sourcePageId === page.sourcePageId && c.optionId === option.optionId);
        const alternative = model?.alternatives.some(c => c.sourcePageId === page.sourcePageId && c.optionId === option.optionId);
        return `<tr${final ? ' class="final-option"' : ""}><td>${text(construction.constructionCode)}</td><td>${number(option.thicknessMm)}</td><td>${number(option.productThermalResistance)}</td><td>${number(option.totalThermalResistance)}</td><td>${number(option.kValue)}</td><td>${final ? "最终采用" : alternative ? "备选" : "原页其他档位"}</td></tr>`;
      }).join("");
      const layers = construction.layers?.length ? table(["构造层", "厚度 mm", "λ W/(m·K)", "修正系数 α", "层热阻 (m²·K)/W"], construction.layers.map(layer => [text(layer.name), number(layer.thicknessMm), number(layer.lambda), number(layer.alpha), number(layer.rValue)])) : "";
      return `<div class="construction"><h3>${text(construction.constructionCode)} · ${text(construction.systemName)}</h3><p>基层：${text(construction.baseMaterial)}；基层厚度：${number(construction.baseThicknessMm)} mm</p>${layers}<table><thead><tr><th>构造</th><th>产品厚度 mm</th><th>产品层热阻 R (m²·K)/W</th><th>总热阻 R₀ (m²·K)/W</th><th>K W/(m²·K)</th><th>引用身份</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join("") + (render.notes?.length ? `<h3>原页备注</h3>${list(render.notes)}` : "")
      + (render.warnings?.length ? `<div class="warning"><h3>原页警告</h3>${list(render.warnings)}</div>` : "");
  }).join("");
}

function sourceSections(model: SolutionDocumentModel, pages: unknown) {
  const frozenPages = Array.isArray(pages) ? pages : [];
  const citations = [...model.solutions, ...model.alternatives].map(c => {
    if (c.publishedReferenceSource) return `${text(c.constructionCode)}：${text(c.publishedReferenceSource.source)}，${text(c.publishedReferenceSource.reference)}；参考集版本 ${number(c.publishedReferenceSource.setVersion)}、构造版本 ${number(c.publishedReferenceSource.schemeVersion)}、规格版本 ${number(c.publishedReferenceSource.specVersion)}。未关联原文件或图页。`;
    if (c.sourceType === "CALCULATED") {
      const rule = c.provenanceSnapshot?.rule as Record<string, unknown> | undefined;
      const parameters = Array.isArray(c.provenanceSnapshot?.parameters) ? c.provenanceSnapshot.parameters : [];
      const sources = [...new Set(parameters.flatMap(value => value && typeof value === "object" && "evidenceSource" in value
        ? [`${text(value.evidenceSource)} · ${text("evidenceRef" in value ? value.evidenceRef : null)}`] : []))];
      return `${text(c.constructionCode)}：正式计算记录 ${text(c.calculationId)}；规则 ${text(rule?.code)}、版本 ${text(rule?.version)}、公式 ${text(rule?.formulaVersion)}。参数来源：${sources.join("；") || "冻结记录未提供"}。未关联图集原页。`;
    }
    const page = model.referencePages.find(p => p.sourcePageId === c.sourcePageId);
    return `${text(c.constructionCode)}：${text(page?.documentTitle ?? c.evidenceSource)}；资料编号 ${text(page?.docNumber)}；`
      + `印刷页 ${text(page ? page.pageLabel : c.sourcePageLabel)}；物理页 ${text(page?.physicalPageNumber)}；`
      + `构造/档位 ${text(c.optionId ?? c.calculationId)}；来源页标识 ${text(c.sourcePageId)}。`;
  });
  const appendix = frozenPages.map(page => {
    const image = isEmbeddedReportImage(page.imageDataUrl) ? `<img class="reference-page" src="${escapeHtml(page.imageDataUrl)}" alt="冻结来源原页" />`
      : `<p class="warning">来源图不可用，保留冻结结构化事实与引用；未替换其他原页。</p>`;
    return `<section class="source-page"><h3>${text(page.documentTitle)}</h3><p>资料编号：${text(page.docNumber)}；印刷页：${text(page.pageLabel)}；物理页：${text(page.physicalPageNumber)}；来源页标识：${text(page.sourcePageId)}</p>${renderFrozenReferenceTables([page], model)}${image}</section>`;
  }).join("");
  return `<ul>${citations.map(c => `<li>${c}</li>`).join("")}</ul>${appendix}`;
}

export function renderSolutionDocumentHtml(payload: ReportSnapshotPayload, model: SolutionDocumentModel): string {
  assertSolutionDocument(model);
  if (payload.solutionSnapshotId && payload.solutionSnapshotId !== model.solutionSnapshotId)
    throw new AppError("SOLUTION_DOCUMENT_INVALID", "报告快照与方案文档的确认标识不一致。", 400, { errorCode: "SOLUTION_DOCUMENT_INVALID" });
  const sections = payload.template?.sections ?? [];
  const titleFor = (key: string, fallback: string) => sections.find(s => s.key === key)?.title ?? fallback;
  const title = payload.settings?.coverTitle?.trim() || payload.title?.trim()
    || (payload.reportType === "project_brief" ? "项目方案简报" : "正式技术方案报告");
  const project = model.project;
  const requirements = model.requirements;
  const conditions: string[] = [];
  const thicknessScope = model.solutions.some(candidate => candidate.inputThicknessLayerName) ? "输入厚度（作用层见各方案）" : "板厚";
  const fields = [["regionCode", "地区"], ["buildingType", "建筑类型"], ["systemId", "体系标识"], ["substrateMaterial", "基层"], ["thicknessMm", `${thicknessScope} mm`], ["thicknessMin", `${thicknessScope}下限 mm`], ["thicknessMax", `${thicknessScope}上限 mm`]] as const;
  for (const [key, label] of fields) if (requirements[key] != null) conditions.push(`${label}${key === "thicknessMin" && requirements.thicknessMinExclusive || key === "thicknessMax" && requirements.thicknessMaxExclusive ? "（不含边界）" : ""}：${requirements[key]}`);
  const modes = { APPROX: "接近", EXACT: "精确值", MAX_LIMIT: "不大于", MIN_LIMIT: "不小于", LT: "严格小于", GT: "严格大于" };
  for (const filter of requirements.filters ?? []) conditions.push(`${filter.metric === "K" ? "K" : filter.metric === "PRODUCT_R" ? "产品 R" : "总 R₀"}：${filter.mode ? modes[filter.mode] : "未指定匹配方式"} ${filter.targetValue} ${filter.metric === "K" ? "W/(m²·K)" : "(m²·K)/W"}`);
  if (!requirements.filters?.length) {
    if (requirements.targetK != null) conditions.push(`K目标：${requirements.targetK} W/(m²·K)`);
    if (requirements.targetR != null) conditions.push(`热阻目标：${requirements.targetR} (m²·K)/W`);
  }
  if (!requirements.regionCode) conditions.push("地区：未提供正式地区编码");
  if (!requirements.buildingType) conditions.push("建筑类型：未提供");
  if (model.preferences.preferThinner) conditions.push("偏好：在硬条件满足后优先较薄方案");
  if (model.preferences.preferLowerK) conditions.push("偏好：在硬条件满足后优先较低K");
  if (model.preferences.preferHigherR) conditions.push("偏好：在硬条件满足后优先较高热阻");
  for (const preference of model.preferences.entities ?? []) conditions.push(`偏好条件：${preference.field} ${preference.value}`);
  const brand = payload.branding;
  const logo = isEmbeddedReportImage(brand?.logoDataUrl) ? `<img class="company-logo" src="${escapeHtml(brand.logoDataUrl)}" alt="企业Logo" />`
    : brand?.logoUnavailable ? '<p class="warning">企业Logo不可用。</p>' : "";
  const cover = `<div class="cover">${logo}${brand?.companyName ? `<p>${text(brand.companyName)}</p>` : ""}<p class="eyebrow">蓝格智配 · ${payload.reportType === "project_brief" ? "项目方案简报" : "综合技术方案报告"}</p><h1>${text(title)}</h1><p>项目：${text(project?.name ?? "独立已确认方案（未关联项目）")}</p><p>生成时间：${text(payload.generatedAt)}</p><p>确认时间：${text(new Date(model.confirmedAt).toISOString())}</p><p>确认人标识：${text(model.confirmedBy)}</p><p>方案快照：${text(model.solutionSnapshotId)}</p><p class="warning">本文件为已确认方案的冻结事实报告；生成文件不等于已审核或已发布。</p></div>`;
  const assumptions = section(titleFor("project", "需求与选型前提"), list(conditions) + `<p class="warning">${text(model.compliance?.note ?? "未进行地区/项目合规性核验。")}</p>`);
  const frozenLayers = model.solutions.filter(candidate => candidate.publishedReferenceSource && candidate.layers?.length).map(candidate =>
    `<h3>${text(candidate.schemeName ?? candidate.constructionCode)} · 分层做法</h3>${table(["顺序", "材料层", "厚度 mm"], candidate.layers!.map(layer =>
      [number(layer.order), text(layer.name), number(layer.thicknessMm)]))}<p>来源：${text(candidate.evidenceSource)}，${text(candidate.evidenceRef)}；构造版本 ${number(candidate.schemeVersion)}。以上分层与方案一并冻结，未重新计算或补写施工节点。</p>`).join("");
  const final = section(`${titleFor("construction", "构造方案")}（最终采用）`, solutionTable(model) + frozenLayers);
  const showProcess = payload.settings?.showCalculationProcess !== false && payload.reportType !== "project_brief"
    && !sections.some(s => s.key === "thermal" && !s.enabled);
  const basis = section("热工参数与依据", model.solutions.map(c => `<p><strong>${text(c.constructionCode)}</strong>：${c.sourceType === "CALCULATED" ? "确定性引擎计算值" : c.publishedReferenceSource ? "已发布热工参考行值" : c.sourcePageId ? "图集查表值" : "参考记录值"}；产品层热阻 R=${number(c.productThermalResistance)} (m²·K)/W；总热阻 R₀=${number(c.totalThermalResistance)} (m²·K)/W；K=${number(c.kValue)} W/(m²·K)。${c.calculationId ? `计算记录 ${text(c.calculationId)}；计算模式 ${text(c.calcMode)}。` : ""}</p>`).join("") + (showProcess ? calculationDetails(model) : ""));
  const alternatives = model.alternatives.length ? section("备选方案对比（未作为最终采用方案）", solutionTable(model, true)) : "";
  const sources = section(titleFor("sources", "知识来源与冻结原表"), sourceSections(model,
    payload.settings?.showSourceReferences === false || sections.some(s => s.key === "sources" && !s.enabled)
      ? [] : payload.referencePages ?? model.referencePages));
  const risks = section("风险与限制", list([...new Set([...model.warnings, "工程指标仅来自确认时的方案快照，未重检索、重算或读取最新产品参数。", "图集选型及计算结果不等同于地区合规、审图通过或施工验收结论。"])]), true);
  const disclaimer = payload.settings?.showDisclaimer === false ? undefined : sections.find(s => s.key === "disclaimer" && s.enabled && s.sourceType === "TEXT");
  const disclaimerContent = payload.settings?.disclaimerText?.trim() || disclaimer?.content;
  const extra = sections.filter(s => s.enabled && s.sourceType === "TEXT" && s.key !== "disclaimer").map(s => section(s.title, `<p>${text(s.content)}</p>`)).join("");
  const footer = `<footer>${text(payload.settings?.footerText ?? "由蓝格智配生成，需经专业审核后方可作为正式技术文件使用。")}</footer>`;
  const closing = disclaimer ? section(disclaimer.title, `<p>${text(disclaimerContent)}</p>${footer}`, true) : footer;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
  @page{size:A4}*{box-sizing:border-box}body{font-family:"Microsoft YaHei","Noto Sans CJK SC","SimSun",sans-serif;color:#172b3a;font-size:10pt;line-height:1.6;margin:0}h1{font-size:26pt;line-height:1.4}h2{font-size:15pt;border-bottom:1px solid #176b57;padding-bottom:5px;break-after:avoid}h3{font-size:11pt;break-after:avoid}.cover{min-height:225mm;padding-top:30mm;break-after:page}.eyebrow{color:#176b57}section{margin:5mm 0}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:3mm 0;font-size:8.5pt}th,td{border:1px solid #cbd5df;padding:5px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-line}thead{display:table-header-group}th{background:#eef5f3}tr{break-inside:avoid}.final-option{background:#e6f3ec;font-weight:bold}.warning{color:#8a4b12}.reference-page{display:block;max-width:100%;max-height:235mm;width:auto;height:auto;margin:4mm auto;object-fit:contain;break-inside:avoid}li,p{overflow-wrap:anywhere}.source-page{break-before:page}.source-page:first-child{break-before:auto}footer{font-size:9pt;border-top:1px solid #cbd5df;margin-top:8mm;padding-top:3mm}
  .company-logo{display:block;max-width:65mm;max-height:25mm;object-fit:contain;margin-bottom:8mm}
  footer{margin-top:3mm;padding-top:1mm}.keep-together{break-inside:avoid}li{break-inside:avoid;orphans:2;widows:2}
  </style></head><body>${cover}${assumptions}${final}${basis}${alternatives}${sources}${risks}${extra}${closing}</body></html>`;
}
