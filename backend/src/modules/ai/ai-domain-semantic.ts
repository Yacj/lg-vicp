import { z } from "zod";
import { DOMAIN_INTENTS } from "./ai-domain-turn-decision.js";
import { candidateReferenceSchema } from "./solution-action-semantic.js";
import { semanticQuerySchema } from "../thermal/semantic-query.js";
import { productParameterQuerySchema } from "./product-parameter-query.js";
export const domainTurnSemanticSchema = z.object({
  /** 复用现有语义条件合同，只读图集参数查询；不产生方案/计算/报告授权。 */
  pageQuery: semanticQuerySchema.nullable().optional(),
  parameterQuery: productParameterQuerySchema.nullable().optional(),
  productQuery: z.object({ scope: z.enum(["CATALOG", "IDENTITY", "CATEGORY"]), entityText: z.string().min(1).max(200).nullable(),
    granularity: z.enum(["CATALOG", "SERIES", "PRODUCT"]), evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  /** 澄清回复只允许复用服务器核验的紧邻查询原话，不能授权副作用。 */
  queryContext: z.enum(["CURRENT_TURN", "CLARIFICATION_REPLY"]).default("CURRENT_TURN"),
  adviceFocus: z.enum(["SELECTION", "PROS_CONS"]).default("SELECTION"),
  /** 用户自述的表达目标/专业背景：只影响解释深度与用词，不改变事实、置信度或任何授权。 */
  audience: z.enum(["GENERAL", "SALES", "ENGINEER", "UNSPECIFIED"]).default("UNSPECIFIED"),
  intent: z.enum(DOMAIN_INTENTS), confidence: z.number().min(0).max(1), evidence: z.string().max(2000), unresolved: z.string().max(300).nullable(),
  /** 是否要求对计算结果做正式达标/合规判定；只表达目标，不授权标准、适用范围或结论。 */
  complianceCheck: z.object({ required: z.boolean(), evidence: z.string().min(1).max(2000) }).strict().nullable().default(null),
  /** 本轮报告目标；不能由后续Tool参数或旧产品上下文覆盖。 */
  reportType: z.enum(["technical_scheme", "project_brief", "material_compare", "ai_conversation"]).nullable().default(null),
  /** 只表达读取目标；数值、型号、编码和来源均由后端提取/重验。 */
  factRead: z.object({ mode: z.enum(["VERIFY", "COMPARE", "EXPLAIN", "DEFINE"]), metric: z.enum(["K", "TOTAL_R", "PRODUCT_R"]).nullable(),
    historyClaim: z.boolean(), evidence: z.string().min(1).max(2000) }).strict().nullable().default(null),
  relation: z.enum(["NEW", "CONTINUE", "REFINE", "CANCEL", "SWITCH_TOPIC"]),
  continuedGoal: z.object({ recentTurn: z.number().int().min(0).max(1), intent: z.literal("SOLUTION_ADVICE"), evidence: z.string().min(1).max(300) }).strict().nullable().default(null),
  comparison: z.object({ metric: z.enum(["K", "TOTAL_R", "PRODUCT_R"]), direction: z.enum(["MIN", "MAX"]), evidence: z.string().min(1).max(2000) }).strict().nullable(),
  referenceTime: z.enum(["CURRENT", "EARLIER", "UNCERTAIN"]).nullable(),
  adviceMode: z.enum(["GENERAL_REFERENCE", "PRELIMINARY", "PROJECT_SPECIFIC", "OUTLINE"]).nullable(),
  constraintPatch: z.array(z.object({ field: z.enum(["region", "buildingType", "specClass", "thicknessMm", "thicknessMin", "thicknessMax", "metric"]), op: z.enum(["SET", "CLEAR", "KEEP", "EXCLUDE_FROM_THIS_ADVICE"]), value: z.union([z.string().max(100), z.number(), z.null()]), evidence: z.string().min(1).max(2000) }).strict()).max(10),
  reference: z.object({ scope: z.enum(["LAST_VISIBLE_CANDIDATES", "CURRENT_SELECTED", "CURRENT_CONFIRMED", "NONE"]), revision: z.number().int().positive().nullable(),
    items: z.array(z.discriminatedUnion("type", [candidateReferenceSchema.options[0], candidateReferenceSchema.options[1], candidateReferenceSchema.options[2]])).max(12).default([]) }).strict(),
  requestedEffect: z.enum(["READ_ONLY", "QUERY", "STATE_MUTATION", "REPORT_GENERATION", "CALCULATE"]),
  effectRequest: z.object({ direct: z.boolean(), polarity: z.enum(["AFFIRMATIVE", "NEGATED"]), speechAct: z.enum(["REQUEST", "QUOTED", "HYPOTHETICAL", "EXPLANATION"]), evidence: z.string().min(1).max(2000) }).strict().nullable(),
  ambiguity: z.array(z.string().max(300)).max(5)
}).strict();
export type DomainTurnSemantic = z.infer<typeof domainTurnSemanticSchema>;
