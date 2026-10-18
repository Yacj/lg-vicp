import { isClosedGreeting, type DomainTurnDecision } from "./ai-domain-turn-decision.js";
/**
 * AI 能力路由器：预路由、安全限制与非 Agent 回退路径优化。
 * 不再作为「某 Tool 能否被模型看到」的唯一依据。
 * Chat Agent 核心 Tools 仅 5 个时，非寒暄消息向模型开放完整领域 Tool 集合。
 */

export interface ResolveAiCapabilitiesInput {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
  /** 兼容存量专业会话：仍可作为内部提示，不覆盖规则判断 */
  scene?: string | null;
  domainDecision?: DomainTurnDecision;
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
  if (!input.message.trim() || isClosedGreeting(input.message)) return { ...EMPTY_CAPABILITIES };
  const intent = input.domainDecision?.intent ?? "GENERAL";
  const references = new Set(["REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "COMPARE_CANDIDATES"]);
  const products = new Set(["PRODUCT_DISCOVERY", "PRODUCT_DETAIL", "PRODUCT_PARAMETER_QUERY", "MATERIAL_COMPARE"]);
  return { idle: false, needKnowledgeSearch: intent !== "SOLUTION_ADVICE" && intent !== "CLARIFY",
    explicitKnowledgeRequest: references.has(intent) || intent === "KNOWLEDGE_EXPLAIN" || intent === "COMPLIANCE_CHECK",
    needProjectContext: Boolean(input.projectId), needReferenceLookup: references.has(intent),
    needThermalTool: intent === "THERMAL_CALCULATE", needComparisonTool: intent === "MATERIAL_COMPARE" || intent === "COMPARE_CANDIDATES",
    needProductData: products.has(intent), needReportContext: intent === "REPORT_REQUEST" };
}
