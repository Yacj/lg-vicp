/** 真实隔离UAT：复用正式路由/模型/权限/审核；人工基线与真实Vision分开取证。 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { createUatEnvironment } from "../tests/uat/environment.js";
import { sendTurn, SseDecoder } from "../tests/uat/sse.js";
import * as s from "../src/db/schema.js";
import { authPlugin } from "../src/plugins/auth.js";
import { errorHandlerPlugin } from "../src/plugins/error-handler.js";
import { knowledgeRoutes } from "../src/modules/knowledge/knowledge.routes.js";
import { fileRoutes } from "../src/modules/files/files.routes.js";
import { pageRecognitionResultSchema } from "../src/shared/page-recognition.js";
import { validatePageRecognitionEvidence } from "../src/shared/page-recognition-evidence.js";
import type { ReferencePageBlock } from "../src/modules/ai/reference-page.js";

const out = path.resolve(process.env.ATLAS_UAT_OUTPUT ?? "docs/ai/evidence/complex-atlas-phase5/real-uat");
const a3Only = process.argv.includes("--a3-only");
await mkdir(out, { recursive: true });
const report: Record<string, any> = { scope: "真实隔离DB/Redis/OSS/正式HTTP-SSE/真实模型；事实由人工基线装载，程序模拟审核，不冒充真实人工复核", startedAt: new Date().toISOString(), setup: [], cases: [], permissions: [] };
const privateFile = path.join(os.tmpdir(), `vicp-atlas-uat-${randomUUID()}.json`);
const stopFile = path.join(out, "STOP");
if (existsSync(stopFile)) throw new Error("本次输出目录已有STOP标记，请使用新输出目录或明确检查后移除自己的旧标记");
let environment: Awaited<ReturnType<typeof createUatEnvironment>> | undefined;
let adminApp: ReturnType<typeof Fastify> | undefined;
let adminBase = "";
let adminToken = "";
let clientToken = "";
const pages: Record<string, { id: string; data: any }> = {};
const conversations: Record<string, string> = {};
let documentId = "", versionId = "";
const sanitize = (value: unknown): any => {
  if (typeof value === "string" && /^https?:\/\//.test(value) && /signature|security-token|credential|oss-/i.test(value)) return "[AUTHORIZED_URL_REDACTED]";
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(authorization|accessToken|refreshToken|apiKey)$/i.test(key)).map(([key, item]) => [key, sanitize(item)]));
  return value;
};
const save = async (name: string, value: unknown) => writeFile(path.join(out, name), `${JSON.stringify(sanitize(value), null, 2)}\n`);
const checkpoint = () => save("report.json", report);
async function api(base: string, route: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as any;
  return { http: response.status, ...result };
}
function requireSuccess(result: any) {
  if (!result.success) throw new Error(`正式测试API拒绝：${result.error?.code} ${result.error?.message}`);
  return result.data;
}
function facts(blocks: ReferencePageBlock[]) {
  const rows = blocks.flatMap(block => block.matches.flatMap(match => {
    const construction = block.renderModel?.constructions.find(item => item.constructionId === match.constructionId);
    const option = construction?.options.find(item => item.optionId === match.optionId);
    return construction && option ? [{ page: block.page.pageLabel, constructionId: construction.constructionId, optionId: option.optionId, label: construction.rawConstructionLabel || construction.constructionCode, placement: construction.placement, thickness: option.thicknessMm, r: option.totalThermalResistance, k: option.kValue, base: construction.baseMaterial, versionId: block.page.versionId, revision: block.renderModel?.confirmedRevision, fieldKeys: match.fieldKeys }] : [];
  }));
  // 同档位在数值句和材料说明中可有多个answerOffset；按来源身份统计事实，原始引用仍完整留证。
  return [...new Map(rows.map(row => [`${row.page}:${row.constructionId}:${row.optionId}`,row])).values()];
}
function uniqueBlocks(events: Array<{ event: string; data: Record<string, any> }>): ReferencePageBlock[] {
  const map = new Map<string, ReferencePageBlock>();
  for (const event of events) for (const block of event.data.referencePages ?? []) map.set(block.page.pageId, block);
  return [...map.values()];
}
async function captureB(name: string, query: string) {
  const response = await fetch(`${adminBase}/api/v1/platform/knowledge/versions/${versionId}/test-qa`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, reasoningMode: "OFF" }), signal: AbortSignal.timeout(180_000) });
  const text = await response.text();
  const decoder = new SseDecoder();
  let events: ReturnType<typeof decoder.push> = [];
  try { events = decoder.push(text); decoder.end(); } catch { /* 非SSE错误由下方保留 */ }
  const blocks = uniqueBlocks(events);
  const record = { name, query, http: response.status, contentType: response.headers.get("content-type"), events, blocks, facts: facts(blocks), ...(events.length ? {} : { nonSse: text.slice(0, 2000) }) };
  await save(`b-${name}.json`, record);
  console.log(`[B测试] ${name} HTTP ${response.status}，${blocks.length}页 / ${record.facts.length}命中行`);
  return record;
}
async function conversation(name: string) {
  const created = requireSuccess(await api(environment!.baseUrl, "/api/v1/ai/conversations", clientToken, { clientApp: "c_app", scene: "general_chat", title: `复杂图集隔离UAT ${name}`, reasoningMode: "OFF" }));
  const id = created.conversation.id as string;
  conversations[name] = id;
  return id;
}
async function runTurn(id: string, group: string, question: string, check?: (rows: ReturnType<typeof facts>, blocks: ReferencePageBlock[], answer: string) => void) {
  const conversationId = conversations[group] ?? await conversation(group);
  const record: Record<string, any> = { id, group, question, status: "NOT_RUN", conversationId };
  report.cases.push(record); await checkpoint();
  console.log(`[真实C端] ${id} 开始：${question}`);
  const progress = setInterval(() => console.log(`[真实C端] ${id} 仍在等待模型/正式服务…`), 30_000);
  const captured: any[] = [];
  try {
    const events = await sendTurn(environment!.baseUrl, clientToken, conversationId, question, event => captured.push(event));
    const blocks = uniqueBlocks(events), rows = facts(blocks);
    record.answer = events.filter(event => event.event === "delta").map(event => String(event.data.text ?? "")).join("");
    record.facts = rows; record.pages = blocks.map(block => ({ page: block.page, revision: block.renderModel?.confirmedRevision, groups: block.renderModel?.constructions.length, options: block.renderModel?.constructions.map(item => item.options.length), notes: block.renderModel?.notes }));
    const detail = requireSuccess(await api(environment!.baseUrl, `/api/v1/ai/conversations/${conversationId}`, clientToken));
    const done = events.find(event => event.event === "done")!;
    const message = await environment!.db.select().from(s.aiMessages).where(eq(s.aiMessages.id, String(done.data.messageId)));
    record.historyReturned = Boolean(detail.messages?.some((item: any) => item.id === done.data.messageId));
    assert.equal(record.historyReturned, true, "正式会话详情必须返回本轮已保存消息");
    record.persistedUrlFree = !/Signature=|OSSAccessKeyId=|X-Amz-Signature=/i.test(JSON.stringify(message));
    record.solutionStates = (await environment!.db.select().from(s.solutionStates).where(eq(s.solutionStates.conversationId, conversationId))).length;
    record.reports = (await environment!.db.select().from(s.reports)).length;
    record.snapshots = (await environment!.db.select().from(s.solutionSnapshots)).length;
    assert.equal(record.solutionStates, 0, "只读问题不应激活方案状态"); assert.equal(record.reports, 0, "未Confirm不得生成正式报告"); assert.equal(record.snapshots, 0, "不应自动确认快照");
    assert.equal(record.persistedUrlFree, true);
    check?.(rows, blocks, record.answer);
    record.status = check ? "PASS" : "PARTIAL";
  } catch (error) {
    record.status = "FAIL"; record.error = { name: (error as Error).name, message: (error as Error).message };
  } finally {
    if (a3Only && environment) await save("backend-decisions.json", (await environment.db.select({ action: s.auditLogs.action, after: s.auditLogs.afterJson }).from(s.auditLogs)).filter(row => row.action.startsWith("ai.") && /domain|semantic|query/.test(row.action))).catch(() => {});
    clearInterval(progress); await save(`${id}.sse.json`, captured); await save(`${id}.json`, record); await checkpoint();
    console.log(`[真实C端] ${id} ${record.status}，${record.facts?.length ?? 0}命中行`);
  }
}
function expected(rows: ReturnType<typeof facts>, label: string, thickness: number, values: number[][]) {
  assert.equal(rows.length, values.length, "命中行数必须准确，不能串构造或多返回别的档位");
  values.forEach(([r, k]) => assert.ok(rows.some(row => row.page === label && Number(row.thickness) === thickness && Number(row.r) === r && Number(row.k) === k), `缺少来源事实 ${label}/${thickness}/${r}/${k}`));
  assert.equal(new Set(rows.map(row => `${row.constructionId}:${row.optionId}`)).size, rows.length);
  assert.equal(new Set(rows.map(row => row.constructionId)).size, values.length, "同值两行仍须属于两个独立构造");
}

try {
  console.log("[隔离环境] 创建随机库、Redis/队列前缀与对象命名空间；源库只复制模型配置。");
  environment = await createUatEnvironment();
  report.isolation = { database: environment.databaseName, prefix: environment.prefix };
  // 正式页面接口内部会另存图片；统一在测试适配器边界限制所有对象操作，避免漏掉派生副本。
  const isolatedPrefix = `${environment.prefix}/`;
  const baseStorage = environment.app.storage;
  const keyMethods = new Set(["createUploadUrl", "createDownloadUrl", "createPreviewUrl", "statObject", "getObject", "putObject", "removeObject"]);
  environment.app.storage = new Proxy(baseStorage, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    if (!keyMethods.has(String(property))) return value.bind(target);
    return (key: string, ...args: unknown[]) => {
      const physical = key.startsWith(isolatedPrefix) ? key : `${isolatedPrefix}${key}`;
      if (property === "putObject") { report.objectKeys ??= []; if (!report.objectKeys.includes(physical)) report.objectKeys.push(physical); }
      return value.call(target, physical, ...args);
    };
  } });
  adminApp = Fastify({ logger: false });
  adminApp.setValidatorCompiler(validatorCompiler); adminApp.setSerializerCompiler(serializerCompiler);
  for (const key of ["db", "sqlClient", "redis", "queues", "storage"] as const) adminApp.decorate(key, environment.app[key]);
  await adminApp.register(errorHandlerPlugin); await adminApp.register(authPlugin);
  await adminApp.register(knowledgeRoutes, { prefix: "/api/v1/platform/knowledge" });
  await adminApp.register(fileRoutes, { prefix: "/api/v1/files" });
  adminBase = await adminApp.listen({ host: "127.0.0.1", port: 0 });
  const [admin] = await environment.db.insert(s.users).values({ displayName: "复杂图集隔离审核员（程序测试）", role: "SUPER_ADMIN", adminLoginEnabled: true }).returning();
  await environment.db.insert(s.userAppAccess).values({ userId: admin!.id, app: "ADMIN", role: "SUPER_ADMIN", status: "ACTIVE" });
  adminToken = adminApp.jwt.sign({ sub: admin!.id, tokenType: "access", clientType: "B_ADMIN", aud: "admin", role: "SUPER_ADMIN", jti: randomUUID() }, { expiresIn: "2h" });
  const user = await environment.createUser("SALES", "ATLAS");
  clientToken = environment.app.jwt.sign({ sub: user.id, tokenType: "access", clientType: "C_APP", aud: "client", role: "NORMAL_USER", jti: randomUUID() }, { expiresIn: "2h" });
  const created = requireSuccess(await api(adminBase, "/api/v1/platform/knowledge/documents", adminToken, { title: "复杂建筑热工图集 · 隔离人工基线（程序模拟审核）", docType: "DETAIL_ATLAS", docNumber: "J/CABEE 26J702 / UAT" }));
  documentId = created.documentId; versionId = created.versionId;
  report.fixture = { documentId, versionId, factsOrigin: "MANUAL_SOURCE_BASELINE，非真实Vision确认产物", corrections: [] };
  for (const [index, label] of (a3Only ? ["5", "26"] : ["89", "90", "75"]).entries()) {
    const fixture = JSON.parse(await readFile(`tests/fixtures/complex-atlas/page-${label}.json`, "utf8"));
    const data = pageRecognitionResultSchema.parse(fixture.data);
    assert.equal(validatePageRecognitionEvidence(data).issues.length, 0);
    const bytes = await readFile(fixture.imagePath ?? `../admin-web/docs/ai/evidence/complex-atlas-phase2/source-page-${label}.png`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.imageSha256);
    const key = `${environment.prefix}/complex-atlas/source-${label}.png`;
    // 只在当前随机命名空间装载原件；文件资产是测试准备，不冒称上传UI验收。
    await environment.app.storage.putObject(key, bytes, "image/png");
    const [file] = await environment.db.insert(s.files).values({ originalName: `source-page-${label}.png`, mimeType: "image/png", sizeBytes: bytes.length, sha256: fixture.imageSha256, storageProvider: environment.app.storage.provider, bucket: environment.app.storage.bucket, objectKey: key, status: "READY", ownerUserId: admin!.id }).returning();
    const result = requireSuccess(await api(adminBase, `/api/v1/platform/knowledge/versions/${versionId}/pages`, adminToken, { pageNumber: index + 1, pageLabel: label, pageTitle: data.pageTitle, imageFileId: file!.id, parsedText: data.fullText }));
    const pageId = result.page.id; pages[label] = { id: pageId, data };
    const draft = await api(adminBase, `/api/v1/platform/knowledge/pages/${pageId}/recognition-draft`, adminToken, { structuredData: data, pageLabel: label, pageTitle: data.pageTitle }, "PUT");
    requireSuccess(draft); await save(`page-${label}.draft.json`, draft);
    await save(`page-${label}.manual-baseline.json`, data);
  }
  const draftSource = await api(environment.baseUrl, `/api/v1/ai/knowledge/source-detail?pageId=${pages[a3Only ? "5" : "89"]!.id}`, clientToken);
  report.permissions.push({ name: "DRAFT不能向C端来源开放", passed: draftSource.success === false, response: draftSource });
  report.setup.push({ step: "未确认发布门禁", response: await api(adminBase, `/api/v1/platform/knowledge/versions/${versionId}/publish`, adminToken, {}) });
  for (const [label, page] of Object.entries(pages)) {
    const confirmed = await api(adminBase, `/api/v1/platform/knowledge/pages/${page.id}/confirm-recognition`, adminToken, {});
    requireSuccess(confirmed); await save(`page-${label}.confirmed.json`, confirmed);
    console.log(`[审核流程] 第${label}页经正式HTTP确认（隔离程序测试；未同步热工参考集）`);
  }
  const indexed = await api(adminBase, `/api/v1/platform/knowledge/versions/${versionId}/index/rebuild`, adminToken, {});
  requireSuccess(indexed); await save("index-rebuild.json", indexed);
  requireSuccess(await api(adminBase, `/api/v1/platform/knowledge/versions/${versionId}/approve`, adminToken, { approvalNote: "隔离UAT程序模拟审核：人工数值基线，防水等级待核；不代表真实人工审核" }));
  const published = await api(adminBase, `/api/v1/platform/knowledge/versions/${versionId}/publish`, adminToken, {});
  requireSuccess(published); await save("published.json", published); report.setup.push({ step: "正式审核发布接口", passed: true });
  await checkpoint();
  if (process.argv.includes("--setup-only")) {
    report.setupOnly = "PASS";
    assert.ok(report.objectKeys.every((key: string) => key.startsWith(`${environment!.prefix}/`)));
    report.objectNamespace = { status: "PASS", generatedKeys: report.objectKeys.length };
  } else if (a3Only) {
    report.fixture.corrections = [{ scope: "隔离测试副本", page: 26, before: "旧页签6", after: "原图印刷页码26", productR: "原表材料层R单独保存，不冒充完整产品R" }];
    const single = "Ⅲ型VICP薄抹灰外保温系统，A3-2构造45mm，传热系数是多少？基层是什么？";
    const comparison = "Ⅲ型VICP薄抹灰外保温系统，45mm厚度，不同基层的传热系数有什么区别？";
    const checkSingle = (rows: ReturnType<typeof facts>) => { expected(rows, "5", 45, [[3.398, .294]]); assert.equal(rows[0]!.base, "混凝土空心砌块"); };
    const checkComparison = (rows: ReturnType<typeof facts>) => { assert.equal(rows.length, 4); assert.deepEqual(rows.map(row => Number(row.k)).sort(), [.248, .293, .294, .302]); assert.equal(rows.filter(row => row.page === "26").length, 2); };
    for (const [name, question, check] of [["a3-single", single, checkSingle], ["a3-compare", comparison, checkComparison]] as const) {
      const result = await captureB(name, question);
      let status = "PASS", error: string | undefined;
      try { assert.equal(result.http, 200); check(result.facts); } catch (failure) { status = "FAIL"; error = (failure as Error).message; }
      report.setup.push({ step: `B端知识库测试 ${name}`, status, error });
    }
    await runTurn("A3_SINGLE", "a3-single", single, checkSingle);
    await runTurn("A3_COMPARE", "a3-compare", comparison, checkComparison);
    await runTurn("A3_FOLLOWUP", "a3-compare", "只看A3-2，基层是什么？", checkSingle);
    report.browser = false;
    report.browserNote = "NOT_RUN，本次只验证真实HTTP/SSE及历史，不冒充原生App验收";
    assert.ok(report.objectKeys.every((key: string) => key.startsWith(`${environment!.prefix}/`)));
    report.objectNamespace = { status: "PASS", generatedKeys: report.objectKeys.length };
  } else {
  for (const [name, question] of [
    ["89-20", "I型VICP坡屋面正置和倒置，20mm的传热系数分别多少？看下表。"],
    ["90-20", "II型平屋面正置和倒置的20mm参数一样吗？"],
    ["75-20", "外墙C1-3和C1-4都是20mm，哪个K小？基层什么材料？"],
    ["89-25", "I型VICP坡屋面正置和倒置25mm的R和K分别多少？"],
    ["90-25", "II型平屋面正置和倒置25mm的R和K分别多少？"],
    ["75-25", "外墙C1-3和C1-4的25mm参数分别多少？"],
  ]) {
    const result = await captureB(name!, question!);
    const label = name!.slice(0, 2), thickness = Number(name!.slice(3));
    const values = label === "89" ? thickness === 20 ? [[5.225,.191],[5.198,.192]] : [[6.025,.166],[5.998,.167]]
      : label === "90" ? thickness === 20 ? [[5.369,.186],[5.369,.186]] : [[6.169,.162],[6.169,.162]]
      : thickness === 20 ? [[6.916,.145],[7.540,.133]] : [[8.516,.117],[9.140,.109]];
    let status = "PASS", error: string | undefined;
    try { assert.equal(result.http, 200); expected(result.facts, label, thickness, values); }
    catch (failure) { status = "FAIL"; error = (failure as Error).message; }
    report.setup.push({ step: `B端知识库测试 ${name}`, status, error });
  }
  await runTurn("T01", "roof-I", "I型VICP坡屋面正置和倒置，20mm的传热系数分别多少？看下表。", rows => expected(rows, "89", 20, [[5.225, .191], [5.198, .192]]));
  await runTurn("T02", "roof-I", "改成25厚，只看倒置。", rows => { expected(rows, "89", 25, [[5.998, .167]]); assert.equal(rows[0]!.placement, "INVERTED"); });
  await runTurn("T03", "roof-II", "II型平屋面正置和倒置的20mm参数一样吗？", (rows, _blocks, answer) => { expected(rows, "90", 20, [[5.369, .186], [5.369, .186]]); assert.match(answer,/5\.369/); assert.match(answer,/0\.186/); });
  await runTurn("T11", "roof-II", "确认一下这里的R=5.369是否正确，不是确认方案。", (rows, _blocks, answer) => {
    expected(rows, "90", 20, [[5.369,.186],[5.369,.186]]);
    assert.match(answer, /一致/); assert.doesNotMatch(answer, /请补充.*构造编号|产品层热阻|R₀/);
  });
  await runTurn("T04", "roof-II", "它们做法是不是也完全一样？", (rows, blocks, answer) => {
    expected(rows, "90", 20, [[5.369,.186],[5.369,.186]]);
    assert.match(answer, /不能据此认定构造做法完全相同/);
    const groups = blocks[0]!.renderModel!.constructions;
    assert.notDeepEqual(groups[0]!.layers, groups[1]!.layers);
    assert.match(answer, /原始构造简图/);
  });
  await runTurn("T05", "wall", "外墙C1-3和C1-4都是20mm，哪个K小？基层什么材料？", rows => { expected(rows, "75", 20, [[6.916, .145], [7.540, .133]]); assert.equal(new Set(rows.map(row => row.base)).size, 2); });
  await runTurn("T06", "ambiguous", "只看倒置屋面25厚的K。", rows => { assert.equal(rows.length,2); assert.deepEqual(new Set(rows.map(row=>row.page)),new Set(["89","90"])); assert.ok(rows.every(row=>row.placement==="INVERTED"&&row.thickness===25)); });
  await runTurn("T07", "concept", "I型VICP和I级防水一样吗？", (_rows, _blocks, answer) => {
    assert.match(answer, /型号/); assert.match(answer, /防水/);
    assert.match(answer, /不同|不一样|不是同一|不等同|不能等同|两种|两个/);
    assert.doesNotMatch(answer, /请补充.*构造编号/);
  });
  await runTurn("T08", "full-page", "把第90页原图、备注和完整厚度表打开。", (_rows, blocks) => { const page = blocks.find(block => block.page.pageLabel === "90"); assert.ok(page); assert.equal(page.renderModel?.constructions.length, 2); assert.deepEqual(page.renderModel?.constructions.map(item => item.options.length), [6, 6]); assert.equal(page.renderModel?.notes?.length, 4); });
  await runTurn("T09", "resistance", "20mm保温层的热阻是整体传热阻吗？", (_rows,_blocks,answer) => { assert.match(answer,/不是同一个指标/); assert.match(answer,/未单独给出/); assert.doesNotMatch(answer,/4\.8|0\.11|0\.04/); });
  await runTurn("T10", "compliance", "这些屋面做法在某省2025年能达标吗？生成正式报告。");
  await runTurn("E01", "extra-I", "I型VICP坡屋面正置和倒置25mm的R和K分别多少？", rows => expected(rows,"89",25,[[6.025,.166],[5.998,.167]]));
  await runTurn("E02", "extra-II", "II型平屋面正置和倒置25mm的R和K分别多少？", rows => expected(rows,"90",25,[[6.169,.162],[6.169,.162]]));
  await runTurn("E03", "extra-wall", "外墙C1-3和C1-4的25mm参数分别多少？", rows => expected(rows,"75",25,[[8.516,.117],[9.140,.109]]));
  const otherUser = await environment.createUser("SALES", "OTHER");
  report.permissions.push({ name: "别人的会话不可读取", response: await api(environment.baseUrl, `/api/v1/ai/conversations/${conversations["roof-I"]}`, otherUser.token) });
  report.permissions.push({ name: "C端不可访问B端审核", response: await api(adminBase, `/api/v1/platform/knowledge/pages/${pages["89"]!.id}/recognition`, clientToken) });
  report.permissions.push({ name: "无令牌不可访问B端审核", response: await api(adminBase, `/api/v1/platform/knowledge/pages/${pages["89"]!.id}/recognition`, "") });
  await save("permissions.json", report.permissions);
  await writeFile(privateFile, JSON.stringify({ adminBase, clientBase: environment.baseUrl, adminToken, clientToken, documentId, versionId, pages: Object.fromEntries(Object.entries(pages).map(([label, page]) => [label, page.id])), conversations }));
  report.privateBridgeFile = privateFile; report.readyForBrowser = true; report.finishedTurnsAt = new Date().toISOString(); await checkpoint();
  console.log(`[浏览器待测] 私有桥接文件：${privateFile}（含临时测试凭据，不写入交付证据）；完成后创建 ${stopFile} 结束并清理隔离环境。`);
  await new Promise<void>(resolve => { const timer = setInterval(() => { if (existsSync(stopFile)) { clearInterval(timer); resolve(); } }, 1000); });
  }
} catch (error) {
  report.environmentError = { name: (error as Error).name, message: (error as Error).message };
  console.log(`[UAT未完成] ${(error as Error).message}`); process.exitCode = 1;
} finally {
  if (adminApp) await adminApp.close().catch(() => {});
  if (environment) {
    // 原件额外键不属于通用harness列表，显式仅清理本次生成的完整前缀内对象。
    const objectCleanupFailures: string[] = [];
    for (const key of report.objectKeys ?? []) { assert.ok(key.startsWith(`${environment.prefix}/`)); await environment.app.storage.removeObject(key).catch(() => objectCleanupFailures.push(key)); if (await environment.app.storage.statObject(key).catch(() => true)) objectCleanupFailures.push(key); }
    try { await environment.cleanup(); report.cleanup = objectCleanupFailures.length ? { status: "FAIL", objectCleanupFailures } : "PASS"; } catch (error) { report.cleanup = { status: "FAIL", message: (error as Error).message, objectCleanupFailures }; }
  }
  await rm(privateFile, { force: true });
  report.finishedAt = new Date().toISOString(); await checkpoint();
  report.httpSseStatus = report.environmentError || report.setup.some((item: any) => item.status === "FAIL") || report.cases.some((item: { status: string }) => item.status === "FAIL") || report.cleanup !== "PASS" ? "FAIL" : "PASS";
  report.status = report.environmentError || report.setup.some((item: any) => item.status === "FAIL") || report.cases.some((item: { status: string }) => item.status === "FAIL") || report.cleanup !== "PASS" ? "FAIL"
    : report.cases.some((item: { status: string }) => item.status !== "PASS") || !report.browser ? "PARTIAL" : "PASS";
  await checkpoint();
  if (report.status === "FAIL") process.exitCode = 1;
  console.log("[UAT结束] 已保存报告；仅清理本次随机隔离环境，不修改源库和旧资料。");
}
