import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

const identitySchema = z.object({ subjectText: z.string().min(1).max(160).nullable(), systemText: z.string().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000)
}).strict();
/** 只校核参数查询的名称角色；数值、单位、比较方式和工程事实不属于此合同。 */
export async function reviewParameterIdentity(model: LanguageModel, message: string, abortSignal: AbortSignal, observe?: (proposal: unknown) => void, alternateEvidenceText?: string) {
  const result = await generateObject({ model, output: "no-schema",
    system: `输出JSON，合同：${JSON.stringify(z.toJSONSchema(identitySchema))}。只提取用户明确给出的产品、规格、材料或体系名称。性质、用途和类别描述不构成具体名称，未指定名称时subjectText/systemText为null。具体但尚未在目录核实的名称、缩写或错拼必须逐字保留，不能因不认识而删除，也不能自动纠正或补正式编号。不得输出数值、参数、正式ID或查询结果。evidence为输入原话的连续片段，confidence仅反映名称角色理解是否可靠。`,
    prompt: message, ...languageModelSamplingOptions("SEMANTIC_QUERY"), maxRetries: 0, abortSignal });
  const identity = identitySchema.parse(result.object);
  observe?.(identity);
  if (identity.confidence < .9 || !message.includes(identity.evidence) && !alternateEvidenceText?.includes(identity.evidence)
    || [identity.subjectText, identity.systemText].some(name => name != null && !message.includes(name))) throw new Error("PARAMETER_IDENTITY_UNRESOLVED");
  return identity;
}
