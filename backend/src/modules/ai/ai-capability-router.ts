/**
 * AI 能力路由器：预路由、安全限制与非 Agent 回退路径优化。
 * 不再作为「某 Tool 能否被模型看到」的唯一依据。
 * Chat Agent 核心 Tools 仅 5 个时，非寒暄消息向模型开放完整领域 Tool 集合。
 */

import {
  isReferenceLookupIntent,
  isThermalCalculateIntent,
  THERMAL_VALUE_PATTERN
} from "../../shared/ai-answer-contract.js";

export interface ResolveAiCapabilitiesInput {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
  /** 兼容存量专业会话：仍可作为内部提示，不覆盖规则判断 */
  scene?: string | null;
}

export interface AiCapabilities {
  /** 寒暄/空消息：不启动 Agent，走普通单次生成 */
  idle: boolean;
  needKnowledgeSearch: boolean;
  /** 用户明确要求按图集/标准/系统资料回答：无检索结果时禁止编造来源 */
  explicitKnowledgeRequest: boolean;
  needProjectContext: boolean;
  /** 查询已发布图集 / 参考选用表 / 已知档位 */
  needReferenceLookup: boolean;
  /** 正式热工计算 / 项目级合规判断 */
  needThermalTool: boolean;
  needComparisonTool: boolean;
  needProductData: boolean;
  needReportContext: boolean;
}

const GREETING_PATTERN = /^(你好|您好|嗨|哈喽|在吗|hello|hi)[！!。.?？\s]*$/i;

const EXPLICIT_KNOWLEDGE_PATTERN = /根据(图集|标准|规范|资料)|系统资料|已发布.{0,8}(知识|图集|标准)|知识库|资料里/;

const KNOWLEDGE_PATTERN = /图集|标准|规范|节点|构造|窗洞口|洞口|产品说明|施工|技术要求|技术参数|条文|页码|章节|保温|节能标准|vicp|做法|节点图|大样/i;

const COMPARISON_PATTERN = /材料对比|对比规则|竞品|eps|xps|岩棉|聚氨酯|一体板|对比|区别|vs|比起|相比|性价比|哪个好/i;

const PRODUCT_PATTERN = /产品|vicp|vlcp|适用场景|有什么优势/i;

const REPORT_PATTERN = /生成报告|出一份报告|工程报告|设计说明|对比报告/;

const EMPTY_CAPABILITIES: AiCapabilities = {
  idle: true,
  needKnowledgeSearch: false,
  explicitKnowledgeRequest: false,
  needProjectContext: false,
  needReferenceLookup: false,
  needThermalTool: false,
  needComparisonTool: false,
  needProductData: false,
  needReportContext: false
};

export const AGENT_TOOL_NAMES = [
  "search_knowledge",
  "get_project_state",
  "get_product_data",
  "thermal",
  "compare_products",
  "compare_solutions",
  "generate_report"
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const LEGACY_TOOL_NAME_MAP: Record<string, AgentToolName> = {
  get_project_context: "get_project_state",
  get_project_memory: "get_project_state",
  get_report_types: "generate_report",
  generate_report_draft: "generate_report",
  thermal_calculate: "thermal"
};

export function normalizeAllowedToolNames(names: readonly string[] | null | undefined): AgentToolName[] {
  const selected = new Set<AgentToolName>();
  for (const name of names ?? []) {
    const mapped = LEGACY_TOOL_NAME_MAP[name] ?? name;
    if ((AGENT_TOOL_NAMES as readonly string[]).includes(mapped)) {
      selected.add(mapped as AgentToolName);
    }
  }
  return AGENT_TOOL_NAMES.filter((name) => selected.has(name));
}

/**
 * 选择模型可见的领域 Tool。
 * idle（寒暄）不给工具；其余安全限制只包括知识检索开关与是否关联项目。
 * 热工/对比/报告不再依赖关键字，避免“帮我找合适方案”看不到 compare/thermal。
 */
export function selectAllowedToolNames(input: {
  capabilities: AiCapabilities;
  hasProject: boolean;
  allowKnowledgeSearch: boolean;
}): AgentToolName[] {
  if (input.capabilities.idle) return [];
  const tools: AgentToolName[] = [];
  if (input.allowKnowledgeSearch) tools.push("search_knowledge");
  if (input.hasProject) tools.push("get_project_state");
  tools.push("get_product_data", "thermal", "compare_products", "compare_solutions", "generate_report");
  return tools;
}

export function resolveAiCapabilities(input: ResolveAiCapabilitiesInput): AiCapabilities {
  const message = input.message.trim();
  if (!message || GREETING_PATTERN.test(message)) {
    return { ...EMPTY_CAPABILITIES };
  }

  const explicitKnowledgeRequest = EXPLICIT_KNOWLEDGE_PATTERN.test(message);
  const needKnowledgeSearch = explicitKnowledgeRequest || KNOWLEDGE_PATTERN.test(message);
  const needThermalTool = isThermalCalculateIntent(message);
  const needReferenceLookup = isReferenceLookupIntent(message) || (!needThermalTool && THERMAL_VALUE_PATTERN.test(message));
  const needComparisonTool = COMPARISON_PATTERN.test(message);
  const needProductData = PRODUCT_PATTERN.test(message);
  const needReportContext = REPORT_PATTERN.test(message);
  const needProjectContext = Boolean(input.projectId);

  return {
    idle: false,
    needKnowledgeSearch,
    explicitKnowledgeRequest,
    needProjectContext,
    needReferenceLookup,
    needThermalTool,
    needComparisonTool,
    needProductData,
    needReportContext
  };
}
