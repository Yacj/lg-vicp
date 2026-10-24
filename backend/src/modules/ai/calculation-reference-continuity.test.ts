import "dotenv/config";
import { expect, it } from "vitest";
import { referenceQueryFromCalculationProposal } from "./calculation-authorization.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
const proposal = (value = 47) => domainSemanticFixture(`同一做法改成${value}mm，看看资料里的效果`, "THERMAL_CALCULATE", {
  reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 2, items: [] },
  calculationRequest: { schemeId: null, productSpecId: null, targetLayerId: null, mode: null, thicknessMm: value, evidence: `改成${value}mm`, thicknessEvidence: `${value}mm` },
  constraintPatch: [{ field: "thicknessMm", op: "SET", value, evidence: `${value}mm` }]
});
it("目标修正为只读查询后保留已提取的厚度和旧范围，仍由正式Query校验", () => {
  const p = proposal(), semantic = referenceQueryFromCalculationProposal(p)!;
  const query = applySemanticQuery(p.evidence, semantic, { entities: [], aliases: [] }, { schemeId: "actual-scheme", filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: .28 }] });
  expect(query).toMatchObject({ schemeId: "actual-scheme", thicknessMm: 47, filters: [{ metric: "K", targetValue: .28 }] });
  expect(query.unresolved).toEqual([]);
});
it("不丢弃额外输入；单位/数值缺乏原话证据仍被拒绝", () => {
  expect(referenceQueryFromCalculationProposal({ ...proposal(), constraintPatch: [{ field: "thicknessMin", op: "SET", value: 20, evidence: "20mm" }] })).toBeUndefined();
  expect(referenceQueryFromCalculationProposal({ ...proposal(), relation: "SWITCH_TOPIC" })).toBeUndefined();
  const p = proposal(), semantic = referenceQueryFromCalculationProposal(p)!;
  semantic.constraints[0]!.value = 62;
  expect(applySemanticQuery(p.evidence, semantic, { entities: [], aliases: [] }, {}).unresolved?.length).toBeGreaterThan(0);
});
