import "dotenv/config";
import { describe, expect, it } from "vitest";
import { runSearch, searchWikiHierarchy } from "./knowledge.service.js";

const documentTextRow = {
  chunkId: "chunk-document-text",
  documentId: "doc-1",
  versionId: "version-1",
  content: "Mammoth fallback text",
  sourcePage: null,
  sourceSection: null,
  sourceTitle: "测试文档",
  version: 1,
  docNumber: null,
  citationAnchor: null,
  contentType: "PARAGRAPH",
  sectionId: null,
  pageBlockId: null,
  pageId: null,
  score: 1,
  phraseScore: 1,
  keywordScore: 0,
  aliasScore: 0,
  fulltextScore: 0,
  fuzzyScore: 0,
  titleScore: 0,
  clauseScore: 0,
  systemScore: 0,
  evidenceScore: 0,
  currentScore: 0,
  evidenceLevel: null,
  usageScope: null,
  region: null,
  sourceType: "DOCUMENT_TEXT"
};

function makeSearchApp() {
  const queries: string[] = [];
  const sqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((result, part, index) => `${result}${part}${index < values.length ? String(values[index]) : ""}`, "");
    queries.push(query);
    if (query.includes('select\n      kc.id as "chunkId"')) {
      return Promise.resolve(query.includes("not coalesce((") ? [] : [documentTextRow]);
    }
    return query;
  };
  const emptyQuery = {
    from: () => emptyQuery,
    where: () => emptyQuery,
    then: (resolve: (value: unknown[]) => void) => resolve([])
  };
  return {
    app: { db: { select: () => emptyQuery }, sqlClient } as any,
    queries
  };
}

describe("knowledge search traceability", () => {
  it("production retrieval excludes DOCUMENT_TEXT when the version has page-aware chunks", async () => {
    const { app, queries } = makeSearchApp();
    const hits = await runSearch(app, "测试文本", { limit: 5 });
    expect(hits).toHaveLength(0);
    expect(queries.at(-1)).toContain("page_aware.metadata->>'pageAware' = 'true'");
    expect(queries.at(-1)).toContain("kc.metadata->>'visualPage' = 'false'");
  });

  it("draft version tests can return the fallback and mark it untraceable", async () => {
    const { app, queries } = makeSearchApp();
    const hits = await runSearch(app, "测试文本", { versionId: "draft-version", limit: 5 });
    expect(hits[0]).toMatchObject({ sourceType: "DOCUMENT_TEXT", traceable: false, pageId: null });
    expect(queries.at(-1)).not.toContain("page_aware.metadata->>'pageAware'");
  });
});

/** 层级检索（AI 正式对话 search_knowledge 主入口）的守卫 SQL 采集 */
function makeWikiSearchApp() {
  const queries: string[] = [];
  const sqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce(
      (result, part, index) => `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      ""
    );
    queries.push(query);
    return Promise.resolve([] as unknown[]);
  };
  const emptyQuery: any = {
    from: () => emptyQuery,
    where: () => emptyQuery,
    innerJoin: () => emptyQuery,
    orderBy: () => emptyQuery,
    then: (resolve: (value: unknown[]) => void) => resolve([])
  };
  return {
    app: { db: { select: () => emptyQuery }, sqlClient, log: { warn: () => undefined } } as any,
    queries
  };
}

describe("页面驱动知识正式 AI 检索（不依赖 ORIGINAL）", () => {
  it("层级检索守卫只要求 PUBLISHED + AI_ENABLED + 当前受控版本，不按 ORIGINAL/file_id 过滤", async () => {
    const { app, queries } = makeWikiSearchApp();
    await searchWikiHierarchy(app, "保温装饰板 产品层热阻", { limit: 5 });
    const guards = queries.filter((query) => query.includes("kdv.status = 'PUBLISHED'"));
    expect(guards.length).toBeGreaterThanOrEqual(2);
    for (const guard of guards) {
      expect(guard).toContain("kdv.usage_mode = 'AI_ENABLED'");
      expect(guard).toContain("kd.status = 'ACTIVE'");
    }
    // 当前受控版本守卫：层级检索用 kdv.id，Chunk 辅助召回用 kc.version_id，语义一致
    expect(queries.some((query) => query.includes("kd.current_version_id = kdv.id"))).toBe(true);
    expect(queries.some((query) => query.includes("kd.current_version_id = kc.version_id"))).toBe(true);
    // 无 ORIGINAL / 文件资产参与过滤：页面驱动知识（originalFileId=null）同样可命中
    for (const query of queries) {
      expect(query).not.toContain("knowledge_document_assets");
      expect(query).not.toContain("ORIGINAL");
    }
    expect(queries.some((query) => query.includes("usage_mode = 'AI_ENABLED'"))).toBe(true);
  });

  it("检索三层（章节 / 页面块 / Chunk）均检索已发布版本内容", async () => {
    const { app, queries } = makeWikiSearchApp();
    await searchWikiHierarchy(app, "热阻", { limit: 5 });
    const hierarchyQueries = queries.filter((query) =>
      query.includes("from knowledge_sections ks")
      || query.includes("from knowledge_page_blocks kpb")
      || query.includes("from knowledge_chunks kc"));
    expect(hierarchyQueries.some((query) => query.includes("from knowledge_sections ks"))).toBe(true);
    expect(hierarchyQueries.some((query) => query.includes("from knowledge_page_blocks kpb"))).toBe(true);
    expect(hierarchyQueries.some((query) => query.includes("from knowledge_chunks kc"))).toBe(true);
  });
});
