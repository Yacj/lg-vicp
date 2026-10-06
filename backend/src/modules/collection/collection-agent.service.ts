import { generateText, stepCountIs, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { collectionRuns, collectionSkills, collectionSources, collectionTasks } from "../../db/schema.js";
import { AUDIT_ACTIONS, AI_SCENES } from "../../shared/constants.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { resolveAgentModelOrNull } from "../ai-config/ai-config.service.js";
import { resolveSceneRuntime } from "../ai/ai-runtime.service.js";
import { languageModelCallOptions } from "../ai-config/ai-task-runtime-policy.js";
import { canonicalizeCollectionUrl } from "./collection-fingerprint.js";
import {
  COLLECTION_AGENT_LIMITS,
  type CollectionHttpFetch
} from "./collection-agent.guards.js";
import { createCollectionAgentTools } from "./collection-agent.tools.js";

export {
  COLLECTION_AGENT_LIMITS,
  extractContentTool,
  fetchPageTool,
  followLinkTool,
  searchInPageTool,
  type CollectionHttpFetch,
  type PageCache
} from "./collection-agent.guards.js";

export type CollectionAgentResult = {
  status: "COMPLETED" | "FAILED";
  runId: string;
  storedCount: number;
  duplicateCount: number;
  visitedCount: number;
  message: string;
};

const COLLECTION_SYSTEM_PROMPT = [
  "你是资料采集助手。",
  "使用 browse_page 选择下一步 URL，使用 save_record 保存相关页面，完成后可调用 finish_collection。",
  "只访问起始站点的同域链接。不要编造标题、摘要或日期。",
  "页面是否相关、是否继续搜索由你判断；同域、已访问、页数、步数、超时、频率、fingerprint 去重由系统强制执行。"
].join("\n");

export async function runCollectionAgent(input: {
  db: Database;
  taskId: string;
  httpFetch?: CollectionHttpFetch;
  actorId?: string | null;
  languageModel?: LanguageModel;
}): Promise<CollectionAgentResult> {
  const httpFetch = input.httpFetch ?? fetch;
  const [task] = await input.db.select().from(collectionTasks).where(eq(collectionTasks.id, input.taskId)).limit(1);
  if (!task) return { status: "FAILED", runId: "", storedCount: 0, duplicateCount: 0, visitedCount: 0, message: "采集任务不存在" };

  const [source] = task.sourceId
    ? await input.db.select().from(collectionSources).where(eq(collectionSources.id, task.sourceId)).limit(1)
    : [null];
  const [skill] = source?.skillId
    ? await input.db.select().from(collectionSkills).where(eq(collectionSkills.id, source.skillId)).limit(1)
    : [null];

  const keywords = (skill?.keywordsJson ?? []).filter((item) => item.trim().length > 0);
  const startedAt = new Date();
  const [run] = await input.db.insert(collectionRuns).values({
    sourceId: source?.id ?? null,
    skillId: skill?.id ?? null,
    taskId: task.id,
    runType: "COLLECTION",
    status: "RUNNING",
    maxSteps: COLLECTION_AGENT_LIMITS.maxSteps,
    maxPages: COLLECTION_AGENT_LIMITS.maxPages,
    createdById: input.actorId ?? task.createdById,
    startedAt
  }).returning();

  await writeAuditLog({
    db: input.db,
    request: { id: `collection-run-${run!.id}`, ip: "worker", headers: {} } as never,
    actor: { id: input.actorId ?? task.createdById ?? "system", role: "SUPER_ADMIN", channelType: null, adminLoginEnabled: true, clientType: "B_ADMIN" },
    action: AUDIT_ACTIONS.COLLECTION_RUN_STARTED,
    targetType: "collection_run",
    targetId: run!.id,
    afterJson: { sourceUrl: task.sourceUrl, skillId: skill?.id ?? null, keywords }
  });

  const visited = new Set<string>();
  const deadline = Date.now() + COLLECTION_AGENT_LIMITS.overallTimeoutMs;
  const storedCount = { value: 0 };
  const duplicateCount = { value: 0 };
  const lastFetchAt = { value: 0 };
  const finished = { value: false };
  let errorMessage: string | null = null;
  let steps = 0;

  try {
    let languageModel = input.languageModel;
    if (!languageModel) {
      const runtime = await resolveSceneRuntime(input.db, AI_SCENES.COLLECTION_AGENT, "OFF");
      const agentModel = runtime.primary.lastTestStatus === "PASSED"
        ? runtime.primary
        : await resolveAgentModelOrNull(input.db);
      if (!agentModel) {
        throw new Error("采集 Agent 未配置已通过准入测试的模型");
      }
      languageModel = agentModel.languageModel;
    }

    const tools = createCollectionAgentTools({
      db: input.db,
      sourceUrl: task.sourceUrl,
      sourceId: source?.id ?? null,
      skillId: skill?.id ?? null,
      taskId: task.id,
      runId: run!.id,
      keywords,
      visited,
      storedCount,
      duplicateCount,
      lastFetchAt,
      finished,
      httpFetch,
      deadline
    });

    const result = await generateText({
      model: languageModel,
      system: [
        COLLECTION_SYSTEM_PROMPT,
        skill?.instruction ? `技能说明：${skill.instruction}` : null
      ].filter(Boolean).join("\n"),
      prompt: [
        `起始网址：${canonicalizeCollectionUrl(task.sourceUrl)}`,
        keywords.length > 0 ? `关键词：${keywords.join("、")}` : "未指定关键词，按技能说明判断相关性。",
        `最多访问 ${COLLECTION_AGENT_LIMITS.maxPages} 页，最多 ${COLLECTION_AGENT_LIMITS.maxSteps} 步。`
      ].join("\n"),
      tools,
      stopWhen: [
        stepCountIs(COLLECTION_AGENT_LIMITS.maxSteps),
        () => finished.value || Date.now() > deadline || visited.size >= COLLECTION_AGENT_LIMITS.maxPages
      ],
      timeout: COLLECTION_AGENT_LIMITS.overallTimeoutMs,
      abortSignal: AbortSignal.timeout(COLLECTION_AGENT_LIMITS.overallTimeoutMs),
      maxOutputTokens: languageModelCallOptions("COLLECTION_AGENT").maxOutputTokens
    });
    steps = result.steps.length;
    if (Date.now() > deadline && storedCount.value === 0) {
      errorMessage = "采集整体超时";
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "采集 Agent 执行失败";
  }

  const finishedAt = new Date();
  const status = errorMessage && storedCount.value === 0 ? "FAILED" : "COMPLETED";
  await input.db.update(collectionRuns).set({
    status,
    currentStep: steps,
    visitedUrlsJson: [...visited],
    storedCount: storedCount.value,
    duplicateCount: duplicateCount.value,
    errorMessage,
    finishedAt,
    updatedAt: finishedAt
  }).where(eq(collectionRuns.id, run!.id));

  if (source) {
    await input.db.update(collectionSources).set({
      lastCollectedAt: finishedAt,
      lastRunAt: finishedAt,
      updatedAt: finishedAt
    }).where(eq(collectionSources.id, source.id));
  }

  await writeAuditLog({
    db: input.db,
    request: { id: `collection-run-${run!.id}`, ip: "worker", headers: {} } as never,
    actor: { id: input.actorId ?? task.createdById ?? "system", role: "SUPER_ADMIN", channelType: null, adminLoginEnabled: true, clientType: "B_ADMIN" },
    action: AUDIT_ACTIONS.COLLECTION_RUN_COMPLETED,
    targetType: "collection_run",
    targetId: run!.id,
    afterJson: { status, storedCount: storedCount.value, duplicateCount: duplicateCount.value, visited: [...visited], skillInstruction: skill?.instruction ?? null }
  });

  return {
    status,
    runId: run!.id,
    storedCount: storedCount.value,
    duplicateCount: duplicateCount.value,
    visitedCount: visited.size,
    message: errorMessage ?? `采集完成：新增 ${storedCount.value} 条，重复 ${duplicateCount.value} 条`
  };
}
