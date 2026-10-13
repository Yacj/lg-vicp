import "dotenv/config";
import { describe, expect, it } from "vitest";
import { decideDomainTurn } from "./ai-domain-turn-decision.js";
import { parseSolutionAction } from "./solution-action-semantic.service.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
import { referenceReadFixture } from "./reference-read.fixture.js";
import { resolveVisibleCandidateIds } from "./reference-candidate-selection.js";

// 32条首轮设计题：GENERAL+semantic表示委托模型，不能据此宣称真实语义分类/业务成功。
const cases = [
  { id: "P01", message: "你们主要有哪些保温板？", allowed: ["PRODUCT_DISCOVERY"], semantic: false },
  { id: "P02", message: "VICP板的 I 型、II 型、III 型有什么区别？", allowed: ["PRODUCT_DETAIL", "KNOWLEDGE_EXPLAIN"], semantic: true },
  { id: "P03", message: "你们的板一般有哪些厚度？", allowed: ["PRODUCT_DETAIL"], semantic: true },
  { id: "P04", message: "VICP 能用于外墙吗？", allowed: ["PRODUCT_DETAIL", "KNOWLEDGE_EXPLAIN"], semantic: true },
  { id: "P05", message: "这个板和传统岩棉板相比有什么优势？", allowed: ["MATERIAL_COMPARE"], semantic: true },
  { id: "P06", message: "外墙想做到 K 不超过0.3，有哪些做法？", allowed: ["REFERENCE_QUERY"], semantic: false },
  { id: "P07", message: "有没有比较薄且保温效果好的方案？", allowed: ["REFERENCE_QUERY"], semantic: true },
  { id: "P08", message: "18mm 的板用在外墙，K 大概多少？", allowed: ["REFERENCE_QUERY", "CLARIFY"], semantic: false },
  { id: "P09", message: "A1-3 18mm 的传热系数是多少？", allowed: ["REFERENCE_QUERY", "REFERENCE_DETAIL"], semantic: false },
  { id: "P10", message: "30mm II型的板热阻多少？", allowed: ["REFERENCE_QUERY", "CLARIFY"], semantic: false },
  { id: "P11", message: "帮我找产品层热阻 8 左右的档位。", allowed: ["REFERENCE_QUERY"], semantic: false },
  { id: "P12", message: "整墙总热阻3.3左右有没有？", allowed: ["REFERENCE_QUERY"], semantic: false },
  { id: "P13", message: "K越小越好吗？", allowed: ["KNOWLEDGE_EXPLAIN"], semantic: false },
  { id: "P14", message: "K、R、R0分别是什么意思？", allowed: ["KNOWLEDGE_EXPLAIN"], semantic: false },
  { id: "P15", message: "帮我算一下这个外墙构造的 K。", allowed: ["THERMAL_CALCULATE"], semantic: false },
  { id: "P16", message: "55mm II 型按分层法重新算一下。", allowed: ["THERMAL_CALCULATE"], semantic: false },
  { id: "P17", message: "上海住宅项目外墙 K 0.3 符不符合标准？", allowed: ["COMPLIANCE_CHECK"], semantic: false },
  { id: "P18", message: "这个做法送审能不能过？", allowed: ["COMPLIANCE_CHECK"], semantic: true },
  { id: "P19", message: "窗洞口保温怎么处理？", allowed: ["KNOWLEDGE_EXPLAIN"], semantic: false },
  { id: "P20", message: "图集里的阴阳角做法在哪页？", allowed: ["KNOWLEDGE_EXPLAIN", "REFERENCE_VIEW"], semantic: false },
  { id: "P21", message: "VICP外墙施工有什么注意事项？", allowed: ["KNOWLEDGE_EXPLAIN"], semantic: false },
  { id: "P22", message: "这种保温系统有无相关检测报告？", allowed: ["KNOWLEDGE_EXPLAIN", "PRODUCT_DETAIL"], semantic: true },
  { id: "P23", message: "混凝土基层和加气砌块基层用同一厚度，K一样吗？", allowed: ["REFERENCE_QUERY", "COMPARE_CANDIDATES"], semantic: false },
  { id: "P24", message: "这个项目应该优先选哪种保温方式？", allowed: ["REFERENCE_QUERY"], semantic: true },
  { id: "P25", message: "同样做到K≤0.3，哪个档位更薄？", allowed: ["REFERENCE_QUERY"], semantic: false },
  { id: "P26", message: "甲方要控制成本，能对比两种材料吗？", allowed: ["MATERIAL_COMPARE"], semantic: true },
  { id: "P27", message: "能给我几个不同做法让我选吗？", allowed: ["REFERENCE_QUERY"], semantic: true },
  { id: "P28", message: "我们项目适合这种构造吗？", allowed: ["COMPLIANCE_CHECK", "REFERENCE_QUERY"], semantic: true },
  { id: "P29", message: "我想出一份保温方案报告。", allowed: ["REPORT_REQUEST"], semantic: false },
  { id: "P30", message: "帮我把方案做成PDF。", allowed: ["REPORT_REQUEST"], semantic: true },
  { id: "P31", message: "这个参数是从哪里来的？", allowed: ["REFERENCE_DETAIL", "REFERENCE_VIEW"], semantic: true },
  { id: "P32", message: "你好，你能帮我做什么？", allowed: ["GENERAL"], semantic: false },
];
const last = { query: { filters: [{ metric: "K" as const, targetValue: .3, mode: "APPROX" as const }] },
  candidates: referenceReadFixture().candidates };
describe("高频矩阵A：确定性路由合同，不是远程模型验收", () => {
  it.each(cases)("$id $message", ({ allowed, message, semantic }) => {
    const decision = decideDomainTurn(message, undefined);
    expect(allowed.includes(decision.intent) || semantic && decision.intent === "GENERAL").toBe(true);
  });
});
describe("高频矩阵B：有候选时的读取与解释边界", () => {
  it.each([
    ["S1.3", "第二个基层是什么，厚度多少？", "REFERENCE_DETAIL"],
    ["S1.4", "第二个原页给我看", "REFERENCE_VIEW"],
    ["S2.1", "外墙K≤0.3，优先做薄一点，给我几套做法", "REFERENCE_QUERY"],
    ["S2.2", "只要20mm以内", "REFERENCE_REFINE"],
    ["S2.3", "第一个和第三个有什么区别", "COMPARE_CANDIDATES"],
    ["S2.4", "第一个留下，第三个也加入", "SOLUTION_ACTION"],
    ["S3.2", "这个数值哪一页来的", "REFERENCE_VIEW"],
    ["S3.3", "按这个做法重新算一下", "THERMAL_CALCULATE"],
    ["S3.4", "上海住宅能达标吗", "COMPLIANCE_CHECK"],
    ["S5.2", "K值小就一定省钱吗", "KNOWLEDGE_EXPLAIN"],
    ["S5.3", "施工时怎么处理热桥", "KNOWLEDGE_EXPLAIN"],
    ["S5.4", "刚才第三个的完整热工表给我看看", "REFERENCE_VIEW"]
  ])("%s %s", (_id, message, intent) => expect(decideDomainTurn(message!, last).intent).toBe(intent));
  it("S2.5就这样不允许Confirm，已有状态保持不变", async () => {
    const payload = refreshSolution(emptySolution(), {}, referenceReadFixture().candidates.map(referenceSolutionCandidate));
    const frozen = structuredClone(payload);
    const result = await parseSolutionAction({ app: {}, conversation: {} } as any, "就这样", payload);
    expect(result).toBeNull(); expect(payload).toEqual(frozen);
  });
  it("S6.4两个结果只能指向当前实际可见的两项，不能把一个冒充两个", () => {
    const lookup = { ...last, createdAt: new Date().toISOString(), candidates: last.candidates.slice(0, 2) };
    expect(resolveVisibleCandidateIds(lookup, "把两个结果都给我看原表").ids).toEqual(["row-1", "row-2"]);
    expect(resolveVisibleCandidateIds({ ...lookup, candidates: lookup.candidates.slice(0, 1) }, "把两个结果都给我看原表").ids).toBeUndefined();
    expect(resolveVisibleCandidateIds({ ...lookup, candidates: last.candidates }, "把两个结果都给我看原表").ids).toBeUndefined();
  });
});
