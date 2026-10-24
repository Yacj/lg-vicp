import { z } from "zod";
import { DOMAIN_INTENTS } from "./ai-domain-turn-decision.js";
import { candidateReferenceSchema } from "./solution-action-semantic.js";
import { semanticQuerySchema } from "../thermal/semantic-query.js";
import { productParameterQuerySchema } from "./product-parameter-query.js";
import { confirmedPageReadFieldSchema } from "../../shared/confirmed-page-query.js";
export const domainTurnSemanticSchema = z.object({
  /** 动作目标与候选身份分开；没有CONFIRM，Backend仍独立核验整句授权。 */
  solutionOperation: z.enum(["SELECT", "ADD", "REMOVE", "SET_FINAL", "COMPARE_SELECTED", "KEEP_CONFLICT", "REMOVE_CONFLICT"]).nullable().optional(),
  /** 用户希望得到的对象，与技术指标及执行路由分别保存；不能用材料参数代替方案。 */
  readGoal: z.enum(["PRODUCTS", "MATERIALS", "SCHEMES", "PARAMETERS"]).nullable().optional(),
  clarificationTarget: z.enum(["METRIC", "PRODUCT_IDENTITY", "SOURCE", "CALC_MODEL", "REFERENCE", "OTHER"]).nullable().optional(),
  /** 仅由 Backend 依据待澄清原问生成的单一客户问题；模型输出不作为授权。 */
  clarificationQuestion: z.string().trim().min(1).max(300).nullable().optional(),
  calculationRead: z.object({ evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  /** 输入厚度作用的模型与目标层；执行前重验身份、发布关系及证据。 */
  calculationRequest: z.object({ schemeId: z.uuid().nullable(), productSpecId: z.uuid().nullable(),
    targetLayerId: z.uuid().nullable(), mode: z.enum(["LAYERED", "EQUIVALENT"]).nullable(),
    thicknessMm: z.number().positive().max(1000).nullable(),
    evidence: z.string().min(1).max(2000), thicknessEvidence: z.string().min(1).max(300).nullable()
  }).strict().nullable().optional(),
  /** 仅解释同会话紧邻参数查询的类别诊断；不重查参数或生成候选。 */
  parameterExplanation: z.object({ evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  /** 只解释紧邻真实合规核验的依据；标准身份及事实由Backend重验。 */
  complianceExplanation: z.object({ evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  /** 复用现有语义条件合同，只读图集参数查询；不产生方案/计算/报告授权。 */
  pageQuery: semanticQuerySchema.nullable().optional(),
  /** 当前已读对象的字段目标，与新查询条件分开。 */
  referenceReadFields: z.array(confirmedPageReadFieldSchema).max(7).nullable().optional(),
  /** 改当前这一套的条件，与重新筛选整个查询范围分别表达；不携带身份或工程值。 */
  queryBasis: z.object({ scope: z.literal("CURRENT_REFERENCE"), evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  parameterQuery: productParameterQuerySchema.nullable().optional(),
  productQuery: z.object({ scope: z.enum(["CATALOG", "IDENTITY", "CATEGORY"]), entityText: z.string().min(1).max(200).nullable(),
    granularity: z.enum(["CATALOG", "SERIES", "PRODUCT"]), evidence: z.string().min(1).max(2000) }).strict().nullable().optional(),
  /** 仅绑定服务器提供的上一轮产品事实；参数名不等于相同参数值。 */
  productContinuation: z.object({
    action: z.enum(["REPHRASE", "PARAMETERS", "EXPLAIN_PARAMETER", "FIND_OTHERS"]),
    field: z.enum(["LAMBDA", "CORRECTION", "THICKNESS"]).nullable(),
    match: z.enum(["READ", "EXACT", "LT", "LTE", "GT", "GTE"]).nullable(),
    evidence: z.string().min(1).max(2000)
  }).strict().nullable().optional(),
  /** 澄清回复只允许复用服务器核验的紧邻查询原话，不能授权副作用。 */
  queryContext: z.enum(["CURRENT_TURN", "CLARIFICATION_REPLY", "PREVIOUS_PARAMETER"]).default("CURRENT_TURN"),
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
    explanationAspect: z.enum(["MEANING", "SCOPE", "RELATIONSHIP"]).optional()
      .describe("仅DEFINE可填：MEANING解释指标是什么，SCOPE区分材料层/完整产品/整构造口径，RELATIONSHIP解释厚度与R/K的定性关系。只提阅读目标，不生成参数或公式。"),
    definitionSubjects: z.array(z.enum(["K", "LAMBDA", "R", "PRODUCT_R", "TOTAL_R"])).min(1).max(5).optional()
      .describe("仅DEFINE可填，保留本轮实际解释的全部概念及先后顺序。未明口径的R用R，不擅指为产品或整构造；多个概念不能仅用metric=null丢失对象。不是查询条件或旧工程参数。"),
    historyClaim: z.boolean(), evidence: z.string().min(1).max(2000) }).strict().nullable().default(null),
  relation: z.enum(["NEW", "CONTINUE", "REFINE", "CANCEL", "SWITCH_TOPIC"]),
  continuedGoal: z.object({ recentTurn: z.number().int().min(0).max(1), intent: z.literal("SOLUTION_ADVICE"), evidence: z.string().min(1).max(300) }).strict().nullable().default(null),
  comparison: z.object({ metric: z.enum(["K", "TOTAL_R", "PRODUCT_R"]), direction: z.enum(["MIN", "MAX"]), evidence: z.string().min(1).max(2000) }).strict().nullable()
    .describe("仅用户明确要求某指标最低/最高时填写极值目标；普通并排、参数或输入条件比较必须null。evidence只能逐字取本轮连续原话，不能改写、拼接或补充比较方向。"),
  referenceTime: z.enum(["CURRENT", "EARLIER", "UNCERTAIN"]).nullable(),
  adviceMode: z.enum(["GENERAL_REFERENCE", "PRELIMINARY", "PROJECT_SPECIFIC", "OUTLINE"]).nullable(),
  constraintPatch: z.array(z.object({ field: z.enum(["region", "buildingType", "specClass", "thicknessMm", "thicknessMin", "thicknessMax", "metric"]), op: z.enum(["SET", "CLEAR", "KEEP", "EXCLUDE_FROM_THIS_ADVICE"]), value: z.union([z.string().max(100), z.number(), z.null()]), evidence: z.string().min(1).max(2000) }).strict()).max(10),
  reference: z.object({ scope: z.enum(["LAST_VISIBLE_CANDIDATES", "CURRENT_SELECTED", "CURRENT_CONFIRMED", "NONE"]), revision: z.number().int().positive().nullable().describe("仅能复制candidates.revision，不是solutionState.stateVersion；不涉及候选序号时可null"),
    items: z.array(z.discriminatedUnion("type", [candidateReferenceSchema.options[0], candidateReferenceSchema.options[1], candidateReferenceSchema.options[2], candidateReferenceSchema.options[6], candidateReferenceSchema.options[7]])).max(12).default([])
      .describe("SOLUTION_ACTION固定空数组，具体引用由独立动作Parser核验；只读请求才给本轮逐字编号、序号或厚度") }).strict(),
  requestedEffect: z.enum(["READ_ONLY", "QUERY", "STATE_MUTATION", "REPORT_GENERATION", "CALCULATE"]),
  effectRequest: z.object({ direct: z.boolean(), polarity: z.enum(["AFFIRMATIVE", "NEGATED"]), speechAct: z.enum(["REQUEST", "QUOTED", "HYPOTHETICAL", "EXPLANATION"]), evidence: z.string().min(1).max(2000)
    .describe("副作用请求必须逐字保留完整本轮原话，包括否定、引用、假设及限定；不能只摘取局部肯定短语。") }).strict().nullable(),
  ambiguity: z.array(z.string().max(300)).max(5)
}).strict();
export type DomainTurnSemantic = z.infer<typeof domainTurnSemanticSchema>;

/** 无新条件的当前集合极值读取，可由模型表示成REFINE；归一后仍走完整Policy/来源重验。 */
export function normalizeCurrentComparison(semantic: DomainTurnSemantic): DomainTurnSemantic {
  const page = semantic.pageQuery;
  const queryShape = semantic.intent === "REFERENCE_REFINE" && semantic.requestedEffect === "QUERY" && !!semantic.comparison && !!page;
  const readShape = semantic.intent === "COMPARE_CANDIDATES" && semantic.requestedEffect === "READ_ONLY" && !page;
  if (!queryShape && !readShape || semantic.queryBasis || semantic.queryContext !== "CURRENT_TURN"
    || semantic.relation !== "REFINE" && semantic.relation !== "CONTINUE" || semantic.confidence < .9
    || page && (page.queryMode !== "REFINE_QUERY" || page.confidence < .9
      || page.constraints.length || page.unresolved.length || page.sourceScope
      || page.preferences.some(preference => !preference.enabled || preference.evidence !== semantic.comparison?.evidence
        || !(preference.field === "preferLowerK" && semantic.comparison?.metric === "K" && semantic.comparison.direction === "MIN"
          || preference.field === "preferHigherR" && semantic.comparison?.metric !== "K" && semantic.comparison?.direction === "MAX"))
      || page.readFields?.some(field => field !== "kValue" && field !== "productThermalResistance" && field !== "totalThermalResistance" && field !== "baseMaterial"))
    || semantic.constraintPatch.length || semantic.effectRequest || semantic.ambiguity.length || semantic.unresolved
    || semantic.reference.scope !== "LAST_VISIBLE_CANDIDATES" || semantic.reference.items.length
    || semantic.referenceTime === "EARLIER" || semantic.referenceTime === "UNCERTAIN"
    || semantic.parameterQuery || semantic.productQuery || semantic.productContinuation || semantic.factRead
    || semantic.calculationRead || semantic.calculationRequest || semantic.parameterExplanation || semantic.complianceExplanation
    || semantic.complianceCheck?.required || semantic.reportType || semantic.readGoal && semantic.readGoal !== "SCHEMES") return semantic;
  return { ...semantic, intent: "COMPARE_CANDIDATES", relation: "CONTINUE", requestedEffect: "READ_ONLY", pageQuery: null };
}

/** 当前集合仅改变读取列，不是新筛选或对单个候选改条件。完整原提案仍由调用方校验字段覆盖。 */
export function normalizeCurrentProjection(semantic: DomainTurnSemantic, current?: { thicknesses: number[]; queryScopeCurrent: boolean }): DomainTurnSemantic {
  const page = semantic.pageQuery;
  const duplicateThickness = !!page?.constraints.length && new Set(page.constraints.map(item => item.value)).size === 1
    && page.constraints.every(item => item.type === "THICKNESS" && item.field == null && item.operation === "SET"
      && item.operator === "EXACT" && item.hard && item.value != null && current?.thicknesses.includes(item.value));
  const currentBasis = current?.queryScopeCurrent && semantic.queryBasis?.scope === "CURRENT_REFERENCE";
  if (semantic.intent !== "REFERENCE_REFINE" || semantic.requestedEffect !== "QUERY" || !page
    // 查询输出列不能证明要读取旧集合；只有独立的当前对象读取目标才消除重复查询表示。
    || !semantic.referenceReadFields?.length
    || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE" || semantic.queryContext !== "CURRENT_TURN"
    || semantic.reference.scope !== "LAST_VISIBLE_CANDIDATES" && !(semantic.reference.scope === "NONE" && currentBasis)
    || semantic.referenceTime === "EARLIER" || semantic.referenceTime === "UNCERTAIN"
    || semantic.confidence < .8 || page.confidence < .8 || page.queryMode !== "REFINE_QUERY"
    || page.constraints.length && !duplicateThickness || page.preferences.length || page.unresolved.length || page.sourceScope || !page.readFields?.length
    || semantic.constraintPatch.length || semantic.effectRequest || semantic.ambiguity.length || semantic.unresolved || semantic.comparison
    || semantic.solutionOperation || semantic.factRead || semantic.parameterQuery || semantic.productQuery || semantic.productContinuation
    || semantic.calculationRequest || semantic.calculationRead || semantic.parameterExplanation || semantic.complianceExplanation
    || semantic.complianceCheck?.required || semantic.reportType || semantic.readGoal && semantic.readGoal !== "SCHEMES") return semantic;
  // 重复已核验的当前厚度只作引用；新增指标、范围、来源及不同厚度仍是查询，不在这里删掉。
  const duplicateReferences = duplicateThickness ? page.constraints.filter(item => item.type === "THICKNESS")
    .slice(0, 1).map(item => ({ type: "THICKNESS" as const, value: item.value!, evidence: item.evidence })) : [];
  const items = semantic.reference.items.length ? semantic.reference.items : duplicateReferences;
  const fields = [...new Set([...(semantic.referenceReadFields ?? []), ...page.readFields])];
  return { ...semantic, intent: fields.includes("originalPage") ? "REFERENCE_VIEW" : items.length ? "REFERENCE_DETAIL" : "COMPARE_CANDIDATES",
    relation: "CONTINUE", requestedEffect: "READ_ONLY", pageQuery: null, queryBasis: null,
    referenceTime: currentBasis ? "CURRENT" : semantic.referenceTime,
    reference: { ...semantic.reference, scope: "LAST_VISIBLE_CANDIDATES", items }, referenceReadFields: fields };
}

/** 新条件的查询输出列统一进入pageQuery，不能因宽合同重复填写只读字段而拒绝真实查询。 */
export function normalizeQueryReadFields(semantic: DomainTurnSemantic): DomainTurnSemantic {
  if ((semantic.intent !== "REFERENCE_QUERY" && semantic.intent !== "REFERENCE_REFINE") || semantic.requestedEffect !== "QUERY"
    || !semantic.pageQuery?.constraints.length || !semantic.referenceReadFields?.length) return semantic;
  return { ...semantic, referenceReadFields: null, pageQuery: { ...semantic.pageQuery,
    readFields: [...new Set([...(semantic.pageQuery.readFields ?? []), ...semantic.referenceReadFields])] } };
}
