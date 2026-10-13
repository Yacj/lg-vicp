import { describe, expect, it } from "vitest";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { resolveAnswerContract } from "../../shared/ai-answer-contract.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const last = { query: {}, candidates: [] };
describe("已分类语义提案与写入授权分层（非模型理解验收）", () => {
  it.each([
    ["你好", "GENERAL", "NONE"], ["K值是什么意思", "KNOWLEDGE_EXPLAIN", "NONE"],
    ["图集里的热工计算表在哪页", "KNOWLEDGE_EXPLAIN", "NONE"],
    ["这个数据来源哪页", "REFERENCE_VIEW", "NONE"], ["第一个完整表格", "REFERENCE_VIEW", "NONE"],
    ["A3-2 参数", "REFERENCE_DETAIL", "NONE"], ["18mm那个参数", "REFERENCE_DETAIL", "NONE"],
    ["第一个45mm原页", "REFERENCE_VIEW", "NONE"], ["第三个传热系数", "REFERENCE_DETAIL", "NONE"], ["这个K怎么算", "REFERENCE_DETAIL", "NONE"],
    ["那改为20mm以内", "REFERENCE_REFINE", "QUERY"], ["取消厚度限制", "REFERENCE_REFINE", "QUERY"],
    ["屋面K0.2左右有哪些方案", "REFERENCE_QUERY", "QUERY"], ["第一个留下", "SOLUTION_ACTION", "SOLUTION"],
    ["前两个加进方案", "SOLUTION_ACTION", "SOLUTION"], ["确认最终方案", "SOLUTION_ACTION", "SOLUTION"],
    ["第一个和第三个区别", "COMPARE_CANDIDATES", "NONE"], ["比较已选方案", "COMPARE_CANDIDATES", "NONE"],
    ["上海住宅K≤0.3是否达标", "COMPLIANCE_CHECK", "NONE"], ["这个方案可以用吗", "COMPLIANCE_CHECK", "NONE"],
    ["帮我算第一个方案", "THERMAL_CALCULATE", "CALCULATE"], ["你们都有什么VICP产品", "PRODUCT_DISCOVERY", "NONE"],
    ["窗洞口做法在哪页", "KNOWLEDGE_EXPLAIN", "NONE"], ["生成工程报告", "REPORT_REQUEST", "REPORT"],
    ["第一个和第三个比较并留下第一个", "CLARIFY", "NONE"]
  ])("%s → %s", (message, intent, mutation) => {
    expect(applyDomainPolicy(message!, domainSemanticFixture(message!, intent as any))).toMatchObject({ intent, mutation });
  });
  it("合规回答合同不签发计算授权", () => {
    expect(resolveAnswerContract({ message: "上海住宅K≤0.3是否达标", domainDecision: domainDecision("COMPLIANCE_CHECK", "上海住宅K≤0.3是否达标"),
      capabilities: { needThermalTool: true } })).toBe("KNOWLEDGE");
  });
  it.each([
    ["总热阻", "CLARIFY"], ["那整墙热阻呢", "CLARIFY"], ["看看产品热阻", "CLARIFY"],
    ["保温板热阻和总热阻的区别", "KNOWLEDGE_EXPLAIN"], ["产品R与整墙R有什么不同", "KNOWLEDGE_EXPLAIN"],
    ["用同一厚度哪个好", "COMPARE_CANDIDATES"], ["相同板厚哪种更好", "COMPARE_CANDIDATES"],
    ["第一个的总热阻", "REFERENCE_DETAIL"], ["总热阻接近4的有哪些", "REFERENCE_QUERY"]
  ])("已复现及同类省略问句：%s", (message, intent) => {
    const previous = { query: { filters: [{ metric: "K" as const, targetValue: .3, mode: "APPROX" as const }] },
      candidates: [{ id: "concrete", thicknessMm: 45, substrateMaterial: "钢筋混凝土" }, { id: "aac", thicknessMm: 45, substrateMaterial: "加气混凝土" }] };
    const before = structuredClone(previous);
    expect(applyDomainPolicy(message!, domainSemanticFixture(message!, intent as any), { taskType: "GENERAL", lastReferenceLookup: previous } as any)).toMatchObject({ intent, mutation: intent === "REFERENCE_QUERY" ? "QUERY" : "NONE" });
    expect(previous).toEqual(before);
  });
});
