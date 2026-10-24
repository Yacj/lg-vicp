import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

const basisSchema = z.object({ basis: z.enum(["CURRENT_CONSTRUCTION", "CURRENT_SEARCH", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000) }).strict();
/** 改厚度时只核对所改对象，不生成查询数值、身份、工程结论或操作权限。 */
export async function reviewReferenceAdjustmentBasis(model: LanguageModel, message: string, abortSignal: AbortSignal,
  current: { label?: string | null; thicknessMm?: number | null }) {
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `输出JSON：${JSON.stringify(z.toJSONSchema(basisSchema))}。用户已查看一套构造，现在查询另一厚度。CURRENT_CONSTRUCTION表示调整刚才那套构造的保温厚度、了解其变化；CURRENT_SEARCH表示保留原筛选条件寻找其他做法或更换构造。不能把前者改成跨构造搜索。evidence必须完整逐字复制本轮原话，保留否定与限定；只评价对象范围，不继承其他分类置信度。不能可靠区分则UNRESOLVED。不得输出编码、ID、新数值、计算参数、事实或方案操作。`,
    prompt: JSON.stringify({ message, current }) });
  const value = basisSchema.safeParse(result.object);
  return value.success && value.data.confidence >= .9 && value.data.evidence.trim() === message.trim()
    && value.data.basis !== "UNRESOLVED" ? value.data.basis : undefined;
}

const readSchema = z.object({ intent: z.enum(["COMPARE_CANDIDATES", "REFERENCE_DETAIL", "REFERENCE_VIEW", "CLARIFY"]),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1), unresolved: z.string().nullable(),
  reference: domainTurnSemanticSchema.shape.reference, comparison: domainTurnSemanticSchema.shape.comparison
}).strict();
/** 独立窄合同只申请读取当前来源；不生成候选/正式身份或任何状态授权。 */
export async function reviewReferenceGoal(model: LanguageModel, message: string, abortSignal: AbortSignal, candidates: unknown, validationFeedback?: { policyReason?: string; unresolved?: string[] }) {
  const result = await generateObject({ model, output: "no-schema",
    system: `输出JSON，合同：${JSON.stringify(z.toJSONSchema(readSchema))}。只理解本轮查看或比较目标，不能执行选择、计算、确认或报告。comparison不是普通比较字段；只有用户明确要求某指标最低或最高时填写，普通并排或条件比较必须null，不能补充排名。所有evidence逐字取连续原话，不改写或拼接。比较当前完整集合且没有单指某行时用LAST_VISIBLE_CANDIDATES及items=[]。自然名称用CANDIDATE_LABEL，value只能复制当前候选label，evidence逐字取用户称呼，可附用户原话厚度和thicknessEvidence。不能从自然名称生成编码、ID或序号。CONSTRUCTION_CODE必须逐字出现在用户原话；POSITION必须有原话序号。当前已选/已确认方案按对应scope读取，不能借旧序号。不能唯一理解则CLARIFY。`,
    prompt: JSON.stringify({ message, candidates, validationFeedback }), ...languageModelSamplingOptions("SEMANTIC_QUERY"), abortSignal, maxRetries: 0 });
  const read = readSchema.parse(result.object);
  return { ...result, object: domainTurnSemanticSchema.parse({ ...read, relation: "CONTINUE", referenceTime: "CURRENT", adviceMode: null,
    constraintPatch: [], requestedEffect: "READ_ONLY", effectRequest: null, ambiguity: [] }) };
}
