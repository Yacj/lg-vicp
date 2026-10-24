import type { FastifyInstance } from "fastify";
import { readConsumableReferencePages, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { constructionKey, knowledgeOptionIdentity, resolveKnowledgeOption, type KnowledgeOptionIdentity,
  type RenderConstruction, type RenderOption } from "./knowledge-option-identity.js";

/**
 * 知识库只读比较（P0-B）。
 *
 * 边界：
 * - 只读：不写 solution_state、不发布 reference_candidates、不生成 Candidate/Revision/Snapshot/PDF；
 * - 只消费"已确认 + 已发布 + 当前有权访问"的页；
 * - 必须逐项核对指标口径、单位、基层、厚度、来源与版本；
 * - 身份不唯一时显式歧义，不猜测、不按页面序号兜底。
 */
export interface KnowledgeCompareSelection {
  pageId: string;
  constructionCode?: string | null;
  constructionLabel?: string | null;
  thicknessMm: number | null;
  confirmedRevision?: string | null;
}

export interface KnowledgeCompareItem {
  identity: KnowledgeOptionIdentity;
  constructionLabel: string;
  baseMaterial: string | null;
  baseThicknessMm: number | null;
  roofForm: string | null;
  thicknessMm: number | null;
  productThermalResistance: number | null;
  totalThermalResistance: number | null;
  kValue: number | null;
  source: { documentId: string; documentTitle: string; versionId: string; pageLabel: string | null; pageNumber: number };
}

export type KnowledgeCompareFailureStatus = "PAGE_NOT_READABLE" | "CONSTRUCTION_NOT_FOUND" | "THICKNESS_NOT_FOUND"
  | "AMBIGUOUS" | "STALE_REVISION" | "REVISION_UNVERIFIABLE";
export interface KnowledgeCompareFailure {
  selection: KnowledgeCompareSelection;
  status: KnowledgeCompareFailureStatus;
  message: string;
  options?: Array<{ optionId: string; constructionCode: string | null; thicknessMm: number | null }>;
}
export type CompareCheckStatus = "SAME" | "DIFFERENT" | "MISSING";
export interface KnowledgeCompareCheck {
  key: "METRIC_SCOPE" | "UNIT" | "BASE" | "THICKNESS" | "SOURCE" | "VERSION";
  status: CompareCheckStatus;
  detail: string;
}

export const KNOWLEDGE_COMPARE_UNITS = { K: "W/(m²·K)", R: "(m²·K)/W" } as const;

const constructionLabel = (construction: RenderConstruction) =>
  construction.rawConstructionLabel || construction.constructionCode || construction.systemName || "未命名构造";

function toItem(page: { pageId: string; documentId: string; versionId: string; documentTitle: string; pageLabel: string | null;
  pageNumber: number; confirmRevision: string; construction: RenderConstruction; option: RenderOption }): KnowledgeCompareItem {
  return {
    identity: knowledgeOptionIdentity({ pageId: page.pageId, documentId: page.documentId, versionId: page.versionId,
      revision: page.confirmRevision, construction: page.construction, option: page.option }),
    constructionLabel: constructionLabel(page.construction),
    baseMaterial: page.construction.baseMaterial ?? null,
    baseThicknessMm: page.construction.baseThicknessMm ?? null,
    roofForm: page.construction.roofForm ?? null,
    thicknessMm: page.option.thicknessMm ?? null,
    productThermalResistance: page.option.productThermalResistance ?? null,
    totalThermalResistance: page.option.totalThermalResistance ?? null,
    kValue: page.option.kValue ?? null,
    source: { documentId: page.documentId, documentTitle: page.documentTitle, versionId: page.versionId,
      pageLabel: page.pageLabel, pageNumber: page.pageNumber }
  };
}

/** 比较口径核对：只描述事实差异，不判定优劣、不补算缺失值。 */
export function buildKnowledgeCompareChecks(items: readonly KnowledgeCompareItem[]): KnowledgeCompareCheck[] {
  const checks: KnowledgeCompareCheck[] = [];
  const missing = (key: "productThermalResistance" | "totalThermalResistance" | "kValue") =>
    items.filter(item => item[key] == null).map(item => `${item.constructionLabel} ${item.thicknessMm ?? "?"}mm`);
  const scopeMissing = [
    missing("productThermalResistance").length ? `产品层热阻缺 ${missing("productThermalResistance").join("、")}` : "",
    missing("totalThermalResistance").length ? `整构造传热阻缺 ${missing("totalThermalResistance").join("、")}` : "",
    missing("kValue").length ? `整构造传热系数缺 ${missing("kValue").join("、")}` : ""
  ].filter(Boolean);
  checks.push({ key: "METRIC_SCOPE", status: scopeMissing.length ? "MISSING" : "SAME",
    detail: scopeMissing.length ? `${scopeMissing.join("；")}；缺失项保持缺失，不插值。`
      : "三项口径分别独立：产品层热阻、整构造传热阻、整构造传热系数，未混用或换算。" });
  checks.push({ key: "UNIT", status: items.every(item => item.kValue != null) ? "SAME" : "MISSING",
    detail: `传热系数单位 ${KNOWLEDGE_COMPARE_UNITS.K}；热阻单位 ${KNOWLEDGE_COMPARE_UNITS.R}；未做单位换算。` });
  const bases = items.map(item => `${item.baseMaterial ?? "未提供"}/${item.baseThicknessMm == null ? "?" : item.baseThicknessMm}mm`);
  const baseMissing = items.some(item => !item.baseMaterial || item.baseThicknessMm == null);
  checks.push({ key: "BASE", status: baseMissing ? "MISSING" : new Set(bases).size > 1 ? "DIFFERENT" : "SAME",
    detail: `基层：${bases.join("、")}${baseMissing ? "（存在未提供项）" : ""}` });
  const thickness = items.map(item => `${item.constructionLabel} ${item.thicknessMm == null ? "未提供" : `${item.thicknessMm}mm`}`);
  checks.push({ key: "THICKNESS", status: items.some(item => item.thicknessMm == null) ? "MISSING" : "SAME",
    detail: `厚度：${thickness.join("、")}` });
  const sources = items.map(item => `${item.source.documentTitle}（印刷页码 ${item.source.pageLabel ?? "待核"}）`);
  checks.push({ key: "SOURCE", status: new Set(items.map(item => item.source.pageLabel)).size > 1 ? "DIFFERENT" : "SAME",
    detail: `来源：${[...new Set(sources)].join("、")}` });
  const versions = [...new Set(items.map(item => item.source.versionId))];
  const revisions = [...new Set(items.map(item => item.identity.confirmedRevision))];
  const unverified = items.filter(item => !item.identity.revisionVerified).map(item => `${item.constructionLabel} ${item.thicknessMm ?? "?"}mm`);
  checks.push({ key: "VERSION", status: versions.length > 1 || revisions.length > 1 ? "DIFFERENT" : unverified.length ? "MISSING" : "SAME",
    detail: `${versions.length > 1 ? "资料来源版本不同" : "资料来源版本一致"}；${revisions.length > 1 ? "确认快照不同" : "确认快照一致"}`
      + `${unverified.length ? `；${unverified.join("、")} 的确认快照未带版本指纹，只能按内容核对，不能声称已核对版本` : ""}。` });
  return checks;
}

/** 聊天与接口共用的渲染；不产出候选、不写状态。 */
export function renderKnowledgeCompare(items: readonly KnowledgeCompareItem[], checks: readonly KnowledgeCompareCheck[]) {
  const lines = ["以下为只读比较，不构成正式候选，不能据此确认方案或生成正式报告。",
    "| 构造 | 基层 | 厚度 mm | 产品层热阻 (m²·K)/W | 整构造传热阻 (m²·K)/W | 传热系数 W/(m²·K) | 来源 |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |"];
  for (const item of items) {
    lines.push(`| ${item.constructionLabel} | ${item.baseMaterial ?? "未提供"}${item.baseThicknessMm == null ? "" : ` ${item.baseThicknessMm}mm`} | ${item.thicknessMm ?? "未提供"} | ${item.productThermalResistance ?? "未提供"} | ${item.totalThermalResistance ?? "未提供"} | ${item.kValue ?? "未提供"} | ${item.source.documentTitle}，印刷页码 ${item.source.pageLabel ?? "待核"} |`);
  }
  const labels: Record<KnowledgeCompareCheck["key"], string> = { METRIC_SCOPE: "指标口径", UNIT: "单位", BASE: "基层", THICKNESS: "厚度", SOURCE: "来源", VERSION: "版本" };
  lines.push("", "口径核对：", ...checks.map(check => `- ${labels[check.key]}（${check.status === "SAME" ? "一致" : check.status === "DIFFERENT" ? "存在差异" : "有缺失"}）：${check.detail}`));
  lines.push("", "以上仅为已确认资料的只读对照：未选择方案、未确认、未冻结快照、未生成正式方案或报告；不同范围的热阻分别保留，不作插值或换算。");
  return lines.join("\n");
}

export interface KnowledgeCompareResult {
  comparisonOnly: true;
  confirmable: false;
  items: KnowledgeCompareItem[];
  failures: KnowledgeCompareFailure[];
  checks: KnowledgeCompareCheck[];
  answer: string;
  sources: Array<{ documentId: string; pageId: string; title: string; pageLabel: string | null; pageNumber: number }>;
}

/** 对同一批已重验的页块做只读比较；聊天与 HTTP 共用同一入口。 */
export async function compareKnowledgeSelections(app: FastifyInstance, input: {
  projectId: string | null; selections: readonly KnowledgeCompareSelection[];
  deps?: { readPages?: typeof readConsumableReferencePages; toBlock?: typeof toReferencePageBlock };
}): Promise<KnowledgeCompareResult> {
  const readPages = input.deps?.readPages ?? readConsumableReferencePages;
  const toBlock = input.deps?.toBlock ?? toReferencePageBlock;
  const selections = input.selections.slice(0, 6);
  if (selections.length < 2) throw new Error("请至少选择两个档位进行比较");
  const rows = await readPages(app, [...new Set(selections.map(item => item.pageId))], input.projectId);
  const items: KnowledgeCompareItem[] = [];
  const failures: KnowledgeCompareFailure[] = [];
  for (const selection of selections) {
    const row = rows.find(item => item.page.id === selection.pageId);
    if (!row) {
      failures.push({ selection, status: "PAGE_NOT_READABLE", message: "该页当前不可读（未发布、已失效或无权访问），不能参与比较。" });
      continue;
    }
    const block = await toBlock(app, row);
    const model = block.renderModel;
    if (!model) {
      failures.push({ selection, status: "PAGE_NOT_READABLE", message: "该页没有可用的确认快照，不能参与比较。" });
      continue;
    }
    const resolved = resolveKnowledgeOption(model, selection);
    if (resolved.status === "STALE_REVISION") {
      failures.push({ selection, status: "STALE_REVISION", message: "该页确认快照已更新，请重新打开原页后再比较。" });
      continue;
    }
    if (resolved.status === "REVISION_UNVERIFIABLE") {
      failures.push({ selection, status: "REVISION_UNVERIFIABLE", message: "该页确认快照未带版本指纹，无法核对版本是否仍一致；请重新打开原页后再比较。" });
      continue;
    }
    if (resolved.status === "CONSTRUCTION_NOT_FOUND") {
      failures.push({ selection, status: "CONSTRUCTION_NOT_FOUND", message: `该页没有找到构造 ${selection.constructionCode ?? selection.constructionLabel ?? ""}。` });
      continue;
    }
    if (resolved.status === "THICKNESS_NOT_FOUND") {
      failures.push({ selection, status: "THICKNESS_NOT_FOUND",
        message: `构造 ${selection.constructionCode ?? ""} 没有 ${selection.thicknessMm ?? "所给"}mm 档；该页可选厚度：${resolved.availableThickness.map(value => `${value ?? "未提供"}`).join("、")}。` });
      continue;
    }
    if (resolved.status === "AMBIGUOUS") {
      failures.push({ selection, status: "AMBIGUOUS", message: "该页存在多个同名同厚度的构造档位，无法唯一确定；请改为指定构造编码或厚度。",
        options: resolved.options.map(({ construction, option }) => ({ optionId: option.optionId, constructionCode: construction.constructionCode ?? null, thicknessMm: option.thicknessMm ?? null })) });
      continue;
    }
    items.push(toItem({ pageId: row.page.id, documentId: row.document.id, versionId: row.version.id,
      documentTitle: row.document.title, pageLabel: block.page.pageLabel ?? null, pageNumber: block.page.pageNumber,
      confirmRevision: model.confirmedRevision ?? "", construction: resolved.construction, option: resolved.option }));
  }
  // 重复选择同一条档位会让"比较"变成假对比，直接提示而不是凑数。
  const duplicates = items.filter((item, index) => items.findIndex(other => other.identity.optionFingerprint === item.identity.optionFingerprint
    && other.identity.pageId === item.identity.pageId && other.identity.constructionKey === item.identity.constructionKey) !== index);
  const unique = items.filter(item => !duplicates.includes(item));
  const checks = buildKnowledgeCompareChecks(unique);
  const answer = unique.length >= 2 ? renderKnowledgeCompare(unique, checks)
    : ["当前没有足够的可比较档位。", ...failures.map(failure => `- ${failure.message}`)].join("\n");
  return { comparisonOnly: true, confirmable: false, items: unique, failures, checks, answer,
    sources: [...new Map(unique.map(item => [item.source.pageLabel ?? item.source.pageNumber,
      { documentId: item.source.documentId, pageId: item.identity.pageId, title: item.source.documentTitle,
        pageLabel: item.source.pageLabel, pageNumber: item.source.pageNumber }])).values()] };
}
