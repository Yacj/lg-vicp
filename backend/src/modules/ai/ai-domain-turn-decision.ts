import { parseSolutionActionFastPath, normalizeSolutionActionText } from "./solution-action-semantic.js";
import type { LastReferenceLookup } from "./conversation-task.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
export const DOMAIN_INTENTS = ["GENERAL", "KNOWLEDGE_EXPLAIN", "PRODUCT_DISCOVERY", "PRODUCT_DETAIL", "REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "THERMAL_CALCULATE", "COMPLIANCE_CHECK", "MATERIAL_COMPARE", "COMPARE_CANDIDATES", "SOLUTION_ADVICE", "SOLUTION_ACTION", "REPORT_REQUEST", "CLARIFY"] as const;
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
