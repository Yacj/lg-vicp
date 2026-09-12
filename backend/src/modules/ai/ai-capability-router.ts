/**
 * AI 能力路由器（P0）：根据用户问题 + 会话上下文用规则判断需要哪些能力。
 * 不替代场景配置，也不强制用户选择 scene / prompt / quickPromptId。
 * 快捷提问的 content 与自由输入走同一套判断。
 */

export interface ResolveAiCapabilitiesInput {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
  /** 兼容存量专业会话：仍可作为内部提示，不覆盖规则判断 */
  scene?: string | null;
}

export interface AiCapabilities {
  needKnowledgeSearch: boolean;
  /** 用户明确要求按图集/标准/系统资料回答：无检索结果时禁止编造来源 */
  explicitKnowledgeRequest: boolean;
  needProjectContext: boolean;
  needThermalTool: boolean;
  needComparisonTool: boolean;
  needReportContext: boolean;
}

const GREETING_PATTERN = /^(你好|您好|嗨|哈喽|在吗|hello|hi)[！!。.?？\s]*$/i;

const EXPLICIT_KNOWLEDGE_PATTERN = /根据(图集|标准|规范|资料)|系统资料|已发布.{0,8}(知识|图集|标准)|知识库|资料里/;

const KNOWLEDGE_PATTERN = /图集|标准|规范|节点|构造|窗洞口|洞口|产品说明|施工|技术要求|技术参数|条文|页码|章节|保温|节能标准|vicp|做法|节点图|大样/i;

const THERMAL_PATTERN = /热工|传热系数|k\s*值|热阻|等效厚度|计算厚度|保温厚度|导热系数/i;

const COMPARISON_PATTERN = /材料对比|对比规则|竞品|eps|xps|岩棉|聚氨酯|一体板/i;

const REPORT_PATTERN = /生成报告|出一份报告|工程报告|设计说明/;

const EMPTY_CAPABILITIES: AiCapabilities = {
  needKnowledgeSearch: false,
  explicitKnowledgeRequest: false,
  needProjectContext: false,
  needThermalTool: false,
  needComparisonTool: false,
  needReportContext: false
};

export function resolveAiCapabilities(input: ResolveAiCapabilitiesInput): AiCapabilities {
  const message = input.message.trim();
  if (!message || GREETING_PATTERN.test(message)) {
    return { ...EMPTY_CAPABILITIES };
  }

  const explicitKnowledgeRequest = EXPLICIT_KNOWLEDGE_PATTERN.test(message);
  const needKnowledgeSearch = explicitKnowledgeRequest || KNOWLEDGE_PATTERN.test(message);
  const needThermalTool = THERMAL_PATTERN.test(message);
  const needComparisonTool = COMPARISON_PATTERN.test(message);
  const needReportContext = REPORT_PATTERN.test(message);
  // 仅会话已关联项目时注入项目上下文；无项目不阻断图片、检索、问答
  const needProjectContext = Boolean(input.projectId);

  return {
    needKnowledgeSearch,
    explicitKnowledgeRequest,
    needProjectContext,
    needThermalTool,
    needComparisonTool,
    needReportContext
  };
}
