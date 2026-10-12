import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { solutionSnapshots } from "../src/db/schema.js";
import { sendTurn } from "../tests/uat/sse.js";
import type { createUatEnvironment } from "../tests/uat/environment.js";
import type { SolutionPayload } from "../src/modules/ai/solution-workflow.js";

const turns = ["薄抹灰K不超过0.35有哪些方案？", "第一个和第三个留下", "25mm那个也加入方案", "有没有更薄一点的？", "厚度必须20以内", "25那个不要了", "这两个比较一下", "就这两个", "确认生成方案", "确认生成方案", "K0.25有哪些方案？", "我又想改成另一个", "重新做一套方案"];
if (process.argv.includes("--check")) {
  console.log(`[智配UAT] ${turns.length}轮真实HTTP/SSE流程定义检查通过；未进行业务验收。`);
} else {
  const directory = path.resolve(`logs/solution-uat/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
  const report: { status: string; checks: string[]; turns: Array<{ user: string; stage: string; revision: number }>; error?: string } = { status: "BLOCKED", checks: [], turns: [] };
  let environment: Awaited<ReturnType<typeof createUatEnvironment>> | undefined;
  try {
    const { createUatEnvironment } = await import("../tests/uat/environment.js");
    environment = await createUatEnvironment();
    const user = await environment.createUser("SALES", "solution-workflow");
    const api = async (route: string, body?: unknown) => {
      const response = await fetch(`${environment!.baseUrl}/api/v1/ai${route}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const value = await response.json() as { success: boolean; data: any; error?: unknown };
      assert(value.success, `真实API失败：${route}`); return value.data;
    };
    const created = await api("/conversations", { clientApp: "PC_AI", scene: "general_chat" });
    const conversationId = created.conversation.id;
    type State = SolutionPayload & { id: string; stage: string; version: number; confirmedSnapshotId: string | null };
    const turn = async (text: string): Promise<State> => {
      const events = await sendTurn(environment!.baseUrl, user.token, conversationId, text, () => {});
      const done = events.find(event => event.event === "done")!;
      assert(done.data.solutionState, "SSE done缺少方案结构化状态");
      const state = await api(`/conversations/${conversationId}/solution`) as State;
      report.turns.push({ user: text, stage: state.stage, revision: state.candidateSetRevision });
      return state;
    };
    const queryEvents = await sendTurn(environment.baseUrl, user.token, conversationId, turns[0]!, () => {});
    const candidateResult = [...queryEvents].reverse().find(event => event.event === "reference_candidates");
    assert(candidateResult && (candidateResult.data.candidates as unknown[]).length >= 3, "普通查询必须返回候选结果");
    assert(!queryEvents.some(event => event.event === "solution_state"), "普通查询不能自动进入方案");
    assert.equal(await api(`/conversations/${conversationId}/solution`), null);
    report.turns.push({ user: turns[0]!, stage: "CANDIDATE_RESULT", revision: Number(candidateResult.data.queryRevision) });
    let state = await turn(turns[1]!); assert.equal(state.selectedCandidateIds.length, 2); assert(state.poolCandidateIds.length >= 3);
    state = await turn(turns[2]!); assert.equal(state.selectedCandidateIds.length, 3);
    const selected = [...state.selectedCandidateIds], revision = state.candidateSetRevision;
    state = await turn(turns[3]!); assert.equal(state.candidateSetRevision, revision + 1); assert.deepEqual(state.selectedCandidateIds, selected);
    state = await turn(turns[4]!); assert.equal(state.conditions.thicknessMax, 20); assert(state.conflicts.some(item => item.code === "THICKNESS_MISMATCH"));
    state = await turn(turns[5]!); assert.equal(state.selectedCandidateIds.length, 2); assert.equal(state.conflicts.length, 0);
    const compare = await api(`/conversations/${conversationId}/solution/actions`, { solutionStateId: state.id, expectedVersion: state.version, action: "COMPARE" });
    assert.deepEqual(compare.comparison.candidates.map((item: { candidateId: string }) => item.candidateId), state.selectedCandidateIds);
    state = await turn(turns[6]!); state = await turn(turns[7]!); assert.equal(state.stage, "READY_TO_CONFIRM");
    state = await turn(turns[8]!); assert.equal(state.stage, "CONFIRMED"); const snapshotId = state.confirmedSnapshotId!;
    const frozen = await api(`/conversations/${conversationId}/solution/snapshots/${snapshotId}`);
    assert.equal(frozen.payload.candidates.length, 2); assert(!JSON.stringify(frozen.payload).includes("imageUrl"));
    state = await turn(turns[9]!); assert.equal(state.confirmedSnapshotId, snapshotId);
    const originalStateId = state.id;
    const confirmedQuery = await sendTurn(environment.baseUrl, user.token, conversationId, turns[10]!, () => {});
    assert(confirmedQuery.some(event => event.event === "reference_candidates"));
    assert(!confirmedQuery.some(event => event.event === "solution_state"));
    assert.equal((await api(`/conversations/${conversationId}/solution`)).id, originalStateId);
    report.turns.push({ user: turns[10]!, stage: "CANDIDATE_RESULT", revision: Number([...confirmedQuery].reverse().find(event => event.event === "reference_candidates")!.data.queryRevision) });
    state = await turn(turns[11]!); assert.notEqual(state.id, originalStateId); assert.equal(state.confirmedSnapshotId, null);
    const revisedId = state.id; state = await turn(turns[12]!); assert.notEqual(state.id, revisedId);
    const after = await api(`/conversations/${conversationId}/solution/snapshots/${snapshotId}`); assert.deepEqual(after.payload, frozen.payload);
    const immutableError = (error: unknown) => String((error as { cause?: Error }).cause?.message ?? (error as Error).message).includes("已确认方案快照不可修改或删除");
    await assert.rejects(async () => { await environment!.db.update(solutionSnapshots).set({ version: 99 }).where(eq(solutionSnapshots.id, snapshotId)); }, immutableError, "数据库触发器必须拒绝snapshot UPDATE");
    await assert.rejects(async () => { await environment!.db.delete(solutionSnapshots).where(eq(solutionSnapshots.id, snapshotId)); }, immutableError, "数据库触发器必须拒绝snapshot DELETE");
    report.checks.push("普通查询与Confirmed后查询只返回Candidate Result；首次选择懒激活；START_NEW显式创建", "完整多轮选择/重查/冲突/比较/明确确认/幂等/修订/不可变值", "真实PostgreSQL UPDATE/DELETE触发器");
    report.status = "PASS";
  } catch (error) {
    report.status = environment ? "FAIL" : "BLOCKED";
    report.error = error instanceof Error ? error.message : "未知错误";
    process.exitCode = 1;
  } finally {
    if (environment) try { await environment.cleanup(); } catch { report.status = "FAIL"; report.error = "隔离环境清理失败"; process.exitCode = 1; }
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(`[智配UAT] ${report.status}，执行${report.turns.length}/${turns.length}轮；${report.error ?? "验收通过"}`);
    console.log(`[智配UAT] 报告：${path.join(directory, "report.json")}`);
  }
}
