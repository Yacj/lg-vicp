import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../src/config/env.js";
import * as schema from "../src/db/schema.js";
import { createObjectStorage } from "../src/storage/index.js";
import { readPageRecognitionMeta } from "../src/shared/page-recognition.js";
import { visiblePageLabel } from "../src/shared/page-label.js";
import { decideDomainTurn } from "../src/modules/ai/ai-domain-turn-decision.js";
import { resolveStructuredReferenceQuery } from "../src/modules/ai/structured-reference-query.js";
import { loadPublishedKnowledgeReferences, readConsumableReferencePages, resolveConfirmedReferenceAnswer } from "../src/modules/ai/ai-reference-pages.service.js";
import { loadKnowledgeTestReferences } from "../src/modules/knowledge/knowledge-test-reference.js";
import { searchProjectKnowledge, searchWikiHierarchy, type WikiHit } from "../src/modules/knowledge/knowledge.service.js";

const report = { startedAt: new Date().toISOString(), mode: "EXPLICIT_REPEATABLE_READ_READ_ONLY", checks: [] as Array<Record<string, unknown>> };
const record = (name: string, status: string, details: unknown = {}) => {
  const check = { name, status, details }; report.checks.push(check); console.log(JSON.stringify(check));
};
const safeError = (error: unknown) => ({ errorType: error instanceof Error ? error.name : "UNKNOWN",
  code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined,
  ...(error instanceof assert.AssertionError ? { actual: error.actual, expected: error.expected, operator: error.operator } : {}) });
const canonicalCode = (value: string) => value.normalize("NFKC").replace(/\s/g, "").replace(/^外墙/, "").toUpperCase();
const expected = [
  ["A3-1", "钢筋混凝土", 45, 3.313, 0.302],
  ["A3-2", "混凝土空心砌块", 45, 3.398, 0.294],
  ["A3-3", "蒸压灰砂砖", 45, 3.416, 0.293],
  ["A3-4", "加气混凝土砌块", 45, 4.040, 0.248]
];
const question = "Ⅲ型 VICP 薄抹灰，45mm 厚，不同基层传热系数有什么区别？";

async function run(sslRetry: boolean) {
  const client = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 8, onnotice: () => {},
    ...(sslRetry ? { ssl: "require" as const } : {}),
    connection: { default_transaction_read_only: "on", application_name: "vicp-cross-page-reference-readonly" } });
  try {
    await client.begin("isolation level repeatable read read only", async tx => {
      await tx`set local statement_timeout = '30s'`;
      await tx`set local lock_timeout = '2s'`;
      const [proof] = await tx`select current_setting('transaction_read_only') as read_only,
        current_setting('transaction_isolation') as isolation`;
      assert.equal(proof?.read_only, "on"); assert.equal(proof?.isolation, "repeatable read");
      record("真实数据库显式只读事务", "PASS", { ...proof, sslRetry });
      // postgres.js事务句柄不携带options，Drizzle适配器需要共享原连接的解析配置；仅补充内存属性。
      const db = drizzle(Object.assign(tx, { options: client.options }) as unknown as postgres.Sql, { schema });
      const storage = createObjectStorage(env);
      let signed = 0;
      const app = { db, sqlClient: tx, log: { warn: () => {} }, storage: {
        createDownloadUrl: async (key: string, filename: string, seconds: number) => {
          const url = await storage.createDownloadUrl(key, filename, seconds); signed++; return url;
        }
      } } as any;
      const docs = await db.select({ documentId: schema.knowledgeDocuments.id, title: schema.knowledgeDocuments.title,
        versionId: schema.knowledgeDocumentVersions.id, systemId: schema.knowledgeDocuments.insulationSystemId })
        .from(schema.knowledgeDocuments).innerJoin(schema.knowledgeDocumentVersions,
          and(eq(schema.knowledgeDocuments.currentVersionId, schema.knowledgeDocumentVersions.id), eq(schema.knowledgeDocuments.id, schema.knowledgeDocumentVersions.documentId)))
        .where(and(isNull(schema.knowledgeDocuments.projectId), isNull(schema.knowledgeDocuments.deletedAt),
          eq(schema.knowledgeDocuments.status, "ACTIVE"), eq(schema.knowledgeDocumentVersions.status, "PUBLISHED"), eq(schema.knowledgeDocumentVersions.usageMode, "AI_ENABLED"))).limit(30);
      const accessible: Array<{ doc: typeof docs[number]; rows: Awaited<ReturnType<typeof readConsumableReferencePages>> }> = [];
      for (const doc of docs) {
        const pages = await db.select({ id: schema.knowledgePages.id }).from(schema.knowledgePages).where(eq(schema.knowledgePages.versionId, doc.versionId));
        const rows = await readConsumableReferencePages(app, pages.map(page => page.id), null);
        if (rows.some(row => readPageRecognitionMeta(row.page.metadata).confirmedStructuredData?.systems.some(system => canonicalCode(system.constructionCode ?? "") === "A3-2"))) accessible.push({ doc, rows });
      }
      record("当前平台发布确认资料范围", accessible.length ? "PASS" : "DATA_UNAVAILABLE", {
        publishedDocumentsExamined: docs.length, related: accessible.map(({ doc, rows }) => ({ title: doc.title, versionId: doc.versionId, pages: rows.length })) });
      assert.ok(accessible.length, "目标确认资料不可用");
      const { doc, rows } = accessible[0]!;
      const raw = rows.flatMap(({ page }) => {
        const data = readPageRecognitionMeta(page.metadata).confirmedStructuredData;
        return data?.systems.flatMap(system => (system.options ?? []).filter(option => option.thicknessMm === 45
          && ["A3-1", "A3-2", "A3-3", "A3-4"].includes(canonicalCode(system.constructionCode ?? "")))
          .map(option => ({ constructionCode: system.constructionCode, specClass: system.specClass, pageTitle: data.pageTitle, baseMaterial: system.baseMaterial, pageLabel: visiblePageLabel(page),
            pageId: page.id, systemName: system.systemName, ...option }))) ?? [];
      }).sort((a, b) => canonicalCode(a.constructionCode ?? "").localeCompare(canonicalCode(b.constructionCode ?? "")));
      record("真实确认原始四档位", "OBSERVED", raw);
      assert.deepEqual(raw.map(row => [canonicalCode(row.constructionCode ?? ""), row.baseMaterial, row.thicknessMm, row.totalThermalResistance, row.kValue]), expected);
      record("原始确认快照与业务复现四行一致", "PASS");
      const allOptions = rows.flatMap(({ page }) => readPageRecognitionMeta(page.metadata).confirmedStructuredData?.systems.flatMap(system => system.options ?? []) ?? []);
      record("确认数据概况", "INFO", { pages: rows.length, options: allOptions.length, completeOptions: allOptions.filter(option => [option.thicknessMm, option.productThermalResistance, option.totalThermalResistance, option.kValue].every(value => value != null)).length });
      const [referenceCount] = await tx`select count(*)::int as rows, count(source_page_id)::int as with_source_page from thermal_reference_rows`;
      record("热工参考行概况（不执行同步）", "INFO", referenceCount);

      const directHits: WikiHit[] = [{ sourceId: raw[0]!.pageId, pageId: raw[0]!.pageId, documentId: doc.documentId, versionId: doc.versionId,
        content: "", sourcePage: null, sourceSection: null, sourceTitle: doc.title, retrievalUnit: "PAGE", score: 1 }];
      const checkResult = (result: Awaited<ReturnType<typeof loadPublishedKnowledgeReferences>>, name: string) => {
        const candidates = result.solutionCandidates ?? [];
        assert.equal(result.totalMatched, 4); assert.equal(result.totalGroups, 4); assert.equal(candidates.length, 4);
        assert.deepEqual(candidates.map(row => [canonicalCode(row.schemeCode ?? ""), row.substrateMaterial, row.thicknessMm, row.totalThermalResistance, row.kValue]), expected);
        const resolved = resolveConfirmedReferenceAnswer(result.answer!, result.pages);
        assert.equal(resolved.pages.length, 2); assert.equal(resolved.pages.flatMap(page => page.matches).length, 4);
        for (const candidate of candidates) {
          const page = resolved.pages.find(page => page.page.pageId === candidate.sourcePageId)!;
          assert.ok(page.matches.some(match => match.optionId === candidate.optionId && match.summary.kValue === candidate.kValue));
        }
        record(name, "PASS", { totalMatched: result.totalMatched, totalGroups: result.totalGroups,
          values: candidates.map(row => ({ constructionCode: row.schemeCode, baseMaterial: row.substrateMaterial, thicknessMm: row.thicknessMm,
            productThermalResistance: row.productThermalResistance, totalThermalResistance: row.totalThermalResistance, kValue: row.kValue,
            sourcePageId: row.sourcePageId, pageLabel: row.sourcePageLabel, optionId: row.optionId })),
          citations: resolved.pages.map(page => ({ pageId: page.page.pageId, pageLabel: page.page.pageLabel, options: page.matches.map(match => match.optionId) })), answer: resolved.text });
      };
      assert.equal(decideDomainTurn(question).intent, "REFERENCE_QUERY");
      const comparison = await loadPublishedKnowledgeReferences(app, directHits, null, question);
      checkResult(comparison, "真实数据库单页输入扩展为四条两页");

      const actualHits = await searchProjectKnowledge(app, null, question, { insulationSystemId: doc.systemId, limit: 5 });
      record("真实生产检索入口", actualHits.length ? "PASS" : "FAIL", actualHits.map(hit => ({ documentId: hit.documentId, versionId: hit.versionId, pageId: hit.pageId, pageLabel: hit.pageLabel, retrievalUnit: hit.retrievalUnit })));
      const selectedHits = actualHits.filter(hit => hit.documentId === doc.documentId);
      assert.ok(selectedHits.length, "当前资料未进入真实检索结果");
      checkResult(await loadPublishedKnowledgeReferences(app, selectedHits, null, question), "真实生产检索→所选版本→四条两页");

      const minimumMessage = "Ⅲ型45mm哪种基层的K最低？";
      const minimumQuery = resolveStructuredReferenceQuery(minimumMessage, { query: comparison.query!, candidates: comparison.solutionCandidates! })!;
      const minimum = await loadPublishedKnowledgeReferences(app, directHits, null, minimumMessage, minimumQuery.query);
      assert.equal(minimum.totalMatched, 4);
      assert.equal(minimum.solutionCandidates?.[0]?.kValue, 0.248);
      assert.equal(canonicalCode(minimum.solutionCandidates?.[0]?.schemeCode ?? ""), "A3-4");
      record("真实最低K查询", "PASS", { constructionCode: minimum.solutionCandidates?.[0]?.schemeCode, kValue: 0.248 });
      for (const [message, r0, k] of [["Ⅲ型 A3-4 45mm 的总热阻是多少？", 4.040, 0.248], ["Ⅲ型 A3-2 18mm 是多少？", 1.598, 0.626]] as const) {
        const result = await loadPublishedKnowledgeReferences(app, directHits, null, message);
        assert.equal(result.totalMatched, 1); assert.equal(result.solutionCandidates?.[0]?.totalThermalResistance, r0); assert.equal(result.solutionCandidates?.[0]?.kValue, k);
        record(message, "PASS", { totalMatched: result.totalMatched, totalThermalResistance: r0, kValue: k });
      }
      const first = await loadPublishedKnowledgeReferences(app, directHits, null, "Ⅲ型VICP薄抹灰外保温系统，A3-2构造45mm，传热系数是多少？基层是什么？");
      assert.equal(first.totalMatched, 1);
      const followup = resolveStructuredReferenceQuery("相同厚度不同基层比较", { query: first.query!, candidates: first.solutionCandidates! })!;
      assert.equal(followup.needsClarification, false); assert.equal(followup.query.schemeCode, undefined);
      checkResult(await loadPublishedKnowledgeReferences(app, directHits, null, "相同厚度不同基层比较", followup.query), "真实数据同轮序列：单构造→同厚度四基层（内存上下文）");
      assert.equal(decideDomainTurn("K 和 R₀ 的区别？", { query: first.query!, candidates: first.solutionCandidates! }).intent, "KNOWLEDGE_EXPLAIN");
      assert.equal(decideDomainTurn("第一个和第三个比较", { query: first.query!, candidates: first.solutionCandidates! }).intent, "COMPARE_CANDIDATES");
      record("概念/序号比较路由", "PASS");

      const bHits = await searchWikiHierarchy(app, question, { versionId: doc.versionId, limit: 5 });
      const b = await loadKnowledgeTestReferences(app, doc.versionId, doc.title, bHits, question);
      assert.equal(b.totalMatched, 4); assert.equal(b.totalGroups, 4); assert.equal(b.citationOptionIds?.length, 4);
      assert.deepEqual(b.citationOptionIds, (await loadPublishedKnowledgeReferences(app, directHits, null, question)).citationOptionIds);
      record("真实B端指定版本与C端事实/optionId一致", "PASS", { totalMatched: b.totalMatched, totalGroups: b.totalGroups, pages: b.pages.length });

      const actualPageIds = [...new Set(raw.map(row => row.pageId))];
      for (const pageId of actualPageIds) {
        const source = rows.find(row => row.page.id === pageId)!;
        try {
          const metadata = await storage.statObject(source.page.pageImageObjectKey!);
          assert.ok(metadata && metadata.size > 0);
          record("真实原页图只读HEAD", "PASS", { pageId, pageLabel: visiblePageLabel(source.page), bytes: metadata.size });
        } catch (error) {
          record("真实原页图只读HEAD", "BLOCKED", { pageId, pageLabel: visiblePageLabel(source.page), ...safeError(error) });
        }
      }
      const [endProof] = await tx`select current_setting('transaction_read_only') as read_only`;
      assert.equal(endProof?.read_only, "on");
      record("数据库事实链验证结束只读状态", "PASS", { readOnly: true, signedUrlsGenerated: signed, urlsPersisted: false,
        liveConversationHttpSse: "NOT RUN：会写消息/审计/候选状态", modelGateway: "NOT RUN：本次验证确定性数据库事实链" });
    });
  } finally { await client.end({ timeout: 3 }); }
}

try {
  try { await run(false); }
  catch (error) {
    if (error instanceof Error && /pg_hba/.test(error.message) && /SSL off|no encryption/i.test(error.message)) {
      record("数据库连接TLS重试", "INFO", safeError(error)); await run(true);
    } else throw error;
  }
} catch (error) { record("真实只读验证未通过", "FAIL", safeError(error)); process.exitCode = 1; }
finally {
  await mkdir("docs/ai", { recursive: true });
  await writeFile("docs/ai/cross-page-reference-db-2026-10-13.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + "\n");
}
