import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import fastify from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { createCanvas } from "@napi-rs/canvas";
import { env } from "../../src/config/env.js";
import * as s from "../../src/db/schema.js";
import { authPlugin } from "../../src/plugins/auth.js";
import { errorHandlerPlugin } from "../../src/plugins/error-handler.js";
import { aiRoutes } from "../../src/modules/ai/ai.routes.js";
import { aiKnowledgeRoutes } from "../../src/modules/ai/ai-knowledge.routes.js";
import { aiThermalRoutes } from "../../src/modules/thermal/ai-thermal.routes.js";
import { createObjectStorage } from "../../src/storage/index.js";
import { QUEUE_NAMES, closeQueues, type AppQueues } from "../../src/queues/queues.js";
import { A13, FIXTURE_TEXT, REFERENCE_FACTS } from "./fixtures/facts.js";
import type { UatPersona } from "./schema.js";

/** 只读复制运行配置；业务数据从零建立在随机临时库，绝不在原库创建用户或会话。 */
export async function createUatEnvironment() {
  const id = randomUUID().replaceAll("-", "");
  const databaseName = `vicp_ai_uat_${id}`;
  const prefix = `vicp-ai-uat-${id}`;
  const adminUrl = process.env.AI_UAT_DATABASE_ADMIN_URL || env.DATABASE_URL;
  const sourceUrl = process.env.AI_UAT_CONFIG_DATABASE_URL || env.DATABASE_URL;
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const sourceClient = postgres(sourceUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const source = drizzle(sourceClient, { schema: s });
  const app = fastify({ logger: false });
  const rawRedis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null, connectTimeout: 3000, retryStrategy: () => null });
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, keyPrefix: `${prefix}:app:`, maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null });
  rawRedis.on("error", () => {}); redis.on("error", () => {});
  const storage = createObjectStorage(env);
  const objectKeys: string[] = [];
  let client: ReturnType<typeof postgres> | undefined;
  let queues: AppQueues | undefined;
  let createdDatabase = false;
  let stage = "只读加载模型与提示词配置";
  const cleanup = async () => {
    const failures: string[] = [];
    await app.close().catch(() => failures.push("关闭测试 API 失败"));
    if (queues) {
      for (const queue of Object.values(queues)) await queue.obliterate({ force: true }).catch(() => failures.push("清理测试队列失败"));
      await closeQueues(queues).catch(() => failures.push("关闭测试队列失败"));
    }
    if (rawRedis.status === "ready") {
      let cursor = "0";
      do {
        const result = await rawRedis.scan(cursor, "MATCH", `${prefix}:*`, "COUNT", 200);
        cursor = result[0];
        if (result[1].length) await rawRedis.del(...result[1]);
      } while (cursor !== "0");
    }
    redis.disconnect(); rawRedis.disconnect();
    for (const key of objectKeys) await storage.removeObject(key).catch(() => failures.push(`清理测试页 ${key} 失败`));
    if (client) await client.end({ timeout: 5 });
    await sourceClient.end({ timeout: 5 });
    if (createdDatabase) {
      assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(databaseName));
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`).catch(() => failures.push(`清理临时库 ${databaseName} 失败`));
    }
    await admin.end({ timeout: 5 });
    if (failures.length) throw new Error(failures.join("；"));
  };
  try {
    // COPY 前先证明源配置可用，错误不输出 URL、密钥或密文字段。
    const providers = await source.select().from(s.aiProviders);
    const models = await source.select().from(s.aiModels);
    const scenes = await source.select().from(s.aiScenes);
    const prompts = await source.select().from(s.prompts);
    const versions = await source.select().from(s.promptVersions);
    const chat = scenes.find(row => row.code === "general_chat" && row.enabled);
    assert(chat?.allowTools, "general_chat 尚未开放真实 Agent Tools，不能验收真实对话链");
    assert(chat.allowKnowledgeSearch, "general_chat 尚未开放正式知识检索，不能验收来源与业务解释");
    assert(models.some(row => row.id === chat.defaultModelId && row.enabled && row.lastTestStatus === "PASSED"), "未配置已通过准入测试的正式聊天模型");
    stage = "连接隔离Redis命名空间";
    await Promise.all([rawRedis.connect(), redis.connect()]);
    stage = "创建随机临时数据库";
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 5, connect_timeout: 5, onnotice: () => {} });
    const db = drizzle(client, { schema: s });
    stage = "在临时库执行迁移";
    await migrate(db, { migrationsFolder: path.resolve("drizzle") });
    stage = "向临时库复制运行配置";
    // 迁移带有系统预置场景：清除只属于随机临时库的默认配置，随后保持源配置 ID/版本。
    await db.delete(s.promptVersions); await db.delete(s.prompts); await db.delete(s.aiScenes);
    if (providers.length) await db.insert(s.aiProviders).values(providers.map(row => ({ ...row, createdById: null, updatedById: null })));
    if (models.length) await db.insert(s.aiModels).values(models);
    if (scenes.length) await db.insert(s.aiScenes).values(scenes.map(row => ({ ...row, promptId: null })));
    if (prompts.length) await db.insert(s.prompts).values(prompts.map(row => ({ ...row, activeVersionId: null })));
    if (versions.length) await db.insert(s.promptVersions).values(versions.map(row => ({ ...row, createdById: null, publishedById: null })));
    for (const row of prompts) await db.update(s.prompts).set({ activeVersionId: row.activeVersionId }).where(eq(s.prompts.id, row.id));
    for (const row of scenes) await db.update(s.aiScenes).set({ promptId: row.promptId }).where(eq(s.aiScenes.id, row.id));
    await sourceClient.end({ timeout: 5 });
    const defaults = { connection: rawRedis, prefix, defaultJobOptions: { removeOnComplete: true, removeOnFail: true } };
    queues = {
      documentProcessing: new Queue(QUEUE_NAMES.DOCUMENT_PROCESSING, defaults), reportGeneration: new Queue(QUEUE_NAMES.REPORT_GENERATION, defaults),
      maintenance: new Queue(QUEUE_NAMES.MAINTENANCE, defaults), aiTitleGeneration: new Queue(QUEUE_NAMES.AI_TITLE_GENERATION, defaults),
      aiConversationMaintenance: new Queue(QUEUE_NAMES.AI_CONVERSATION_MAINTENANCE, defaults), thermalImport: new Queue(QUEUE_NAMES.THERMAL_IMPORT, defaults),
      collectionFetch: new Queue(QUEUE_NAMES.COLLECTION_FETCH, defaults), pageRecognition: new Queue(QUEUE_NAMES.PAGE_RECOGNITION, defaults)
    };
    for (const queue of Object.values(queues)) queue.on("error", () => {});
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.decorate("db", db); app.decorate("sqlClient", client); app.decorate("redis", redis); app.decorate("queues", queues); app.decorate("storage", storage);
    await app.register(errorHandlerPlugin); await app.register(authPlugin);
    await app.register(aiRoutes, { prefix: "/api/v1/ai" });
    await app.register(aiKnowledgeRoutes, { prefix: "/api/v1/ai/knowledge" });
    await app.register(aiThermalRoutes, { prefix: "/api/v1/ai/thermal" });
    stage = "创建固定正式业务fixture";
    const owner = (await db.insert(s.users).values({ displayName: "AI UAT资料管理员", role: "NORMAL_USER" }).returning())[0]!;
    const published = { status: "PUBLISHED" as const, evidenceSource: "合成UAT验收资料", evidenceRef: "固定fixture-v1", evidenceLevel: "A" as const };
    const catalog = (await db.insert(s.catalogProducts).values({ name: "I型VICP复合保温板", thermalConductivity: 0.005, correctionFactor: 1.25, thicknessOptionsMm: [18, 20, 22, 25], summary: "低导热系数可降低同热阻所需厚度；防火和造价尚无证据" }).returning())[0]!;
    const catalogII = (await db.insert(s.catalogProducts).values({ name: "II型VICP复合保温板", thermalConductivity: 0.006, correctionFactor: 1.2, thicknessOptionsMm: [18], summary: "仅有测试热工参数，不推断防火和造价" }).returning())[0]!;
    await db.insert(s.catalogProducts).values({ name: "岩棉测试产品", thermalConductivity: 0.040, correctionFactor: 1, thicknessOptionsMm: [50], summary: "仅有热工参数，防火/造价没有正式证据" });
    const series = (await db.insert(s.productSeries).values({ code: "UAT-VICP", name: "UAT VICP", ...published }).returning())[0]!;
    const base = (await db.insert(s.materials).values({ code: "UAT-BASE", name: "灰砂砖", ...published }).returning())[0]!;
    await db.insert(s.materialParameterVersions).values({ materialId: base.id, thermalConductivity: 0.9, correctionFactor: 1, ...published });
    const a14Base = (await db.insert(s.materials).values({ code: "UAT-A14-BASE", name: "A1-4测试基层", ...published }).returning())[0]!;
    await db.insert(s.materialParameterVersions).values({ materialId: a14Base.id, thermalConductivity: 2.5, correctionFactor: 1, ...published });
    const set = (await db.insert(s.thermalReferenceSets).values({ code: "UAT-ATLAS", name: "合成UAT参考选用表", ...published }).returning())[0]!;
    const doc = (await db.insert(s.knowledgeDocuments).values({ title: "销售与设计院UAT测试图集", visibility: "PUBLIC", createdById: owner.id }).returning())[0]!;
    const version = (await db.insert(s.knowledgeDocumentVersions).values({ documentId: doc.id, version: 1, title: doc.title, status: "PUBLISHED", usageMode: "AI_ENABLED", createdById: owner.id }).returning())[0]!;
    await db.update(s.knowledgeDocuments).set({ currentVersionId: version.id }).where(eq(s.knowledgeDocuments.id, doc.id));
    await db.insert(s.productKnowledgeLinks).values({ productId: catalog.id, knowledgeDocumentId: doc.id });
    const systemIds = new Map<string, string>(); const schemeIds = new Map<string, string>(); const specIds = new Map<string, string>(); const pageIds = new Map<string, string>();
    for (const kind of ["I", "II"] as const) {
      const system = (await db.insert(s.insulationSystems).values({ code: `UAT-${kind}`, name: `${kind}型 VICP薄抹灰外保温系统`, systemType: "EXTERNAL", ...published }).returning())[0]!;
      systemIds.set(kind, system.id);
    }
    for (const fact of REFERENCE_FACTS) {
      if (!schemeIds.has(fact.schemeCode)) {
        const a14 = fact.schemeCode === "A1-4";
        const scheme = (await db.insert(s.constructionSchemes).values({ systemId: systemIds.get(fact.specClass)!, schemeCode: fact.schemeCode, name: fact.schemeCode, substrateMaterial: a14 ? "A1-4测试基层" : "灰砂砖", substrateThickness: a14 ? 100 : 240, ...published }).returning())[0]!;
        schemeIds.set(fact.schemeCode, scheme.id);
        await db.insert(s.constructionLayers).values([{ schemeId: scheme.id, layerOrder: 1, layerType: "BASE_LAYER", layerName: a14 ? "A1-4测试基层" : "灰砂砖", materialId: a14 ? a14Base.id : base.id, thickness: a14 ? 100 : 240 }, { schemeId: scheme.id, layerOrder: 2, layerType: "PRODUCT_LAYER", layerName: "VICP产品层", thickness: fact.thicknessMm }]);
      }
      const specKey = `${fact.specClass}-${fact.thicknessMm}`;
      if (!specIds.has(specKey)) {
        const spec = (await db.insert(s.productSpecs).values({ seriesId: series.id, catalogProductId: fact.specClass === "I" ? catalog.id : catalogII.id, specCode: `UAT-${specKey}`, specClass: fact.specClass, thicknessMm: fact.thicknessMm, ...published }).returning())[0]!;
        specIds.set(specKey, spec.id);
        await db.insert(s.productParameters).values([{ specId: spec.id, parameterCode: "lambda_eq", parameterName: "当量导热系数", value: fact.specClass === "I" ? 0.005 : 0.006, unit: "W/(m·K)", paramSource: "ATLAS", ...published }, { specId: spec.id, parameterCode: "a_eq", parameterName: "修正系数", value: fact.specClass === "I" ? 1.25 : 1.2, paramSource: "ATLAS", ...published }]);
      }
      await db.insert(s.schemeProductOptions).values({ schemeId: schemeIds.get(fact.schemeCode)!, productSpecId: specIds.get(specKey)!, minThickness: 10, maxThickness: 50, defaultThickness: fact.thicknessMm });
      if (!pageIds.has(fact.sourcePageLabel)) {
        const key = `${prefix}/page-${fact.sourcePageLabel}.png`;
        const canvas = createCanvas(1000, 1200); const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1000, 1200); ctx.fillStyle = "black"; ctx.font = "24px sans-serif";
        ctx.fillText(`UAT fixture page ${fact.sourcePageLabel}`, 30, 60);
        REFERENCE_FACTS.filter(row => row.sourcePageLabel === fact.sourcePageLabel).forEach((row, index) => ctx.fillText(`${row.schemeCode} ${row.thicknessMm}mm: Rp=${row.productThermalResistance} Rt=${row.totalThermalResistance} K=${row.kValue}`, 30, 120 + index * 60));
        stage = "上传独立UAT页图";
        objectKeys.push(key); await storage.putObject(key, canvas.toBuffer("image/png"), "image/png");
        stage = "创建固定正式业务fixture";
        const pageText = FIXTURE_TEXT.split("\n").filter(line => !/印刷页\d+/.test(line) || line.includes(`印刷页${fact.sourcePageLabel}`)).join("\n");
        const section = (await db.insert(s.knowledgeSections).values({ documentId: doc.id, versionId: version.id, sectionKey: `UAT-PAGE-${fact.sourcePageLabel}`, title: `测试图集第${fact.sourcePageLabel}页`, startPage: Number(fact.sourcePageLabel), endPage: Number(fact.sourcePageLabel), headingPath: [doc.title, `第${fact.sourcePageLabel}页`], searchText: pageText }).returning())[0]!;
        const page = (await db.insert(s.knowledgePages).values({ documentId: doc.id, versionId: version.id, sectionId: section.id, pageNumber: Number(fact.sourcePageLabel), physicalPageNumber: Number(fact.sourcePageLabel), pageLabel: fact.sourcePageLabel, pageLabelSource: "MANUAL", pageLabelVerified: true, parsedText: pageText, pageImageObjectKey: key, metadata: { recognitionStatus: "CONFIRMED", uploadSource: "PNG" } }).returning())[0]!;
        pageIds.set(fact.sourcePageLabel, page.id);
        const block = (await db.insert(s.knowledgePageBlocks).values({ documentId: doc.id, versionId: version.id, pageId: page.id, sectionId: section.id, blockIndex: 0, content: pageText, searchText: pageText }).returning())[0]!;
        await db.insert(s.knowledgeChunks).values({ documentId: doc.id, versionId: version.id, sectionId: section.id, pageBlockId: block.id, sourcePage: page.pageNumber, pageEnd: page.pageNumber, chunkIndex: pageIds.size - 1, content: pageText, searchText: pageText, metadata: { pageId: page.id, visualPage: true, source: "PAGE_RECOGNITION" } });
      }
      const { specClass: _specClass, schemeCode: _schemeCode, ...values } = fact;
      await db.insert(s.thermalReferenceRows).values({ ...values, catalogProductId: fact.specClass === "I" ? catalog.id : catalogII.id, rawThickness: String(fact.thicknessMm), rawProductResistance: fact.productThermalResistance.toFixed(3), rawTotalResistance: fact.totalThermalResistance.toFixed(3), rawKValue: fact.kValue.toFixed(3), setId: set.id, schemeId: schemeIds.get(fact.schemeCode)!, productSpecId: specIds.get(specKey)!, sourceDocumentId: doc.id, sourcePageId: pageIds.get(fact.sourcePageLabel)!, evidenceSource: doc.title, evidenceRef: `${fact.sourcePageLabel}页 ${fact.schemeCode}` });
    }
    await db.insert(s.thermalCalcRules).values({ code: "UAT-CALC", name: "UAT确定性规则", formulaVersion: "VICP-CALC-1", interiorSurfaceResistance: 0.11, exteriorSurfaceResistance: 0.04, precision: 3, roundingMode: "HALF_UP", parameterCodes: { equivalentConductivity: "lambda_eq", correctionFactor: "a_eq" }, ...published });
    stage = "启动本机独立测试API";
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    return { app, db, baseUrl, prefix, databaseName, cleanup,
      runtimeConfig: { models: models.filter(row => row.enabled && row.lastTestStatus === "PASSED").map(row => ({ id: row.id, model: row.modelId, reasoningLevel: row.reasoningLevel })), defaultModelId: chat.defaultModelId, reasoningModelId: chat.reasoningModelId },
      fixture: { docId: doc.id, versionId: version.id, pageIds, systemIds, schemeIds, specIds, catalogIds: { I: catalog.id, II: catalogII.id }, A13 }, async createUser(persona: UatPersona, caseId: string) {
      const user = (await db.insert(s.users).values({ displayName: `UAT ${persona} ${caseId}`, role: "NORMAL_USER", adminLoginEnabled: false }).returning())[0]!;
      await db.insert(s.userAppAccess).values({ userId: user.id, app: "CLIENT", role: "NORMAL_USER", status: "ACTIVE" });
      return { id: user.id, token: app.jwt.sign({ sub: user.id, tokenType: "access", clientType: "PC_AI", aud: "client", role: "NORMAL_USER", jti: randomUUID() }, { expiresIn: "2h" }) };
    } };
  } catch (error) {
    // 清理失败不能顶掉真实失败原因：保留原始错误，把清理异常作为附加说明。
    let cleanupNote = "";
    try { await cleanup(); } catch (cleanupError) { cleanupNote = `；清理未完成：${cleanupError instanceof Error ? cleanupError.message : "未知"}`; }
    // postgres 的原始错误可能携带连接/SQL参数；只保留非敏感的错误类型和业务前置检查。
    const cause = error as { code?: unknown; cause?: { code?: unknown }; errors?: { code?: unknown }[] };
    const code = cause.code ?? cause.cause?.code ?? cause.errors?.map(item => item.code).join(",") ?? "UNKNOWN";
    throw new Error(error instanceof assert.AssertionError ? error.message : `隔离UAT环境准备失败：${stage}（${String(code)}）${cleanupNote}`);
  }
}
