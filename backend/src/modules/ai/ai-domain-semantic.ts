import { z } from "zod";
import { DOMAIN_INTENTS } from "./ai-domain-turn-decision.js";
export const domainTurnSemanticSchema = z.object({
  intent: z.enum(DOMAIN_INTENTS), confidence: z.number().min(0).max(1), evidence: z.string().max(2000), unresolved: z.string().max(300).nullable(),
  /** 本轮报告目标；不能由后续Tool参数或旧产品上下文覆盖。 */
  reportType: z.enum(["technical_scheme", "project_brief", "material_compare", "ai_conversation"]).nullable().default(null),
  relation: z.enum(["NEW", "CONTINUE", "REFINE", "CANCEL", "SWITCH_TOPIC"]),
  continuedGoal: z.object({ recentTurn: z.number().int().min(0).max(1), intent: z.literal("SOLUTION_ADVICE"), evidence: z.string().min(1).max(300) }).strict().nullable().default(null),
  adviceMode: z.enum(["GENERAL_REFERENCE", "PRELIMINARY", "PROJECT_SPECIFIC", "OUTLINE"]).nullable(),
  constraintPatch: z.array(z.object({ field: z.enum(["region", "buildingType", "specClass", "thicknessMm", "metric"]), op: z.enum(["SET", "CLEAR", "KEEP", "EXCLUDE_FROM_THIS_ADVICE"]), value: z.union([z.string().max(100), z.number(), z.null()]), evidence: z.string().min(1).max(2000) }).strict()).max(10),
  reference: z.object({ scope: z.enum(["LAST_VISIBLE_CANDIDATES", "CURRENT_SELECTED", "NONE"]), revision: z.number().int().positive().nullable(),
    items: z.array(z.object({ type: z.enum(["POSITION", "CONSTRUCTION_CODE", "THICKNESS"]), value: z.union([z.string(), z.number()]), evidence: z.string().min(1) }).strict()).max(12).default([]) }).strict(),
  requestedEffect: z.enum(["READ_ONLY", "QUERY", "STATE_MUTATION", "REPORT_GENERATION", "CALCULATE"]),
  effectRequest: z.object({ direct: z.boolean(), polarity: z.enum(["AFFIRMATIVE", "NEGATED"]), speechAct: z.enum(["REQUEST", "QUOTED", "HYPOTHETICAL", "EXPLANATION"]), evidence: z.string().min(1).max(2000) }).strict().nullable(),
  ambiguity: z.array(z.string().max(300)).max(5)
}).strict();
export type DomainTurnSemantic = z.infer<typeof domainTurnSemanticSchema>;
