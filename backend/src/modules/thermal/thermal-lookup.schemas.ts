import { z } from "zod";
import { THERMAL_LOOKUP_METRICS, THERMAL_LOOKUP_MODES } from "./thermal-lookup-mode.js";

/** API / Tool / 会话 JSON 共用指标条件校验；多条件默认 AND。 */
export const thermalLookupFilterSchema = z.object({
  metric: z.enum(THERMAL_LOOKUP_METRICS),
  targetValue: z.number().positive().max(100),
  mode: z.enum(THERMAL_LOOKUP_MODES).optional(),
  tolerance: z.number().positive().max(100).optional()
}).refine((filter) => filter.metric !== "K" || filter.targetValue <= 10,
  { message: "目标 K 不能超过 10", path: ["targetValue"] });

export const normalizedThermalLookupFilterSchema = thermalLookupFilterSchema.safeExtend({
  toleranceSource: z.enum(["USER", "DEFAULT"]).optional(),
  requestedTolerance: z.number().positive().finite().optional(),
  effectiveTolerance: z.number().positive().finite().optional(),
  toleranceAdjusted: z.boolean().optional()
});
