import { z } from "zod";
import { ReportError } from "../../shared/report-errors.js";

/**
 * 系统预置报告类型：普通业务只认 code/name/description/requiresProject/enabled。
 * 模板 code、renderer、章节配置是内部渲染细节，不通过 GET /types 暴露。
 */

export const PUBLIC_REPORT_TYPE_CODES = [
  "technical_scheme",
  "project_brief",
  "material_compare",
  "ai_conversation"
] as const;

export const GENERATABLE_REPORT_TYPE_CODES = [
  ...PUBLIC_REPORT_TYPE_CODES,
  "energy_design",
  "design_note",
  "marketing_copy",
  "TEMPLATE"
] as const;

export type PublicReportTypeCode = (typeof PUBLIC_REPORT_TYPE_CODES)[number];
export type GeneratableReportTypeCode = (typeof GENERATABLE_REPORT_TYPE_CODES)[number];

export const generatableReportTypeSchema = z.enum(GENERATABLE_REPORT_TYPE_CODES);

export type ReportTypeDefinition = {
  code: GeneratableReportTypeCode;
  name: string;
  description: string;
  requiresProject: boolean;
  enabled: boolean;
  listed: boolean;
  renderer: "template" | "ai_content";
  templateCode: string | null;
  needsSelection: boolean;
  requiresReview: boolean;
};

export type PublicReportType = Pick<
  ReportTypeDefinition,
  "code" | "name" | "description" | "requiresProject" | "enabled"
>;

const REPORT_TYPE_CATALOG: readonly ReportTypeDefinition[] = [
  {
    code: "technical_scheme",
    name: "综合技术方案报告",
    description: "覆盖封面、项目概况、方案、计算、对比、引用依据与免责声明的完整技术报告",
    requiresProject: true,
    enabled: true,
    listed: true,
    renderer: "template",
    templateCode: "standard_report",
    needsSelection: true,
    requiresReview: true
  },
  {
    code: "project_brief",
    name: "项目方案简报",
    description: "面向项目沟通的精简方案报告，不含完整计算过程",
    requiresProject: true,
    enabled: true,
    listed: true,
    renderer: "template",
    templateCode: "project_brief",
    needsSelection: true,
    requiresReview: true
  },
  {
    code: "material_compare",
    name: "材料对比报告",
    description: "VICP 与竞品材料对比结论报告，可不关联项目",
    requiresProject: false,
    enabled: true,
    listed: true,
    renderer: "template",
    templateCode: "material_compare",
    needsSelection: false,
    requiresReview: true
  },
  {
    code: "ai_conversation",
    name: "AI对话整理报告",
    description: "将 AI 会话回答整理为可读报告，可不关联项目",
    requiresProject: false,
    enabled: true,
    listed: true,
    renderer: "ai_content",
    templateCode: null,
    needsSelection: false,
    requiresReview: false
  },
  {
    code: "energy_design",
    name: "建筑节能设计报告",
    description: "历史 AI 报告类型，兼容已有生成与导出",
    requiresProject: false,
    enabled: true,
    listed: false,
    renderer: "ai_content",
    templateCode: null,
    needsSelection: false,
    requiresReview: false
  },
  {
    code: "design_note",
    name: "VICP 设计说明",
    description: "历史 AI 报告类型，兼容已有生成与导出",
    requiresProject: false,
    enabled: true,
    listed: false,
    renderer: "ai_content",
    templateCode: null,
    needsSelection: false,
    requiresReview: false
  },
  {
    code: "marketing_copy",
    name: "VICP 项目说明",
    description: "历史 AI 报告类型，兼容已有生成与导出",
    requiresProject: false,
    enabled: true,
    listed: false,
    renderer: "ai_content",
    templateCode: null,
    needsSelection: false,
    requiresReview: false
  },
  {
    code: "TEMPLATE",
    name: "工程报告",
    description: "历史模板报告类型，兼容已有快照与审核",
    requiresProject: true,
    enabled: true,
    listed: false,
    renderer: "template",
    templateCode: "standard_report",
    needsSelection: true,
    requiresReview: true
  }
];

const REPORT_TYPE_BY_CODE = new Map(REPORT_TYPE_CATALOG.map((item) => [item.code, item]));

export function resolveReportType(code: string): ReportTypeDefinition {
  const found = REPORT_TYPE_BY_CODE.get(code as GeneratableReportTypeCode);
  if (!found || !found.enabled) {
    throw new ReportError("REPORT_TYPE_UNKNOWN");
  }
  return found;
}

export function listPublicReportTypes(): PublicReportType[] {
  return REPORT_TYPE_CATALOG
    .filter((item) => item.listed && item.enabled)
    .map(({ code, name, description, requiresProject, enabled }) => ({
      code, name, description, requiresProject, enabled
    }));
}

export function reportTypeRequiresReview(code: string): boolean {
  return REPORT_TYPE_BY_CODE.get(code as GeneratableReportTypeCode)?.requiresReview === true;
}

export function isTemplateBackedReportType(code: string): boolean {
  return REPORT_TYPE_BY_CODE.get(code as GeneratableReportTypeCode)?.renderer === "template";
}

export function templateBackedReportTypeCodes(): string[] {
  return REPORT_TYPE_CATALOG.filter((item) => item.renderer === "template").map((item) => item.code);
}

export function reportTypeDisplayName(code: string): string {
  return REPORT_TYPE_BY_CODE.get(code as GeneratableReportTypeCode)?.name ?? code;
}
