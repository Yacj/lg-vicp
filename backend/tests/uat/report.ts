import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TurnResult } from "./schema.js";
export const WEIGHTS = { intent: 20, parameters: 20, facts: 25, state: 15, quality: 10, source: 10 } as const;
export function scoreTurn(checks: TurnResult["checks"], quality: TurnResult["quality"]): Pick<TurnResult, "score" | "status"> {
  let score = 0;
  for (const [group, weight] of Object.entries(WEIGHTS)) {
    const selected = checks.filter(check => check.group === group);
    // 未执行的维度不得默认满分。
    if (selected.length && selected.every(check => check.passed)) score += group === "quality" ? quality.score : weight;
  }
  const hard = checks.some(check => check.hard && !check.passed);
  return { score, status: hard || score < 80 ? "FAIL" : score < 90 ? "WARN" : "PASS" };
}
export function summarize(results: TurnResult[], plannedCases: number, plannedTurns: number) {
  const accuracy = (group: string) => {
    const checked = results.filter(result => result.actual && result.checks.some(check => check.group === group));
    return { checked: checked.length, passed: checked.filter(result => result.checks.filter(check => check.group === group).every(check => check.passed)).length, rate: checked.length ? checked.filter(result => result.checks.filter(check => check.group === group).every(check => check.passed)).length / checked.length : null };
  };
  const pages = results.filter(result => result.expected.referencePageRequired);
  return { plannedCases, plannedTurns, executedTurns: results.filter(result => result.actual).length, pass: results.filter(result => result.status === "PASS").length, warning: results.filter(result => result.status === "WARN").length, fail: results.filter(result => result.status === "FAIL").length, blocked: results.filter(result => result.status === "BLOCKED").length, hardFails: results.flatMap(result => result.checks).filter(check => check.hard && !check.passed).length, intent: accuracy("intent"), parameters: accuracy("parameters"), facts: accuracy("facts"), state: accuracy("state"), source: accuracy("source"), referencePage: { required: pages.length, passed: pages.filter(result => result.checks.some(check => check.group === "source") && result.checks.filter(check => check.group === "source").every(check => check.passed) && result.actual).length } };
}
// 不把JWT、配置密钥、AI原始思考链、签名参数或模型原始响应写入验收报告。
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/token$|ciphertext|apiKey|authorization|stateJson|internalStepText|system$|messages$/i.test(key)).map(([key, item]) => [key, redact(item)]));
  if (typeof value === "string") return value.replace(/https?:\/\/[^\s"<>]+\?[^\s"<>]+/g, url => url.split("?")[0]!);
  return value;
}
export async function writeReport(directory: string, results: TurnResult[], run: Record<string, unknown>, plannedCases: number, plannedTurns: number) {
  await mkdir(directory, { recursive: true });
  const summary = summarize(results, plannedCases, plannedTurns);
  await writeFile(path.join(directory, "report.json"), JSON.stringify(redact({ run, summary, results }), null, 2));
  const failures = results.filter(result => result.status !== "PASS");
  const rate = (value: { rate: number | null }) => value.rate === null ? "未执行" : `${(value.rate * 100).toFixed(1)}%`;
  const lines = ["# 销售 / 设计院真实 AI UAT", "", `计划：${plannedCases}场景 / ${plannedTurns}轮；已执行：${summary.executedTurns}轮。`, `通过 ${summary.pass}；警告 ${summary.warning}；失败 ${summary.fail}；阻塞 ${summary.blocked}；Hard Fail ${summary.hardFails}。`, "", `Intent ${rate(summary.intent)}；参数 ${rate(summary.parameters)}；事实 ${rate(summary.facts)}；多轮状态 ${rate(summary.state)}；来源 ${rate(summary.source)}。`, `ReferencePage ${summary.referencePage.passed}/${summary.referencePage.required}。`, "", "工程事实全部由程序断言；规则/AI体验评分的method见逐轮JSON。没有模型调用的轮次不算通过。", ""];
  for (const result of failures) lines.push(`## ${result.caseId} ${result.persona} / ${result.scenario} / Turn ${result.turn}`, "", `用户：${result.user}`, `结果：${result.status} / ${result.score}`, "", ...result.checks.filter(check => !check.passed).map(check => `- ${check.type}${check.hard ? " [HARD]" : ""}：${check.detail}`), "", `预期：\`${JSON.stringify(result.expected)}\``, "", `实际条件/决策：\`${JSON.stringify({ decision: result.actual?.message.metadata?.backendDecision, query: result.actual?.task.lastReferenceLookup?.query })}\``, "", "回答：", "", result.actual?.message.content ?? "未生成", "");
  await writeFile(path.join(directory, "report.md"), lines.join("\n"));
  return summary;
}
