/** 隔离HTTP/SSE协议取证：真实共享读取函数 + 内存资料库Fixture。没有业务DB/Redis/OSS/模型调用。 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { buildKnowledgePageRenderModel } from "../src/shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../src/shared/page-recognition.js";
import { thermalQueryStateSchema, type ThermalQueryState } from "../src/modules/thermal/thermal-query-state.js";
import { loadKnowledgeTestReferences, KnowledgeReferenceCitationStream } from "../src/modules/knowledge/knowledge-test-reference.js";
import { loadPublishedKnowledgeReferences } from "../src/modules/ai/ai-reference-pages.service.js";

const output = path.resolve(process.argv[2] ?? "docs/ai/evidence/complex-atlas-phase3");
// 只在此开发取证脚本加载两端真实纯DTO函数；Backend业务代码不依赖前端源码。
const appDto = await import(pathToFileURL(path.resolve("../app/src/utils/referencePage.ts")).href);
const adminDto = await import(pathToFileURL(path.resolve("../admin-web/src/utils/knowledge-page-render.ts")).href);
await mkdir(output, { recursive: true });
const rows = await Promise.all([89, 90, 75].map(async (p, index) => {
  const fixture = JSON.parse(await readFile(new URL(`../tests/fixtures/complex-atlas/page-${p}.json`, import.meta.url), "utf8"));
  const data = fixture.data as PageRecognitionResult;
  return { page: { id: `fixture-page-${p}`, versionId: "fixture-version", documentId: "fixture-document", pageLabel: String(p),
    pageLabelSource: "MANUAL", pageLabelVerified: true, physicalPageNumber: index + 1, pageImageObjectKey: `fixture-only/${p}.png`,
    metadata: { confirmedStructuredData: data } },
    document: { id: "fixture-document", title: "人工源图基线 · 隔离协议Fixture", status: "ACTIVE", deletedAt: null, currentVersionId: "fixture-version", projectId: null },
    version: { id: "fixture-version", status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null } };
}));
const server = Fastify({ logger: false });
// 仅此临时服务使用内存适配器；不是实际 Drizzle/数据库查询或认证路由。
server.decorate("db", { select: (selection?: Record<string, unknown>) => {
  const data = !selection ? rows.map(row => row.page) : Object.keys(selection).join() === "id" ? rows.map(row => ({ id: row.page.id })) : rows;
  const chain: { from: () => unknown; innerJoin: () => unknown; where: () => Promise<unknown> } = {
    from: () => chain, innerJoin: () => chain, where: async () => data };
  return chain;
} } as never);
server.decorate("storage", { createDownloadUrl: async () => "https://fixture.invalid/original.png" } as never);
server.post("/fixture/b/query", async request => {
  const query = thermalQueryStateSchema.parse(request.body);
  return loadKnowledgeTestReferences(server, "fixture-version", rows[0]!.document.title, [], "结构化查询Fixture", query);
});
server.post("/fixture/c/query", async (request, reply) => {
  const query = thermalQueryStateSchema.parse(request.body);
  const result = await loadPublishedKnowledgeReferences(server, [{ documentId: "fixture-document", versionId: "fixture-version", pageId: "fixture-page-89" }] as never, null, "结构化查询Fixture", query);
  assert.equal(result.solutionCandidates, undefined);
  const citations = new KnowledgeReferenceCitationStream();
  const text = citations.push(result.answer ?? "", true);
  const pages = citations.resolve(result.pages, result.citationOptionIds);
  reply.type("text/event-stream");
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: reference_pages\ndata: ${JSON.stringify({ referencePages: pages })}\n\nevent: done\ndata: ${JSON.stringify({ totalMatched: result.totalMatched, totalGroups: result.totalGroups, readOnlyPageFacts: result.readOnlyPageFacts })}\n\n`;
});
const address = await server.listen({ host: "127.0.0.1", port: 0 });
const report: Record<string, unknown> = { scope: "隔离HTTP/SSE + 真实共享读取函数 + 人工内存Fixture；不是真实业务路由、认证、DB、Vision或OSS验收", cases: [], realBackendUat: "NOT_RUN", realBrowser: "NOT_RUN_PHASE3", mobile: "NOT_RUN" };
const cases: unknown[] = [];
try {
  for (const page of [89, 90, 75]) for (const thicknessMm of [20, 25]) {
    const query: ThermalQueryState = { intent: "REFERENCE_LOOKUP", parserSource: "LLM", pageLabel: String(page), thicknessMm,
      applicationPart: page === 75 ? "EXTERNAL_WALL" : "ROOF", ...(page === 75 ? {} : { roofForm: page === 89 ? "SLOPED" : "FLAT" }) };
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) };
    const b = await (await fetch(`${address}/fixture/b/query`, init)).json() as Awaited<ReturnType<typeof loadKnowledgeTestReferences>>;
    const response = await fetch(`${address}/fixture/c/query`, init);
    assert.ok(response.headers.get("content-type")?.startsWith("text/event-stream"));
    const sse = await response.text();
    const event = sse.split("\n\n").find(value => value.startsWith("event: reference_pages"))!;
    const c = JSON.parse(event.split("\ndata: ")[1]!) as { referencePages: typeof b.pages };
    assert.equal(b.totalMatched, 2); assert.equal(c.referencePages.length, 1);
    assert.equal(c.referencePages[0]!.matches.length, 2);
    assert.deepEqual(b.pages[0]!.renderModel, c.referencePages[0]!.renderModel);
    const clientPages = appDto.normalizeReferencePages(c.referencePages);
    assert.deepEqual(clientPages[0].renderModel, b.pages[0]!.renderModel);
    assert.equal(appDto.resolvePageHighlights(clientPages[0].renderModel, clientPages[0].matches, clientPages[0].page.pageId).length, 2);
    assert.equal(adminDto.resolveReferenceHighlights(b.pages[0]!.renderModel, c.referencePages[0]!.matches, c.referencePages[0]!.page.pageId).length, 2);
    assert.ok(!sse.includes("R₀"));
    const base = `page-${page}-${thicknessMm}mm`;
    await writeFile(path.join(output, `${base}.b-http.json`), JSON.stringify({ request: query, response: b }, null, 2));
    await writeFile(path.join(output, `${base}.c-sse.txt`), sse);
    cases.push({ page, thicknessMm, status: "PASS_FIXTURE_HTTP_SSE", matched: b.totalMatched, rows: c.referencePages[0]!.matches,
      appDtoPreserved: true, adminDtoResolved: true,
      sourceVersionId: c.referencePages[0]!.page.versionId, fullOptions: c.referencePages[0]!.renderModel!.constructions.map(group => ({ constructionId: group.constructionId, count: group.options.length })) });
  }
  report.cases = cases;
  report.renderModels = rows.map(row => ({ pageId: row.page.id, model: buildKnowledgePageRenderModel(row.page.id, row.page.metadata.confirmedStructuredData) }));
  await writeFile(path.join(output, "transport-report.json"), JSON.stringify(report, null, 2));
  console.log("PASS_FIXTURE: 6 HTTP/SSE queries, 12 rows; B/C RenderModel identical; no DB/Redis/OSS/model operations");
} finally { await server.close(); }
