import "dotenv/config";
import { expect, it } from "vitest";
import { bindThicknessRoles, needsThicknessRoleReview } from "./query-thickness-role.js";
import { applySemanticQuery, type SemanticQuery } from "../thermal/semantic-query.js";

const query = (): SemanticQuery => ({ intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, preferences: [], unresolved: [], constraints: [
  { type: "ENTITY", operation: "SET", field: "substrateMaterial", entityText: "钢筋混凝土", resolvedText: null, metric: null, operator: null, value: null, evidence: "钢筋混凝土", hard: true, confidence: .95 },
  { type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 180, evidence: "180mm", hard: true, confidence: .95 }
] });
const text = "查180mm钢筋混凝土基层的参考做法";
const role = { constraintIndex: 1, role: "SUBSTRATE", confidence: .95, evidence: "180mm钢筋混凝土基层" };
it("基层数值不能作为板厚筛选；复核只改归属，完整Query继续验证数值和原话", () => {
  const original = query(), before = structuredClone(original);
  expect(needsThicknessRoleReview(original)).toBe(true);
  const bound = bindThicknessRoles(text, original, { items: [role] })!;
  const actual = applySemanticQuery(text, bound, { aliases: [], entities: [{ field: "substrateMaterial", value: "钢筋混凝土", names: ["钢筋混凝土"] }] });
  expect(actual.substrateThickness).toBe(180); expect(actual.thicknessMm).toBeUndefined(); expect(actual.unresolved).toEqual([]);
  expect(original).toEqual(before); expect(bound.confidence).toBe(original.confidence);
});
it("确实是板厚时不改成基层厚，不能把不同对象的同一数值相互代换", () => {
  const message = "钢筋混凝土基层，采用180mm保温板", original = query();
  const result = bindThicknessRoles(message, original, { items: [{ ...role, role: "INSULATION", evidence: "180mm保温板" }] })!;
  expect(result.constraints[1]?.field).toBeNull(); expect(result.constraints[1]?.value).toBe(180);
});
it.each(["confidence", "evidence", "unknown", "duplicate", "index", "extra-value"])("%s不签发数值归属，查询必须继续澄清", kind => {
  const raw = { items: [{ ...role }] };
  if (kind === "confidence") raw.items[0]!.confidence = .89;
  if (kind === "evidence") raw.items[0]!.evidence = "180mm保温板";
  if (kind === "unknown") raw.items[0]!.role = "UNRESOLVED";
  if (kind === "duplicate") raw.items.push({ ...role });
  if (kind === "index") raw.items[0]!.constraintIndex = 0;
  expect(bindThicknessRoles(text, query(), kind === "extra-value" ? { ...raw, value: 200 } : raw)).toBeUndefined();
});
it("已经明确基层厚度、没有基层条件或仅删除厚度时，不重复申请角色复核", () => {
  const known = query(); known.constraints[1]!.field = "substrateThickness"; expect(needsThicknessRoleReview(known)).toBe(false);
  const board = query(); board.constraints.shift(); expect(needsThicknessRoleReview(board)).toBe(false);
  const remove = query(); remove.constraints[1]!.operation = "REMOVE"; expect(needsThicknessRoleReview(remove)).toBe(false);
});
