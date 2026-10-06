/**
 * Answer Contract：只约束最终答案形态，不是 Agent 类型。
 * 安全/权限硬约束仍在 HARD_RESPONSE_CONSTRAINTS。
 */

export const ANSWER_CONTRACTS = [
  "DIRECT",
  "KNOWLEDGE",
  "PRODUCT",
  "COMPARISON",
  "REFERENCE_LOOKUP",
  "THERMAL",
  "CLARIFY"
] as const;

export type AnswerContract = (typeof ANSWER_CONTRACTS)[number];

type AnswerContractTaskType =
  | "GENERAL"
  | "PRODUCT_CONSULTATION"
  | "COMPARISON"
  | "REPORT_PREPARATION"
  | "REPORT_GENERATION";

type AnswerContractCapabilities = {
  idle?: boolean;
  needKnowledgeSearch?: boolean;
  explicitKnowledgeRequest?: boolean;
  needReferenceLookup?: boolean;
  needThermalTool?: boolean;
  needComparisonTool?: boolean;
  needProductData?: boolean;
};

/** 正式计算 / 项目级合规，不是「查已有档位」。 */
export const THERMAL_CALC_PATTERN = /帮我算|算一下|计算|达标|满足要求|符合|限值|能不能用|节能要求|这个墙体/i;

/** 查询已发布图集 / 参考表 / 已知档位。不含单独的「图集/做法」，以免抢走普通知识问答。 */
export const REFERENCE_LOOKUP_PATTERN = /有没有|有么|有哪些|接近|左右|档位|参考表|参考选用|图集里/i;

/** 热工数值用语：单独命中时不再进 THERMAL。 */
export const THERMAL_VALUE_PATTERN = /传热系数|k\s*值|热阻|热工|保温厚度|等效厚度|计算厚度|导热系数/i;

/** 上一轮已查出候选后的档位追问。 */
export const LOOKUP_FOLLOWUP_PATTERN = /[iⅰⅠ1一]型|[iiⅱⅡ2二]型|[iiiⅲⅢ3三]型|厚度|更低|更接近|具体参数|档位/i;

export function isThermalCalculateIntent(message: string): boolean {
  return THERMAL_CALC_PATTERN.test(message);
}

export function isReferenceLookupIntent(
  message: string,
  lastReferenceLookup?: { candidates?: unknown[] } | null
): boolean {
  if (isThermalCalculateIntent(message)) return false;
  if (REFERENCE_LOOKUP_PATTERN.test(message)) return true;
  if (THERMAL_VALUE_PATTERN.test(message)) return true;
  const hasLookup = Array.isArray(lastReferenceLookup?.candidates) && lastReferenceLookup.candidates.length > 0;
  return hasLookup && LOOKUP_FOLLOWUP_PATTERN.test(message);
}

export function resolveAnswerContract(input: {
  taskType?: AnswerContractTaskType | null;
  capabilities?: AnswerContractCapabilities | null;
  skipToolLoop?: boolean;
  message?: string | null;
  lastReferenceLookup?: { candidates?: unknown[] } | null;
}): AnswerContract {
  const capabilities = input.capabilities;
  const message = input.message?.trim() ?? "";
  if (input.skipToolLoop || capabilities?.idle) return "DIRECT";
  if (
    input.taskType === "COMPARISON"
    || input.taskType === "REPORT_PREPARATION"
    || capabilities?.needComparisonTool
  ) {
    return "COMPARISON";
  }
  if (capabilities?.needThermalTool || isThermalCalculateIntent(message)) return "THERMAL";
  if (capabilities?.needReferenceLookup || isReferenceLookupIntent(message, input.lastReferenceLookup)) {
    return "REFERENCE_LOOKUP";
  }
  if (input.taskType === "PRODUCT_CONSULTATION" || (capabilities?.needProductData && !capabilities.needKnowledgeSearch)) {
    return "PRODUCT";
  }
  if (capabilities?.needKnowledgeSearch || capabilities?.explicitKnowledgeRequest) return "KNOWLEDGE";
  return "DIRECT";
}

const CONTRACT_SHAPES: Record<AnswerContract, string> = {
  DIRECT: [
    "DIRECT：第一句直接回答，一般 1～3 段。",
    "不加“根据资料”“我来帮你”等铺垫。"
  ].join(""),
  KNOWLEDGE: [
    "KNOWLEDGE：先给结论或关键要求，再列关键点，最后给依据（资料名称 / 章节 / 页码）。",
    "资料不足时写：目前资料里还没有足够依据确定这一点。",
    "不要写为什么泛查不好、为什么标准很多、检索策略。"
  ].join(""),
  PRODUCT: [
    "PRODUCT：直接结论，再列主要特点。有依据则展示。",
    "用户只输入产品名且无法判断意图时问：你想了解 VICP 的哪一方面？可以看性能、适用场景、产品优势，或者和其他产品做对比。"
  ].join(""),
  COMPARISON: [
    "COMPARISON：只写核心差异（各方一两点），资料不足的部分单独说明。",
    "结构化表格或卡片走独立通道，不要把全部原始参数重复写进正文。"
  ].join(""),
  REFERENCE_LOOKUP: [
    "REFERENCE_LOOKUP：查询已发布图集 / 参考选用表 / 已知档位，不是正式热工计算。",
    "结构化参考表有命中时：第一行回答“有”，只使用表中的数值。不要把构造层表格再用 Markdown 重写，页面由系统单独展示。",
    "结构化参考表未命中时：不要立刻说没有方案；继续检索知识库/图集原文。知识检索有出处时可以列方案，并说明依据来自图集或资料。",
    "表和知识库都没有可核验出处时，才说暂未找到。禁止编造档位或 K 值，也不要把示例数字写进回答。",
    "不要把地区、气候区、建筑类型、基层、厚度当作查询前置条件。不要展开完整热工公式。",
    "后续若要判断是否达标，再进入正式热工计算。"
  ].join(""),
  THERMAL: [
    "THERMAL：正式计算、项目级判断或限值/合规判断。有结果时先给核心结果，再给最多 2～3 个解释点；详细计算过程只有用户要求时展开。",
    "没有结果时写：目前还没有热工计算结果，这部分暂时不参与比较。",
    "只有当前计算确实缺少方案、规格、厚度或合规所需地区时才追问；不要把查已有参考方案所需条件与计算前置条件混用。",
    "不要开头堆砌全部型号区间，除非这些数据就是当前问题所必需。"
  ].join(""),
  CLARIFY: [
    "CLARIFY：只有缺失信息会阻止可靠回答时才澄清。",
    "只问一个短问题，例如：你想查哪个方向：外墙保温、屋面、门窗，还是某个具体构造节点？",
    "可以先给已有结果，最后只问 1 个最关键补充条件。不要一上来列 3～5 个问题，也不要解释泛查不好。"
  ].join("")
};

export function formatAnswerContractPrompt(contract: AnswerContract): string {
  return [
    "【最终答案形态】",
    "只约束最终给用户看的答案形态，不是 Agent 类型，也不描述内部执行过程。",
    `当前合同：${contract}`,
    "",
    CONTRACT_SHAPES[contract],
    "",
    "仅当当前合同的执行前置条件明确缺失，且没有可先返回的可靠结果时，才改用 CLARIFY：只问 1 个最关键条件。"
  ].join("\n");
}
