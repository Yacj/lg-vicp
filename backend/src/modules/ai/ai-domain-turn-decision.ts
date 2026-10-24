import { parseSolutionActionFastPath, normalizeSolutionActionText } from "./solution-action-semantic.js";
import type { LastReferenceLookup } from "./conversation-task.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
export const DOMAIN_INTENTS = ["GENERAL", "KNOWLEDGE_EXPLAIN", "PRODUCT_DISCOVERY", "PRODUCT_DETAIL", "PRODUCT_PARAMETER_QUERY", "REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "THERMAL_CALCULATE", "COMPLIANCE_CHECK", "MATERIAL_COMPARE", "COMPARE_CANDIDATES", "SOLUTION_ADVICE", "SOLUTION_ACTION", "REPORT_REQUEST", "CLARIFY"] as const;
export type DomainIntent = typeof DOMAIN_INTENTS[number];
export interface DomainTurnDecision {
  intent: DomainIntent;
  mutation: "NONE" | "QUERY" | "SOLUTION" | "CALCULATE" | "REPORT";
  referenceScope?: "LATEST_VISIBLE" | "CURRENT_SELECTED" | "CURRENT_CONFIRMED";
  evidenceSpans: string[];
  parserSource?: "FAST_PATH" | "LLM" | "UNAVAILABLE";
  unresolved?: string[];
  referenceQueryKind?: "REFERENCE_COMPARISON" | "REFERENCE_PARAMETERS";
  semantic?: DomainTurnSemantic;
  requiresCandidateQuery?: boolean;
  restoreAdviceGoal?: boolean;
  policyReason?: string;
  /** Backend字段校验失败的位置；仅用于限定只读字段复核范围，不来自模型。 */
  queryValidationFields?: string[];
  /** 新AI指标查询采用V2，模型与客户端不能指定旧合同以放宽边界。 */
  queryContractVersion?: 1 | 2;
  /** 仅服务器绑定的只读查询证据，原用户消息及副作用授权仍独立。 */
  queryEvidenceText?: string;
  queryContextMessageId?: string;
  /** 属性读取重验待澄清上下文时排除本轮USER消息，仅由服务器填充。 */
  queryCurrentMessageId?: string;
  /** 续问产品身份只绑定服务器核验的紧邻产品读取记录。 */
  productContextMessageId?: string;
  productReadContext?: { query: NonNullable<DomainTurnSemantic["productQuery"]>; parameterFocus?: unknown; createdAt: string };
  parameterContextMessageId?: string;
  parameterReadContext?: { query: import("./product-parameter-query.js").ProductParameterQuery;
    diagnostics: import("./product-parameter-diagnostics.js").ParameterDiagnostics; createdAt: string };
  /** 仅由服务端读取的有效澄清链，供本轮继续澄清持久化；模型不能提供。 */
  pendingQuery?: import("./query-need.js").QueryClarification;
  /** 中等置信的查询提案经完整条件校验后仅展示事实，不发布/覆盖Candidate。 */
  queryResultMode?: "FACTS_ONLY";
  /** Backend依据实际读取历史绑定，不来自模型；仍需当前来源/Revision校验。 */
  referenceFocusIds?: string[];
  queryBase?: import("../thermal/thermal-query-state.js").ThermalQueryState;
}
/** 内部合同构造器不等于授权；模型输出只能经applyDomainPolicy进入执行路径。 */
export function domainDecision(intent: DomainIntent, evidence: string): DomainTurnDecision {
  return { intent, mutation: intent === "SOLUTION_ACTION" ? "SOLUTION" : intent === "THERMAL_CALCULATE" ? "CALCULATE" : intent === "REPORT_REQUEST" ? "REPORT" : intent === "REFERENCE_QUERY" || intent === "REFERENCE_REFINE" ? "QUERY" : "NONE", evidenceSpans: evidence ? [evidence] : [], parserSource: "FAST_PATH" };
}
const greetings = new Set(["你好", "您好", "嗨", "哈喽", "在吗", "hello", "hi", "谢谢", "好的", "明白了", "知道了"]);
export const isClosedGreeting = (message: string) => greetings.has(normalizeSolutionActionText(message).toLowerCase());
/** 封闭完整命令之外一律未知。同步Tool回退不能猜自然语言权限。 */
export function decideDomainTurn(message: string, _last?: Pick<LastReferenceLookup, "query" | "candidates"> | null): DomainTurnDecision {
  if (parseSolutionActionFastPath(message)) return { ...domainDecision("SOLUTION_ACTION", message), policyReason: "CLOSED_COMMAND" };
  return { ...domainDecision("GENERAL", message), policyReason: isClosedGreeting(message) ? "CLOSED_GREETING" : "SEMANTIC_REQUIRED" };
}
export const isReferenceRead = (decision: DomainTurnDecision) => decision.intent === "REFERENCE_VIEW" || decision.intent === "REFERENCE_DETAIL";
