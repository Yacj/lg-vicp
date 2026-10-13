import "dotenv/config";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull, or } from "drizzle-orm";
import { env } from "../src/config/env.js";
import * as schema from "../src/db/schema.js";
import { createObjectStorage } from "../src/storage/index.js";
import { resolveDomainTurn } from "../src/modules/ai/ai-domain-turn-decision.service.js";
import { loadPublishedKnowledgeReferences } from "../src/modules/ai/ai-reference-pages.service.js";
import { advanceAdviceBusinessContext, invalidateAdviceOnTopicChange } from "../src/modules/ai/solution-advice-context.js";
import { resolveSolutionAdvice } from "../src/modules/ai/solution-advice.service.js";
import type { ConversationTaskState } from "../src/modules/ai/conversation-task.js";
import { domainDecision } from "../src/modules/ai/ai-domain-turn-decision.js";
import { resolveSceneRuntime } from "../src/modules/ai/ai-runtime.service.js";
const report = { mode: "READ_ONLY_SERVICE_WITH_REAL_MODEL_NOT_HTTP_UAT", startedAt: new Date().toISOString(), checks: [] as Array<Record<string, unknown>> };
const record = (name: string, status: string, details: unknown = {}) => { const item = { name, status, details }; report.checks.push(item); console.log(JSON.stringify(item)); };
const messages = ["Ⅲ型VICP薄抹灰外保温系统，45mm厚度，不同基层的传热系数有什么区别？", "能不能出个方案", "不要根据地区 和 建筑 出个通用方案"];
const client = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 8, onnotice: () => {}, connection: { default_transaction_read_only: "on", application_name: "vicp-semantic-advice-readonly" } });
try {
  await client.begin("isolation level repeatable read read only", async tx => {
    await tx`set local statement_timeout = '30s'`;
    const [proof] = await tx`select current_setting('transaction_read_only') as read_only`;
    assert.equal(proof?.read_only, "on"); record("数据库禁止写入", "PASS");
    const db = drizzle(Object.assign(tx, { options: client.options }) as unknown as postgres.Sql, { schema });
    const storage = createObjectStorage(env);
    const app = { db, log: { warn: (details: { errorType?: string; statusCode?: number; errorCode?: string }) => {
      if (details.errorType) record("模型环境诊断", "BLOCKED", { errorType: details.errorType, statusCode: details.statusCode, errorCode: details.errorCode });
    } }, storage } as any;
    const [storedConversation] = await db.select().from(schema.aiConversations).where(and(isNull(schema.aiConversations.projectId), isNull(schema.aiConversations.deletedAt), eq(schema.aiConversations.status, "active"),
      or(eq(schema.aiConversations.clientApp, "c_app"), eq(schema.aiConversations.clientApp, "pc_ai")))).limit(1);
    if (!storedConversation) record("真实归属校验上下文", "BLOCKED", { reason: "没有可用的无项目客户端会话；不创建测试用户或会话，只验证无副作用的真实模型提案与发布事实" });
    const conversation = storedConversation ?? { id: "readonly-semantic-probe", projectId: null, clientApp: "c_app", userId: "no-persisted-actor", scene: "general_chat" } as any;
    const user = { id: conversation.userId, clientType: conversation.clientApp === "c_app" ? "C_APP" : "PC_AI", role: "NORMAL_USER" } as any;
    try { await resolveSceneRuntime(db, "semantic_query", "OFF").catch(() => resolveSceneRuntime(db, conversation.scene, "OFF")); }
    catch (error) { record("运行时阻塞诊断（仅函数名，无错误正文）", "BLOCKED", { frames: error instanceof Error
      ? error.stack?.split("\n").slice(1, 5).map(line => line.match(/\bat\s+([A-Za-z0-9_.]+)/)?.[1]).filter(Boolean) : [] }); }
    const docs = await db.select({ documentId: schema.knowledgeDocuments.id, versionId: schema.knowledgeDocumentVersions.id }).from(schema.knowledgeDocuments)
      .innerJoin(schema.knowledgeDocumentVersions, eq(schema.knowledgeDocuments.currentVersionId, schema.knowledgeDocumentVersions.id))
      .where(and(isNull(schema.knowledgeDocuments.projectId), isNull(schema.knowledgeDocuments.deletedAt), eq(schema.knowledgeDocuments.status, "ACTIVE"), eq(schema.knowledgeDocumentVersions.status, "PUBLISHED"), eq(schema.knowledgeDocumentVersions.usageMode, "AI_ENABLED"))).limit(30);
    let state: ConversationTaskState = { taskType: "GENERAL" };
    const first = await resolveDomainTurn({ app, conversation, userMessage: messages[0], taskState: state });
    record("真实模型跨基层查询目标", first.parserSource === "UNAVAILABLE" ? "BLOCKED" : first.intent === "REFERENCE_QUERY" ? "PASS" : "FAIL", { intent: first.intent, mutation: first.mutation, policyReason: first.policyReason });
    // 直接读取已发布来源验证，不创建消息；这不是完整HTTP检索路径。
    const references = await loadPublishedKnowledgeReferences(app, docs as any, null, messages[0]!);
    const candidates = references.solutionCandidates ?? [];
    record("真实四基层同源事实", candidates.length === 4 ? "PASS" : "FAIL", { candidates: candidates.map(candidate => ({ code: candidate.constructionCode, thickness: candidate.thicknessMm,
      substrateThickness: candidate.substrateThickness, substrateMaterial: candidate.substrateMaterial, totalR: candidate.totalThermalResistance, k: candidate.kValue, page: candidate.sourcePageLabel })) });
    if (candidates.length !== 4) return;
    state.lastReferenceLookup = { query: references.query!, candidates, candidateQueryRevision: 1, projectId: null, createdAt: new Date().toISOString() };
    state = advanceAdviceBusinessContext(state, conversation, "REFERENCE_QUERY", messages[0]!, references.answer ?? "已核验候选");
    for (const message of messages.slice(1)) {
      const before = JSON.stringify(state.lastReferenceLookup);
      const decision = await resolveDomainTurn({ app, conversation, userMessage: message, taskState: state });
      state = invalidateAdviceOnTopicChange(state, decision.intent, message, decision);
      const result = storedConversation && decision.intent === "SOLUTION_ADVICE" ? await resolveSolutionAdvice({ app, request: {}, user, conversation, userMessage: message, taskState: state, domainDecision: decision, candidateQueryRevision: 1 } as any) : undefined;
      record("真实模型建议连续轮", decision.parserSource === "UNAVAILABLE" ? "BLOCKED" : decision.intent === "SOLUTION_ADVICE" && decision.mutation === "NONE" ? "PASS" : "FAIL", {
        intent: decision.intent, mutation: decision.mutation, relation: decision.semantic?.relation, patch: decision.semantic?.constraintPatch.map(patch => ({ field: patch.field, op: patch.op })),
        verified: result?.verified ?? false, referencedPages: result?.referencePages.map(page => ({ pageLabel: page.page.pageLabel, matches: page.matches.length })) ?? [], policyReason: decision.policyReason });
      record("真实归属建议事实服务", !storedConversation || decision.parserSource === "UNAVAILABLE" ? "BLOCKED" : result?.verified && result.candidates.length === 4 ? "PASS" : "FAIL");
      assert.equal(JSON.stringify(state.lastReferenceLookup), before);
      state = advanceAdviceBusinessContext(state, conversation, decision.intent, message, result?.answer ?? "需要明确当前范围", Date.now(), result?.verified, decision);
    }
    if (storedConversation) {
      const controlled = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: state.lastReferenceLookup }, conversation, "REFERENCE_QUERY", messages[0]!, "已核验四个来源");
      const advice = await resolveSolutionAdvice({ app, request: {}, user, conversation, userMessage: messages[1], taskState: controlled,
        domainDecision: { ...domainDecision("SOLUTION_ADVICE", messages[1]!), referenceScope: "LATEST_VISIBLE" }, candidateQueryRevision: 1 } as any);
      record("真实数据库归属/发布/optionId建议服务（受控只读目标，不代表模型通过）", advice.verified && advice.candidates.length === 4 ? "PASS" : "FAIL", {
        verified: advice.verified, referencedPages: advice.referencePages.map(page => ({ pageLabel: page.page.pageLabel, matches: page.matches.length })) });
    }
    for (const [message, expected] of [["不要出方案，直接列原表", "REFERENCE_VIEW"], ["暂不确认，先给建议", "SOLUTION_ADVICE"], ["帮我确认一下 A3-2 的 K", "REFERENCE_DETAIL"], ["仅给我报告提纲", "SOLUTION_ADVICE"], ["不要推荐方案", "GENERAL"]]) {
      const decision = await resolveDomainTurn({ app, conversation, userMessage: message, taskState: state });
      record("真实模型否定/参数/提纲边界", decision.parserSource === "UNAVAILABLE" ? "BLOCKED" : decision.intent === expected && decision.mutation === "NONE" ? "PASS" : "FAIL", { expected, intent: decision.intent, mutation: decision.mutation, relation: decision.semantic?.relation, policyReason: decision.policyReason });
    }
    record("无消息/用户/方案/快照/报告写入", "PASS", { transactionReadOnly: proof?.read_only, method: "只读数据库连接及服务调用；未调用聊天生成/动作/报告/计算入口" });
  });
} catch (error) {
  record("真实只读验证环境", "BLOCKED", { errorType: error instanceof Error ? error.name : "UNKNOWN", code: typeof (error as any)?.code === "string" ? (error as any).code : undefined });
} finally {
  await client.end({ timeout: 5 });
  await writeFile("docs/ai/semantic-advice-db-2026-10-13.json", JSON.stringify(report, null, 2) + "\n");
  if (report.checks.some(check => check.status === "FAIL" || check.status === "BLOCKED")) process.exitCode = 1;
}
