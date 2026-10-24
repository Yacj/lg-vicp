import { z } from "zod";
import { generateObject, type LanguageModel } from "ai";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";
import { domainTurnSemanticSchema, type DomainTurnSemantic } from "./ai-domain-semantic.js";
import { semanticQuerySchema, type SemanticQuery } from "../thermal/semantic-query.js";
const calculationGoalSchema = z.object({
  intent: z.enum(["THERMAL_CALCULATE", "REFERENCE_REFINE", "COMPARE_CANDIDATES", "CLARIFY"]), confidence: z.number().min(0).max(1),
  evidence: z.string().min(1).max(2000), effectRequest: domainTurnSemanticSchema.shape.effectRequest,
  pageQuery: semanticQuerySchema.nullable().optional(),
  queryBasis: domainTurnSemanticSchema.shape.queryBasis,
  unresolved: z.string().nullable()
}).strict();

/** 目标被复核为查资料时，迁移已存在的输入提案；原话、单位、范围仍由同一个Query校验器核验。 */
export function referenceQueryFromCalculationProposal(proposal: DomainTurnSemantic): SemanticQuery | undefined {
  const input = proposal.calculationRequest;
  if (!input?.thicknessMm || !input.thicknessEvidence || proposal.relation !== "CONTINUE" && proposal.relation !== "REFINE"
    || proposal.constraintPatch.some(patch => patch.field !== "thicknessMm" || patch.op !== "SET" || patch.value !== input.thicknessMm)) return undefined;
  return { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: proposal.confidence,
    constraints: [{ type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null,
      operator: "EXACT", value: input.thicknessMm, evidence: input.thicknessEvidence, hard: true, confidence: proposal.confidence }],
    preferences: [], unresolved: [], readFields: ["kValue", "productThermalResistance", "totalThermalResistance"] };
}

/** 仅复核操作目标与原话授权，不修正计算身份或输入；完整Policy与执行前来源核验仍须通过。 */
export async function reviewCalculationGoal(model: LanguageModel, message: string, abortSignal: AbortSignal, proposal: DomainTurnSemantic,
  context?: { pendingMessage?: string; publishedSourceSets?: unknown; candidates?: unknown }) {
  const result = await generateObject({ model, output: "no-schema",
    system: `复核本轮是在索取已有资料，还是明确要求新的热工运算。输出JSON，合同：${JSON.stringify(z.toJSONSchema(calculationGoalSchema))}。用户问改变条件后的参考效果、但没有明确要求重新算时，可先REFERENCE_REFINE查询已有档位，pageQuery只提本轮明确的新条件、queryMode=REFINE_QUERY，旧条件由Backend保留；不能补工程实值或保证资料存在。假设施工条件的问句仍可以是真实的资料查询请求；被否定、引用或仅讨论将来查询的行为不能执行。只有明确索取新运算结果/过程才THERMAL_CALCULATE，此时pageQuery=null，不修改原calculationRequest。读取、比较、选择已有示例不授权计算。不得输出任何ID。无法明确目标则CLARIFY。evidence逐字取本轮原话，副作用effectRequest.evidence必须完整保留本轮原话；查询可effectRequest=null。`,
    prompt: JSON.stringify({ message, context, instruction: "比较已有两套或多套输入/结果时用COMPARE_CANDIDATES，不能改为只查询其中一个厚度。REFERENCE_REFINE必须填写pageQuery及本轮已明确的条件；仅说查看示例不授权计算，也不要求用户重复已明确的基层或来源。" }), ...languageModelSamplingOptions("SEMANTIC_QUERY"), maxRetries: 0, abortSignal });
  const goal = calculationGoalSchema.parse(result.object);
  // 复核确认读取目标后，缺少查询字段不能直接作为可执行合同，也不能从单一计算输入猜完整查询。
  // 窄字段提取只能提出只读条件；后续原Policy、grounding、来源及条件覆盖仍完整执行。
  if (goal.intent === "REFERENCE_REFINE" && !goal.pageQuery) {
    const extracted = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
      ...languageModelSamplingOptions("SEMANTIC_QUERY"),
      system: `仅提取已确认的只读参考查询条件，输出JSON：${JSON.stringify(z.toJSONSchema(semanticQuerySchema))}。intent=REFERENCE_LOOKUP。不能计算、选择或生成正式身份。基层厚度用THICKNESS/field=substrateThickness，板厚field=null；不能混淆。每项evidence逐字来自输入用户原话。只读取已有参数不添加METRIC目标。来源仅可绑定输入发布来源中唯一对应项，无法对应保留unresolved。未指定的体系、型号、板厚不是缺项。pendingMessage若有，保留其未被本轮明确替换的条件；数值、范围和否定不能丢弃。`,
      prompt: JSON.stringify({ message, ...context }) });
    goal.pageQuery = semanticQuerySchema.parse(extracted.object);
  }
  const comparison = goal.intent === "COMPARE_CANDIDATES";
  return { ...result, object: domainTurnSemanticSchema.parse({ ...proposal, ...goal,
    requestedEffect: goal.intent === "THERMAL_CALCULATE" ? "CALCULATE" : goal.intent === "REFERENCE_REFINE" ? "QUERY" : "READ_ONLY",
    reference: comparison ? { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] }
      : goal.intent === "REFERENCE_REFINE" ? { scope: "NONE", revision: null, items: [] } : proposal.reference,
    relation: comparison ? "CONTINUE" : proposal.relation,
    referenceTime: comparison ? "CURRENT" : proposal.referenceTime,
    referenceReadFields: comparison ? ["layers", "kValue", "notes"] : proposal.referenceReadFields,
    pageQuery: goal.intent === "REFERENCE_REFINE" ? goal.pageQuery : null,
    queryBasis: comparison ? null : goal.queryBasis ?? null,
    constraintPatch: goal.intent === "THERMAL_CALCULATE" ? proposal.constraintPatch : [],
    calculationRequest: goal.intent === "THERMAL_CALCULATE" ? proposal.calculationRequest : null }) };
}
export const calculationAuthorizationSchema = z.object({
  operation: z.enum(["CALCULATE", "READ_REFERENCE", "SELECT_SOLUTION", "COMPARE_REFERENCE", "EXPLAIN", "UNCLEAR"]),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000)
}).strict();
/** 正式计算的独立窄目标核验，不读取工程参数、不选择模型、不按关键词授予执行权限。 */
export async function reviewCalculationAuthorization(model: LanguageModel, message: string, abortSignal: AbortSignal) {
  const result = await generateObject({ model, output: "no-schema",
    system: `仅核验用户本轮是否要求实际进行新的热工运算。读取或采用已有示例是READ_REFERENCE，比较现有输入和结果是COMPARE_REFERENCE，选择或设定最终方案是SELECT_SOLUTION，解释一般原理是EXPLAIN。只有明确要求计算新结果或给定构造的实际计算过程才CALCULATE。资料标题、方法名称和厚度本身不授权重新计算。保留否定、引用和假设；不能明确区分则UNCLEAR。evidence必须逐字取本轮原话。输出JSON，合同：${JSON.stringify(z.toJSONSchema(calculationAuthorizationSchema))}`,
    prompt: message, ...languageModelSamplingOptions("SEMANTIC_QUERY"), abortSignal, maxRetries: 0 });
  const value = calculationAuthorizationSchema.parse(result.object);
  return message.includes(value.evidence) && value.confidence >= .9 ? value.operation : "UNCLEAR";
}
