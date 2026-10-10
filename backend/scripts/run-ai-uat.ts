import "dotenv/config";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { and, asc, eq, gte } from "drizzle-orm";
import { uatCases } from "../tests/uat/cases/index.js";
import type { createUatEnvironment } from "../tests/uat/environment.js";
import { assertObservation, visibleAnswer } from "../tests/uat/assertions/index.js";
import { sendTurn } from "../tests/uat/sse.js";
import { redact, scoreTurn, writeReport } from "../tests/uat/report.js";
import { FIXTURE_VERSION } from "../tests/uat/fixtures/facts.js";
import { parseConversationTaskState } from "../src/modules/ai/conversation-task.js";
import { CLIENT_APPS } from "../src/shared/constants.js";
import { aiAgentRuns, aiConversationStates, aiMessages, aiToolCalls, thermalCalcRecords } from "../src/db/schema.js";
import type { Observation, SseEvent, TurnResult } from "../tests/uat/schema.js";

function options(args: string[]) {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (["--list", "--judge", "--check"].includes(arg)) result[arg.slice(2)] = true;
    else if (["--persona", "--case", "--out", "--reasoning"].includes(arg)) {
      const value = args[++index]; if (!value || value.startsWith("--")) throw new Error(`${arg}缺少值`);
      result[arg.slice(2)] = value;
    } else throw new Error(`未知UAT参数 ${arg}`);
  }
  if (result.persona && !["sales", "design-institute"].includes(String(result.persona))) throw new Error("persona必须为sales或design-institute");
  if (result.reasoning && !["on", "off"].includes(String(result.reasoning))) throw new Error("reasoning必须为on或off");
  return result;
}
const args = options(process.argv.slice(2));
const selected = uatCases.filter(item => (!args.case || args.case === item.id) && (!args.persona || item.persona === (args.persona === "sales" ? "SALES" : "DESIGN_INSTITUTE")));
if (!selected.length) throw new Error("没有符合条件的UAT场景");
if (args.list || args.check) {
  if (uatCases.length < 40 || uatCases.filter(item => item.persona === "SALES").length < 20 || uatCases.filter(item => item.persona === "DESIGN_INSTITUTE").length < 20 || new Set(uatCases.map(item => item.id)).size !== uatCases.length || uatCases.some(item => item.turns.length < 2 || item.turns.length > 5) || uatCases.reduce((sum, item) => sum + item.turns.length, 0) < 100) throw new Error("UAT场景数量/轮次/身份/ID不满足验收要求");
  if (args.list) for (const item of selected) console.log(`${item.id} ${item.persona} ${item.scenario} (${item.turns.length}轮)`);
  console.log(`[UAT] 场景结构检查通过：${selected.length}场景，${selected.reduce((sum, item) => sum + item.turns.length, 0)}轮；未调用模型，未进行业务验收。`);
} else {
  const directory = path.resolve(String(args.out ?? `logs/ai-uat/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`));
  const results: TurnResult[] = [];
  const run: Record<string, unknown> = { startedAt: new Date().toISOString(), fixtureVersion: FIXTURE_VERSION, reasoning: args.reasoning === "on" ? "ON" : "OFF", styleJudge: args.judge ? "AI_STYLE_ONLY" : "DETERMINISTIC_STYLE" };
  try { run.gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { run.gitRevision = "UNKNOWN"; }
  let environment: Awaited<ReturnType<typeof createUatEnvironment>> | undefined;
  const api = async (route: string, token: string, body?: unknown) => {
    const response = await fetch(`${environment!.baseUrl}${route}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const value = await response.json() as { success: boolean; data: Record<string, any>; error?: { code?: unknown } };
    if (!value.success) throw new Error(`真实API失败 ${route.split("?")[0]} / ${String(value.error?.code ?? response.status)}`);
    return value.data;
  };
  try {
    console.log("[UAT] 准备随机隔离数据库、独立Redis键/队列、固定正式fixture和测试页图。");
    // 离线--list/--check不加载连接配置；缺失真实环境也应生成BLOCKED报告。
    const [{ createUatEnvironment: prepareEnvironment }, { judgeQuality }, { getAiTaskRuntimePolicy }] = await Promise.all([
      import("../tests/uat/environment.js"), import("../tests/uat/judges/quality.js"), import("../src/modules/ai-config/ai-task-runtime-policy.js")
    ]);
    run.runtimePolicy = { chat: getAiTaskRuntimePolicy("CHAT"), agent: getAiTaskRuntimePolicy("PROJECT_AGENT") };
    environment = await prepareEnvironment();
    run.database = environment.databaseName;
    run.runtimeConfig = environment.runtimeConfig;
    for (const item of selected) {
      const user = await environment.createUser(item.persona, item.id);
      const created = await api("/api/v1/ai/conversations", user.token, { clientApp: CLIENT_APPS.PC_AI, scene: "general_chat", title: `UAT ${item.id}`, reasoningMode: run.reasoning });
      const conversationId = created.conversation.id as string;
      let previous: Observation | undefined;
      let caseBlocked: string | undefined;
      for (const [index, turn] of item.turns.entries()) {
        const result: TurnResult = { caseId: item.id, persona: item.persona, scenario: item.scenario, turn: index + 1, user: turn.user, expected: turn.expect, checks: [], quality: { score: 0, method: "NOT_EXECUTED", reasons: [] }, score: 0, status: "BLOCKED" };
        results.push(result);
        if (caseBlocked) { result.checks.push({ group: "state", passed: false, type: "INFRASTRUCTURE", detail: caseBlocked }); continue; }
        const started = new Date(); const captured: SseEvent[] = [];
        const progress = setInterval(() => console.log(`[UAT] ${item.id} Turn ${index + 1} 真实模型仍在处理…`), 30_000);
        try {
          console.log(`[UAT] ${item.id} Turn ${index + 1}/${item.turns.length}：${turn.user}`);
          const events = await sendTurn(environment.baseUrl, user.token, conversationId, turn.user, event => captured.push(event));
          const done = events.find(event => event.event === "done")!;
          const messageId = String(done.data.messageId);
          const [message] = await environment.db.select().from(aiMessages).where(eq(aiMessages.id, messageId));
          if (!message) throw new Error("SSE最终消息未真实落库");
          const [state] = await environment.db.select().from(aiConversationStates).where(eq(aiConversationStates.conversationId, conversationId));
          const [tools, runs, calculations] = await Promise.all([
            environment.db.select().from(aiToolCalls).where(eq(aiToolCalls.messageId, messageId)).orderBy(asc(aiToolCalls.createdAt)),
            environment.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.assistantMessageId, messageId)),
            environment.db.select().from(thermalCalcRecords).where(and(eq(thermalCalcRecords.createdById, user.id), gte(thermalCalcRecords.createdAt, started)))
          ]);
          const actual: Observation = { message, tools, runs, calculations, task: parseConversationTaskState(state?.taskStateJson), events };
          result.actual = actual;
          result.checks = assertObservation(turn.expect, actual, previous);
          for (const candidate of actual.task.lastReferenceLookup?.candidates ?? []) {
            const expectedClass = candidate.specClass === "II" ? "II" : "I";
            result.checks.push({ group: "facts", passed: candidate.systemId === environment.fixture.systemIds.get(expectedClass) && candidate.schemeId === environment.fixture.schemeIds.get(candidate.schemeCode ?? "") && candidate.productSpecId === environment.fixture.specIds.get(`${expectedClass}-${candidate.thicknessMm}`) && candidate.catalogProductId === environment.fixture.catalogIds[expectedClass] && candidate.sourcePageId === environment.fixture.pageIds.get(candidate.sourcePageLabel ?? "") && candidate.sourceDocumentId === environment.fixture.docId, type: "SOURCE", detail: "候选体系/方案/规格/产品/原页ID均属于固定正式fixture", hard: true });
          }
          const detail = await api(`/api/v1/ai/conversations/${conversationId}`, user.token);
          result.checks.push({ group: "state", passed: Array.isArray(detail.messages) && detail.messages.some((row: Record<string, unknown>) => row.id === messageId && row.content === message.content), type: "STATE", detail: "SSE完成后客户端详情返回同一最终消息" });
          const blocks = events.filter(event => event.event === "reference_pages").flatMap(event => (event.data.referencePages ?? []) as { page: { pageId: string; pageLabel: string; imageUrl: string } }[]);
          for (const block of blocks) {
            const source = await api(`/api/v1/ai/knowledge/source-detail?pageId=${encodeURIComponent(block.page.pageId)}`, user.token);
            result.checks.push({ group: "source", passed: JSON.stringify(source).includes(block.page.pageId) && environment.fixture.pageIds.get(block.page.pageLabel) === block.page.pageId, type: "SOURCE", detail: "真实来源详情定位到fixture原页", hard: true });
            const image = await fetch(block.page.imageUrl, { signal: AbortSignal.timeout(15_000) });
            const bytes = Buffer.from(await image.arrayBuffer());
            result.checks.push({ group: "source", passed: image.ok && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), type: "SOURCE", detail: "ReferencePage签名地址实际可下载PNG原页" });
          }
          result.quality = await judgeQuality({ persona: item.persona, user: turn.user, answer: visibleAnswer(actual), db: environment.db, aiJudge: !!args.judge });
          Object.assign(result, scoreTurn(result.checks, result.quality));
          previous = actual;
          console.log(`[UAT] ${item.id} Turn ${index + 1} ${result.status} ${result.score}分；model=${String(done.data.model && (done.data.model as { id: string }).id)}；run=${runs.map(row => row.id).join(",")}`);
        } catch (error) {
          const label = error instanceof Error ? String(redact(error.message)) : "未知错误";
          result.checks.push({ group: "intent", passed: false, type: "INFRASTRUCTURE", detail: label });
          // 超时/网络失败也主动停止测试会话，避免后台任务持续运行。
          const [latest] = await environment.db.select().from(aiMessages).where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, "ASSISTANT"), gte(aiMessages.createdAt, started))).orderBy(asc(aiMessages.createdAt));
          if (latest?.status === "STREAMING" || latest?.status === "PENDING") await api(`/api/v1/ai/messages/${latest.id}/stop`, user.token, {}).catch(() => {});
          if (latest && !result.actual) result.actual = { message: latest, tools: await environment.db.select().from(aiToolCalls).where(eq(aiToolCalls.messageId, latest.id)), runs: [], calculations: [], task: parseConversationTaskState(undefined), events: captured };
          result.status = "FAIL";
          caseBlocked = "本场景上一轮真实链路未完成，后续轮次不能假定已有上下文";
          console.log(`[UAT] ${item.id} Turn ${index + 1} FAIL：${label}`);
        } finally { clearInterval(progress); }
        await writeReport(directory, results, run, selected.length, selected.reduce((sum, item) => sum + item.turns.length, 0));
      }
    }
  } catch (error) {
    run.environmentError = error instanceof Error ? String(redact(error.message)) : "未知环境错误";
    console.error(`[UAT] ${String(run.environmentError)}`);
    for (const item of selected) for (const [index, turn] of item.turns.entries()) if (!results.some(result => result.caseId === item.id && result.turn === index + 1)) results.push({ caseId: item.id, persona: item.persona, scenario: item.scenario, turn: index + 1, user: turn.user, expected: turn.expect, checks: [{ group: "intent", passed: false, type: "INFRASTRUCTURE", detail: String(run.environmentError) }], quality: { score: 0, method: "NOT_EXECUTED", reasons: [] }, score: 0, status: "BLOCKED" });
  } finally {
    if (environment) {
      try { await environment.cleanup(); run.cleanup = "COMPLETED"; }
      catch (error) { run.cleanup = "FAILED"; run.cleanupError = error instanceof Error ? error.message : "未知错误"; }
    }
    run.finishedAt = new Date().toISOString();
    const summary = await writeReport(directory, results, run, selected.length, selected.reduce((sum, item) => sum + item.turns.length, 0));
    console.log(`[UAT] ${JSON.stringify(summary)}`);
    console.log(`[UAT] 报告：${path.join(directory, "report.md")}`);
    if (summary.fail || summary.blocked || run.environmentError || run.cleanup === "FAILED") process.exitCode = 1;
  }
}
