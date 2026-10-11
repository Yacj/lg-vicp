import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { createUatEnvironment } from "../tests/uat/environment.js";
import { SseDecoder } from "../tests/uat/sse.js";
import * as s from "../src/db/schema.js";
import { authPlugin } from "../src/plugins/auth.js";
import { errorHandlerPlugin } from "../src/plugins/error-handler.js";
import { knowledgeRoutes } from "../src/modules/knowledge/knowledge.routes.js";
import type { PageRecognitionResult } from "../src/shared/page-recognition.js";
import type { ReferencePageBlock } from "../src/modules/ai/reference-page.js";

// 所有写入均在 UAT factory 的随机临时库中；源运行配置只读。
const out = `logs/knowledge-reference-uat/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
let environment: Awaited<ReturnType<typeof createUatEnvironment>> | undefined;
const app = fastify({ logger: false });
const report: Record<string, unknown> = { status: "BLOCKED", startedAt: new Date().toISOString(), checks: [] };
try {
  console.log("[页面引用验收] 准备隔离数据库、Redis、原页图与真实模型配置。");
  environment = await createUatEnvironment();
  const db = environment.db;
  const [admin] = await db.insert(s.users).values({ displayName: "原页引用验收管理员", role: "SUPER_ADMIN", adminLoginEnabled: true }).returning();
  await db.insert(s.userAppAccess).values({ userId: admin!.id, app: "ADMIN", role: "SUPER_ADMIN", status: "ACTIVE" });
  const token = environment.app.jwt.sign({ sub: admin!.id, tokenType: "access", clientType: "B_ADMIN", aud: "admin", role: "SUPER_ADMIN", jti: randomUUID() }, { expiresIn: "1h" });
  const [document] = await db.insert(s.knowledgeDocuments).values({ title: "完整原页引用协议验收资料", createdById: admin!.id }).returning();
  const [version] = await db.insert(s.knowledgeDocumentVersions).values({ documentId: document!.id, title: document!.title, version: 1, status: "DRAFT", parseStatus: "PARSED", createdById: admin!.id }).returning();
  const [original] = await db.select().from(s.knowledgePages).where(eq(s.knowledgePages.id, environment.fixture.pageIds.get("22")!));
  const snapshot: PageRecognitionResult = { pageTitle: "通用热工协议验收完整表", pageLabel: "22", fullText: "", notes: ["仅用于协议验收，不用于实际工程"], systems: ["A1-3", "A1-4"].map(constructionCode => ({
    constructionCode, systemName: "I型薄抹灰验收保温系统", baseMaterial: "灰砂砖", baseThicknessMm: 240,
    layers: [{ order: 1, name: "灰砂砖", thicknessMm: 240, lambda: 1.1, alpha: 1, rValue: 0.218 }, { order: 2, name: "验收保温板", thicknessMm: null, lambda: 0.005, alpha: 1.25, rValue: null }, { order: 3, name: "抹面胶浆", thicknessMm: 5, lambda: 0.93, alpha: 1, rValue: 0.005 }],
    options: [{ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }, { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 }, { thicknessMm: 25, productThermalResistance: 4, totalThermalResistance: 4.416, kValue: 0.226 }]
  })) };
  snapshot.fullText = snapshot.systems.map(system => `${system.constructionCode} ${system.systemName}：18mm 产品层热阻2.880，总热阻3.297，传热系数0.303；20mm 产品R3.200，总R3.616，K0.277；25mm 产品R4.000，总R4.416，K0.226。`).join("\n");
  const [page] = await db.insert(s.knowledgePages).values({ documentId: document!.id, versionId: version!.id, pageNumber: 1, physicalPageNumber: 1, pageLabel: "22", pageTitle: snapshot.pageTitle, parsedText: snapshot.fullText,
    pageImageObjectKey: original!.pageImageObjectKey, metadata: { recognitionStatus: "CONFIRMED", confirmedStructuredData: snapshot } }).returning();
  await db.insert(s.knowledgeChunks).values({ documentId: document!.id, versionId: version!.id, sourcePage: 1, chunkIndex: 0, content: snapshot.fullText, searchText: snapshot.fullText, metadata: { pageId: page!.id, visualPage: true, source: "PAGE_RECOGNITION" } });
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db); app.decorate("redis", environment.app.redis); app.decorate("queues", environment.app.queues); app.decorate("storage", environment.app.storage);
  await app.register(errorHandlerPlugin); await app.register(authPlugin); await app.register(knowledgeRoutes, { prefix: "/api/v1/platform/knowledge" });
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  // 正式端点同时验证客户端隔离，不能用 C 端令牌读草稿。
  const client = await environment.createUser("SALES", "page-reference");
  const denied = await fetch(`${baseUrl}/api/v1/platform/knowledge/versions/${version!.id}/test-qa`, { method: "POST", headers: { Authorization: `Bearer ${client.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "A1-3 18mm" }) });
  const denial = await denied.json() as { success: boolean };
  assert.equal(denial.success, false, "C端不得访问后台草稿测试");
  report.status = "FAIL";
  const progress = setInterval(() => console.log("[页面引用验收] 真实问答接口仍在生成…"), 30_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1/platform/knowledge/versions/${version!.id}/test-qa`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "分别列出外墙A1-3和外墙A1-4的18mm档位产品层热阻、总热阻和传热系数，给出原页依据。" }), signal: AbortSignal.timeout(180_000) });
    assert(response.headers.get("content-type")?.includes("text/event-stream"), "正式测试接口必须返回SSE");
    const events: { event: string; data: Record<string, unknown> }[] = [];
    const decoder = new TextDecoder(); const parser = new SseDecoder();
    for await (const chunk of response.body!) events.push(...parser.push(decoder.decode(chunk, { stream: true })));
    events.push(...parser.push(decoder.decode())); parser.end();
    assert(!events.some(event => event.event === "error"), "SSE返回错误");
    const done = events.find(event => event.event === "done"); assert(done, "SSE缺少done");
    const answer = events.filter(event => event.event === "delta").map(event => event.data.text).join("");
    assert(!answer.includes("[[KP:") && !answer.includes("kp-"), "内部引用标记不得进入正文");
    const pages = done.data.referencePages as ReferencePageBlock[];
    assert(pages?.length === 1, "真实问答必须提供完整来源页");
    assert.equal(pages[0]!.page.pageId, page!.id);
    assert.equal(pages[0]!.renderModel?.constructions.length, 2);
    for (const construction of pages[0]!.renderModel!.constructions) assert.equal(construction.options.length, 3, "不得裁成命中小表");
    assert.deepEqual(new Set(pages[0]!.matches.map(match => match.summary.constructionCode)), new Set(["A1-3", "A1-4"]));
    for (const match of pages[0]!.matches) {
      assert(match.optionId && match.constructionId && match.fieldKeys?.includes("kValue") && typeof match.answerOffset === "number");
      assert.equal(match.summary.thicknessMm, 18); assert.equal(match.summary.kValue, 0.303);
    }
    const [message] = await db.select().from(s.aiMessages).where(eq(s.aiMessages.id, String(done.data.messageId)));
    assert.equal(message!.content, answer, "落库与SSE可见正文须一致");
    Object.assign(report, { status: "PASS", checks: ["真实B端HTTP/SSE", "C端隔离", "DRAFT限定", "完整双构造全部档位", "同值不同构造正式ID定位", "字段高亮", "回答位置", "正文隐藏内部标记", "消息落库一致"], answer, referencePages: pages });
    console.log("[页面引用验收] PASS：真实接口返回完整表格、正式档位标识及回答位置。");
  } finally { clearInterval(progress); }
} catch (error) {
  // 不输出底层连接URL、SQL或密钥。
  report.error = error instanceof assert.AssertionError ? error.message : environment ? "真实问答链路未完成，请检查运行环境或测试日志。" : error instanceof Error ? error.message : "验收环境不可用";
  console.log(`[页面引用验收] ${String(report.status)}：${String(report.error)}`);
  process.exitCode = 1;
} finally {
  await app.close();
  if (environment) await environment.cleanup();
  await mkdir(out, { recursive: true }); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`[页面引用验收] 报告：${out}/report.json`);
}
