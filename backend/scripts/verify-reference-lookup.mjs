import "dotenv/config";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { verifyWithPostgres } from "./verify-migrations-postgres.mjs";
import * as schema from "../dist/db/schema.js";
import { env } from "../dist/config/env.js";
import { createObjectStorage } from "../dist/storage/index.js";
import { createThermalTool, thermalInput } from "../dist/modules/ai/tools/thermal-calculate.tool.js";
import { parseConversationTaskState, formatConversationTaskContext } from "../dist/modules/ai/conversation-task.js";
import { normalizeToolResultForModel } from "../dist/modules/ai/tools/tool-result-normalizer.js";
import { getDocumentWorkspace } from "../dist/modules/knowledge/knowledge-workflow.service.js";
import { assertVersionPublishable } from "../dist/modules/knowledge/knowledge-original.service.js";

// 显式运行脚本才创建隔离库；所有业务写入仅发生在 verifyWithPostgres 提供的临时库。
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
await verifyWithPostgres(process.env.MIGRATION_VERIFY_DATABASE_URL ?? env.DATABASE_URL, directory, async (client) => {
  const db = drizzle(client, { schema });
  const insert = async (table, values) => (await db.insert(table).values(values).returning())[0];
  const warnings = [];
  const app = { db, storage: createObjectStorage(env), log: { warn: (...args) => warnings.push(args), info: () => {} } };
  const user = await insert(schema.users, { displayName: "收口联调用户", role: "NORMAL_USER" });
  const series = await insert(schema.productSeries, { code: "GATE", name: "收口联调系列", status: "PUBLISHED" });
  const spec = await insert(schema.productSpecs, { seriesId: series.id, specCode: "I-18", specClass: "I", thicknessMm: 18, status: "PUBLISHED" });
  const system = await insert(schema.insulationSystems, { code: "GATE-I", name: "I 型 VICP 薄抹灰外保温系统", systemType: "EXTERNAL", status: "PUBLISHED" });
  const scheme = await insert(schema.constructionSchemes, { systemId: system.id, schemeCode: "A1-3", name: "A1-3", substrateMaterial: "蒸压灰砂砖", substrateThickness: 240, status: "PUBLISHED" });
  const set = await insert(schema.thermalReferenceSets, { code: "GATE", name: "收口联调参考表", status: "PUBLISHED" });
  const doc = await insert(schema.knowledgeDocuments, { title: "收口联调图集", visibility: "PUBLIC", createdById: user.id });
  const version = await insert(schema.knowledgeDocumentVersions, { documentId: doc.id, version: 1, title: doc.title, status: "PUBLISHED", usageMode: "AI_ENABLED", createdById: user.id });
  await db.update(schema.knowledgeDocuments).set({ currentVersionId: version.id }).where(eq(schema.knowledgeDocuments.id, doc.id));

  // 原图来自真实存储，只读查找第 22 页；不创建、覆盖或删除已有对象。
  const source = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  let imageKey;
  try {
    const rows = await source`SELECT page_image_object_key FROM knowledge_pages WHERE page_image_object_key IS NOT NULL AND physical_page_number=22 LIMIT 1`;
    imageKey = rows[0]?.page_image_object_key;
  } finally { await source.end({ timeout: 5 }); }
  assert(imageKey, "真实存储没有可用于联调的第 22 页图片");
  const page = await insert(schema.knowledgePages, { documentId: doc.id, versionId: version.id, pageNumber: 22, physicalPageNumber: 22, pageLabel: "22", pageLabelSource: "MANUAL", pageImageObjectKey: imageKey, metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" } });
  const row = await insert(schema.thermalReferenceRows, {
    setId: set.id, schemeId: scheme.id, productSpecId: spec.id, thicknessMm: 18,
    productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303,
    sourceDocumentId: doc.id, sourcePageId: page.id, sourcePageLabel: "22",
    rawThickness: "18", rawProductResistance: "2.880", rawTotalResistance: "3.297", rawKValue: "0.303",
    evidenceSource: "收口联调图集", evidenceRef: "22页 A1-3"
  });
  const conversation = await insert(schema.aiConversations, { userId: user.id, clientApp: "C_APP", scene: "general_chat" });
  const events = [];
  let taskState = { taskType: "GENERAL" };
  const execute = async (message, args) => {
    const assistant = await insert(schema.aiMessages, { conversationId: conversation.id, userId: user.id, role: "ASSISTANT", content: "" });
    const run = await insert(schema.aiAgentRuns, { conversationId: conversation.id, userId: user.id, assistantMessageId: assistant.id });
    const context = {
      app, request: { id: "release-gate", log: app.log, headers: {}, ip: "127.0.0.1" },
      user: { ...user, clientType: "C_APP" }, conversation, assistantMessageId: assistant.id, agentRunId: run.id,
      abortSignal: new AbortController().signal, recentToolHashes: [], toolCallCount: { value: 0 },
      maxToolCalls: 12, duplicateLimit: 2, taskState, userMessage: message, answerContract: "REFERENCE_LOOKUP",
      onEvent: (type, data) => events.push({ type, data })
    };
    const tool = createThermalTool(context);
    const output = await tool.execute(thermalInput.parse({ operation: "LOOKUP_CANDIDATES", ...args }), { toolCallId: run.id, messages: [] });
    assert.equal(output.ok, true, JSON.stringify(output));
    const [saved] = await db.select().from(schema.aiConversationStates).where(eq(schema.aiConversationStates.conversationId, conversation.id));
    taskState = parseConversationTaskState(saved.taskStateJson);
    return output.data;
  };
  const approx = await execute("薄抹灰传热系数0.3左右有方案么？", { targetK: 0.3, systemHint: "保温薄抹灰系统", lookupMode: "MAX_LIMIT" });
  assert.equal(approx.lookupMode, "APPROX");
  assert.equal(approx.candidates[0].id, row.id);
  assert.equal(approx.candidates[0].totalThermalResistance, 3.297);
  assert(warnings.length > 0, "模式冲突必须记录中文 warning");
  const total = await execute("刚才那个方案总热阻多少？", {});
  assert.equal(total.candidates[0].totalThermalResistance, 3.297);
  assert(formatConversationTaskContext(taskState).includes("总热阻 3.297"));
  await execute("把刚才那页给我看看", {});
  const reference = events.filter((event) => event.type === "reference_pages").at(-1).data.referencePages[0];
  assert.equal(reference.page.pageId, page.id);
  assert.equal(reference.page.pageLabel, "22");
  assert.equal(reference.summary.productThermalResistance, 2.88);
  assert.equal(reference.summary.totalThermalResistance, 3.297);
  const response = await fetch(reference.page.imageUrl);
  const storageFailure = response.status !== 200 ? `原始完整页签名地址返回 HTTP ${response.status}` : null;
  if (!storageFailure) assert((await response.arrayBuffer()).byteLength > 0);
  console.log("[联调] APPROX、真实 Tool 落库、双 R 多轮恢复、原页 22 SSE 通过");
  console.log(storageFailure ? `[联调] 未通过：${storageFailure}` : "[联调] 真实存储原页下载通过");

  const firstLimit = await execute("薄抹灰有没有K不超过0.3的？", { targetK: 0.3 });
  assert.equal(firstLimit.lookupMode, "MAX_LIMIT");
  const secondLimit = await execute("18mm的呢？", { thicknessMm: 18 });
  assert.equal(secondLimit.lookupMode, "MAX_LIMIT");
  assert(!secondLimit.candidates.some((candidate) => candidate.id === row.id));
  const wrongSpec = await execute("II型18mm的呢？", { specClass: "II" });
  assert.equal(wrongSpec.candidates.length, 0);
  const changed = await execute("薄抹灰K0.303左右的呢？", { targetK: 0.303, specClass: "I", lookupMode: "APPROX" });
  assert.equal(changed.candidates[0].id, row.id, "空历史候选后修改条件必须重新查 DB");
  const fallback = await execute("屋面K0.303左右的呢？", { systemHint: "屋面", targetK: 0.303 });
  assert.equal(fallback.isFallback, true);
  assert.equal(fallback.matchedSystemHint, false);
  assert(!fallback.instruction.includes("第一行直接回答有"));
  assert(!normalizeToolResultForModel("thermal", { data: fallback }).instruction.includes("第一行直接回答有"));
  console.log("[联调] MAX_LIMIT 多轮、exact 厚度/型号、条件变化重查、跨体系 fallback 通过");

  const strictDoc = await insert(schema.knowledgeDocuments, { title: "严格门禁联调", createdById: user.id });
  const strictVersion = await insert(schema.knowledgeDocumentVersions, { documentId: strictDoc.id, version: 1, title: strictDoc.title, status: "APPROVED", usageMode: "AI_ENABLED", createdById: user.id });
  await insert(schema.knowledgePages, { documentId: strictDoc.id, versionId: strictVersion.id, pageNumber: 1, physicalPageNumber: 1, pageImageObjectKey: imageKey, metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" } });
  await insert(schema.knowledgeChunks, { documentId: strictDoc.id, versionId: strictVersion.id, chunkIndex: 0, content: "严格门禁联调内容", charCount: 8 });
  const actor = { ...user, role: "SUPER_ADMIN", clientType: "B_ADMIN", permissionCodes: [] };
  const previousStrict = env.STRICT_KNOWLEDGE_PUBLISH_CHECK;
  try {
    env.STRICT_KNOWLEDGE_PUBLISH_CHECK = true;
    const workspace = await getDocumentWorkspace(app, actor, strictDoc.id);
    assert.equal(workspace.summary.canPublish, false);
    await assert.rejects(assertVersionPublishable(app, strictVersion));
    env.STRICT_KNOWLEDGE_PUBLISH_CHECK = false;
    assert.equal((await getDocumentWorkspace(app, actor, strictDoc.id)).summary.canPublish, true);
    assert.equal((await assertVersionPublishable(app, strictVersion)).publishReady, true);
  } finally { env.STRICT_KNOWLEDGE_PUBLISH_CHECK = previousStrict; }
  console.log("[联调] STRICT 工作台 canPublish 与真实发布门禁一致通过");
  assert.equal(storageFailure, null, "原始完整页真实下载是必须满足的生产 gate");
});
