import type { UatExpect, UatTurn } from "../schema.js";
import { HARD_FAIL_RULES } from "../schema.js";
export const filter = (metric: "K" | "TOTAL_R" | "PRODUCT_R", mode: "APPROX" | "MAX_LIMIT" | "MIN_LIMIT" | "EXACT", targetValue: number) => ({ metric, mode, targetValue });
export const kApprox = [filter("K", "APPROX", 0.3)];
export const kMax = [filter("K", "MAX_LIMIT", 0.3)];
export function turn(user: string, expect: Partial<UatExpect> = {}): UatTurn {
  return { user, expect: { intent: "REFERENCE_LOOKUP", toolsAny: ["thermal"], operation: "LOOKUP_CANDIDATES", hardFailRules: [...HARD_FAIL_RULES], ...expect } };
}
export const page = (user = "刚才第一个图集哪一页？") => turn(user, { reusePreviousCandidate: true, referencePageRequired: true, resultType: "REFERENCE" });
export const knowledge = (user: string, expect: Partial<UatExpect> = {}) => turn(user, { intent: "PRODUCT_CONSULTATION", toolsAny: ["search_knowledge", "get_product_data"], operation: undefined, ...expect });
export const calculate = (user: string, expect: Partial<UatExpect> = {}) => turn(user, { intent: "THERMAL", toolsAny: ["thermal"], operation: "CALCULATE", resultType: "CALCULATED", ...expect });
