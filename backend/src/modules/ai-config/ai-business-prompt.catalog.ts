import { AI_BUSINESS_PROMPT_CODES, AI_SCENES } from "../../shared/constants.js";

export const BUSINESS_PROMPT_CATALOG = [
  {
    code: AI_BUSINESS_PROMPT_CODES.BASE_CHAT,
    sceneCode: AI_SCENES.GENERAL_CHAT,
    name: "基础对话",
    description: "默认对话关注点。回答方式由全局回答规则统一负责。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.KNOWLEDGE_SEARCH,
    sceneCode: AI_SCENES.KNOWLEDGE_QA,
    name: "知识检索",
    description: "知识问答关注图集、标准、构造做法。检索范围仍由服务端强制。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.PROJECT_ANALYSIS,
    sceneCode: AI_SCENES.PROJECT_DESIGN,
    name: "项目分析",
    description: "项目资料解读的关注点。回答方式由全局回答规则统一负责。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.PRODUCT_CONSULTATION,
    sceneCode: AI_SCENES.PRODUCT_CONSULTATION,
    name: "产品咨询",
    description: "单产品咨询的关注点：性能、适用场景和优势。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.THERMAL_CALCULATION,
    sceneCode: AI_SCENES.THERMAL_CALCULATION,
    name: "热工计算",
    description: "热工结果解释的关注点。数值必须来自确定性计算引擎。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.PRODUCT_COMPARE,
    sceneCode: AI_SCENES.MATERIAL_COMPARE,
    name: "产品对比",
    description: "产品对比只解释结构化差异。热工可选，缺失时用用户语言说明暂不参与。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.REPORT_GENERATION,
    sceneCode: AI_SCENES.REPORT_GENERATE,
    name: "报告生成",
    description: "报告草稿关注已确认选择。聊天里不重复整段历史。"
  },
  {
    code: AI_BUSINESS_PROMPT_CODES.VISION_UNDERSTANDING,
    sceneCode: AI_SCENES.VISION_UNDERSTANDING,
    name: "图像理解",
    description: "看图观察的描述结构。观察结果只作为上下文，不替代业务编排。"
  }
] as const;

export type BusinessPromptCode = (typeof BUSINESS_PROMPT_CATALOG)[number]["code"];

export const DEFAULT_BUSINESS_PROMPT_CONTENT: Record<BusinessPromptCode, string> = {
  BASE_CHAT: "关注用户当前问题。寒暄直接回应；涉及产品、标准、项目或报告时按对应业务处理。不要解释系统如何工作。",
  KNOWLEDGE_SEARCH: "关注与用户问题直接相关的图集、标准、规范和构造做法。有可靠资料时给出关键结论及对应出处；资料不足时直接说明目前不能确定的部分。",
  PROJECT_ANALYSIS: "关注当前项目条件对方案或产品选择的影响。缺失条件时询问，不要补造项目参数。",
  PRODUCT_CONSULTATION: "关注单产品的性能、适用场景和优势。用户只给出产品名时，自然追问想了解哪一方面，例如性能、适用场景、产品优势，或和其他产品做对比。资料足够则直接给结论、必要条件和来源。",
  THERMAL_CALCULATION: "关注确定性热工计算结果。先给结果，再给简短解释；计算过程仅在用户询问时展开。没有结果时说明这部分暂时不参与比较。",
  PRODUCT_COMPARE: "关注结构化对比结果中的差异。只解释差异，不要复述整份对比上下文。热工缺失时说明暂不参与比较。不要打分、排名或替用户做唯一选择。",
  REPORT_GENERATION: "关注已确认选择或已固化材料。聊天里只需简短确认已按所选内容生成，不要复述项目资料和全部历史结论。",
  VISION_UNDERSTANDING: "只描述图片中可见的内容。不确定处明确说明，不把观察结果当作已发布标准或计算结果。"
};

export function findBusinessPromptMeta(code: string) {
  return BUSINESS_PROMPT_CATALOG.find((item) => item.code === code);
}
