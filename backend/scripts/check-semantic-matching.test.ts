import { expect, it } from "vitest";
import { inspectMatching, checkMatching } from "./check-semantic-matching.mjs";
it.each(["/方案/.test(message)", "new RegExp('确认').test(message)", "message.includes('建议')", "message.startsWith('开始')", "new Set(['方案']).has(message)", "message === '给方案'"])("AST阻断未审核语义规则 %s", code => {
  expect(checkMatching(inspectMatching(code), [])).not.toEqual([]);
});
it.each(["const intent = proposal.intent;", "schema.parse(output);", "parseThermalThicknessMessage(message, query);", "policy.intent === 'SOLUTION_ADVICE';", "groundSolutionAction(message, output, state, revision);"])("不全局禁止确定性能力 %s", code => {
  expect(inspectMatching(code)).toEqual([]);
});
it.each(["const message = '不要确认最终方案';", "const quoted = '他说确认最终方案';", "const context = { relation: 'CONTINUE', goal: '参考建议' };"])("原话/引用/跨轮数据本身不是词法判定 %s", code => expect(inspectMatching(code)).toEqual([]));
it("白名单绑定精确表达式，换词或缺反例证据不能继承豁免", () => {
  const [node] = inspectMatching("message.includes(evidence)");
  const rule = { ...node, ruleId: "SM-EVIDENCE-01", category: "EVIDENCE", reason: "连续证据验证", tests: ["domain-semantic-regression.test.ts"] };
  expect(checkMatching([node], [rule])).toEqual([]);
  expect(checkMatching(inspectMatching("message.includes('确认')"), [rule])).not.toEqual([]);
  expect(checkMatching([node], [{ ...rule, tests: [] }])).not.toEqual([]);
});
