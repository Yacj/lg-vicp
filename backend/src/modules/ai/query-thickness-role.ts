import { z } from "zod";
import { generateObject, type LanguageModel } from "ai";
import type { SemanticQuery } from "../thermal/semantic-query.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

const roleSchema = z.object({ items: z.array(z.object({ constraintIndex: z.number().int().min(0).max(23),
  role: z.enum(["SUBSTRATE", "INSULATION", "UNRESOLVED"]), confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000)
}).strict()).max(24) }).strict();

/** 提案同时包含基层材料和未区分归属的厚度时，不能默认把该数值当保温板厚。 */
export function needsThicknessRoleReview(query: SemanticQuery) {
  return query.constraints.some(item => item.type === "ENTITY" && item.field === "substrateMaterial")
    && !query.constraints.some(item => item.field === "substrateThickness")
    && query.constraints.some(item => item.type === "THICKNESS" && item.field == null && item.operation !== "REMOVE");
}

/** 只调整已提取标量的字段角色；值、运算符、身份及授权均不能由复核生成。 */
export function bindThicknessRoles(message: string, query: SemanticQuery, raw: unknown): SemanticQuery | undefined {
  const parsed = roleSchema.safeParse(raw);
  const indexes = query.constraints.flatMap((item, index) => item.type === "THICKNESS" && item.field == null && item.operation !== "REMOVE" ? [index] : []);
  if (!parsed.success || parsed.data.items.length !== indexes.length || new Set(parsed.data.items.map(item => item.constraintIndex)).size !== indexes.length) return undefined;
  const constraints = [...query.constraints];
  for (const item of parsed.data.items) {
    const original = constraints[item.constraintIndex];
    if (!indexes.includes(item.constraintIndex) || !original || item.confidence < .9 || item.role === "UNRESOLVED"
      || !message.includes(item.evidence) || !message.includes(original.evidence)
      || !item.evidence.includes(original.evidence) && !original.evidence.includes(item.evidence)) return undefined;
    constraints[item.constraintIndex] = { ...original, field: item.role === "SUBSTRATE" ? "substrateThickness" : null, evidence: item.evidence };
  }
  return { ...query, constraints };
}

export async function reviewQueryThicknessRoles(model: LanguageModel, message: string, query: SemanticQuery, abortSignal: AbortSignal) {
  try {
    const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
      ...languageModelSamplingOptions("SEMANTIC_QUERY"),
      system: `仅核对已提取厚度数值属于哪个对象，输出JSON：${JSON.stringify(z.toJSONSchema(roleSchema))}。SUBSTRATE指墙体/楼板/基层材料厚度，INSULATION指保温板或保温档位厚度。逐项保持原输入索引，不能输出新数值、单位、运算符、身份、公式或操作。evidence逐字取包含该数值和对象归属的连续原话；不能从同值的另一处取证。未能区分板厚、芯材厚、基层厚时UNRESOLVED，不能猜测或提高置信度。`,
      prompt: JSON.stringify({ message, constraints: query.constraints.map((item, constraintIndex) => ({ constraintIndex, ...item })) }) });
    return bindThicknessRoles(message, query, result.object);
  } catch { return undefined; }
}
