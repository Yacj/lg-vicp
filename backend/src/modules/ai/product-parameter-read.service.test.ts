import "dotenv/config";
import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), pending: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
vi.mock("./query-clarification-context.js", () => ({ readQueryClarification: m.pending }));
import { readProductParameters, evaluateLambdaFacts, renderLambdaAnswer, type LambdaFact } from "./product-parameter-read.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import type { ProductParameterQuery } from "./product-parameter-query.js";
const customer = JSON.parse(readFileSync(new URL("../../../tests/fixtures/product-parameters/customer-lambda.json", import.meta.url), "utf8"));
const query = (patch: Partial<ProductParameterQuery> = {}): ProductParameterQuery => ({ parameter: "LAMBDA", subjectType: "ANY", subjectText: null, systemText: null,
  operator: "EXACT", targetValue: .3, tolerance: null, unit: "W/(m·K)", evidence: "λ0.3", ...patch });
const productFact = (value = customer.product.lambda): LambdaFact => ({ parameter: "LAMBDA", unit: "W/(m·K)", value, subjectType: "PRODUCT_EQUIVALENT",
  subjectId: "p", productId: "p", name: customer.product.name, source: { kind: "CATALOG", id: "p" } });
function context(message = "λ0.3", q = query()) {
  const document = { id: "d", title: "客户已确认资料", status: "ACTIVE", deletedAt: null, projectId: null, currentVersionId: "v" };
  const version = { id: "v", status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null };
  const tables: Record<string, any[]> = {
    catalog_products: [{ id: "p", name: customer.product.name, thermalConductivity: customer.product.lambda, status: "ACTIVE" }],
    product_specs: [{ id: "s", specCode: "VICP-BOARD-25", catalogProductId: "p" }],
    materials: [{ id: "mat", name: customer.core.name }], material_parameter_versions: [{ id: "mp", materialId: "mat", thermalConductivity: customer.core.lambda, evidenceRef: "Sheet1 M8" }],
    product_parameters: [{ id: "sp", specId: "s", value: customer.product.lambda, unit: "W/(m·K)", evidenceRef: "Sheet1 D7" }], knowledge_aliases: [], knowledge_facts: [], knowledge_pages: []
  };
  const reads: string[] = [], clauses: string[] = [];
  const record = (sql: any) => { if (sql) clauses.push(new PgDialect().sqlToQuery(sql).sql); };
  const db = { select: () => { let name = ""; const b: any = { from: (table: any) => { name = getTableName(table); reads.push(name); return b; },
    innerJoin: (_table: any, condition: any) => { record(condition); return b; }, where: (condition: any) => { record(condition); return b; }, orderBy: () => b,
    then: (resolve: any) => Promise.resolve(tables[name] ?? []).then(resolve) }; return b; }, insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const semantic = domainSemanticFixture(message, "PRODUCT_PARAMETER_QUERY", { relation: "NEW", parameterQuery: q, pageQuery: null, reference: { scope: "NONE", revision: null, items: [] } });
  const ctx = { app: { db }, conversation: { id: "c", projectId: null }, user: { id: "u", clientType: "C_APP" }, request: {}, userMessage: message,
    taskState: { taskType: "GENERAL" }, domainDecision: { intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", semantic } } as any;
  return { ctx, tables, reads, clauses, document, version };
}
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ id: "c", userId: "u", clientApp: "c_app", projectId: null }); m.pending.mockResolvedValue(null); });
describe("客户Excel独立λ事实与诊断", () => {
  it("目录仅0.005不匹配0.3，且不要求基层或从K补算", async () => {
    const c = context(); const before = structuredClone(c.ctx.taskState); const result = await readProductParameters(c.ctx);
    expect(result.facts).toEqual([]); expect(result.diagnostics.issues).toContain("VALUE_NO_MATCH"); expect(result.answer).toContain("没有符合当前数值条件"); expect(result.answer).not.toContain("基层");
    expect(c.ctx.taskState).toEqual(before); expect(c.ctx.app.db.insert).not.toHaveBeenCalled(); expect(c.ctx.app.db.update).not.toHaveBeenCalled();
    expect(c.reads).toContain("material_parameter_versions"); expect(c.reads).toContain("knowledge_pages"); expect(c.reads).toContain("knowledge_facts");
  });
  it("不短路来源；目录命中仍读取规格、材料及确认页，归属独立", async () => {
    const c = context("λ0.005", query({ targetValue: .005, evidence: "λ0.005" }));
    c.tables.knowledge_pages = [{ document: c.document, version: c.version, page: { id: "pg", versionId: "v", documentId: "d", pageLabel: "21", metadata: { confirmedStructuredData: {
      pageTitle: "材料表", fullText: "", systems: [{ systemName: "客户构造", layers: [{ name: customer.core.name, lambda: customer.core.lambda }], options: [] }] } } } }];
    const result = await readProductParameters(c.ctx);
    expect(result.facts.map(row => row.subjectType)).toEqual(["PRODUCT_EQUIVALENT", "SPEC_EQUIVALENT"]);
    expect(result.diagnostics.scannedCount).toBe(4); expect(result.diagnostics.excludedValueCount).toBe(2);
    expect(result.answer).toContain("产品当量"); expect(result.answer).toContain("规格当量");
  });
  it("构造材料层λ只能按材料层返回，不能变成产品当量", async () => {
    const c = context("λ0.0025", query({ targetValue: .0025, evidence: "λ0.0025", subjectType: "MATERIAL_LAYER" }));
    c.tables.knowledge_pages = [{ document: c.document, version: c.version, page: { id: "pg", versionId: "v", documentId: "d", pageLabel: "21", metadata: { confirmedStructuredData: {
      fullText: "", systems: [{ systemName: "客户构造", layers: [{ name: customer.core.name, lambda: customer.core.lambda, rValue: customer.core.cachedResistance }], options: [] }] } } } }];
    const r = await readProductParameters(c.ctx); expect(r.facts).toHaveLength(1); expect(r.facts[0]).toMatchObject({ subjectType: "MATERIAL_LAYER", source: { pageId: "pg", constructionId: expect.any(String), layerId: expect.any(String) } });
    expect(r.answer).toContain("构造材料层"); expect(r.answer).not.toContain("4.8");
  });
  it("参数缺字段、无匹配、未知名称分别诊断；未审核错别字不归一", async () => {
    const c = context(); for (const table of Object.keys(c.tables)) c.tables[table] = [];
    expect((await readProductParameters(c.ctx)).diagnostics.issues).toContain("PARAMETER_NOT_INDEXED");
    expect(evaluateLambdaFacts(query({ systemText: "薄膜灰" }), [productFact()]).diagnostics.issues).toContain("NAME_UNRESOLVED");
    expect(evaluateLambdaFacts(query({ subjectText: "VLCP" }), [productFact()]).diagnostics.issues).toContain("NAME_UNRESOLVED");
    // 现有lambda_eq仅为当量参数；未有正式标称字段映射时不得冒充标称λ。
    expect(evaluateLambdaFacts(query({ subjectType: "SPEC_NOMINAL", targetValue: .005 }), [productFact()]).diagnostics.issues).toContain("PARAMETER_NOT_INDEXED");
  });
  it("仅启用GLOBAL正式别名可定位已有参数身份", () => {
    const result = evaluateLambdaFacts(query({ subjectText: "正式简称", targetValue: .005 }), [productFact()], [{ term: customer.product.name, alias: "正式简称" }]);
    expect(result.facts).toHaveLength(1);
  });
  it("已知产品缺λ是来源缺字段，不能误称名称未解析；规格仅凭正式关联归属产品", async () => {
    const message = "VICP复合保温板λ多少";
    const c = context(message, query({ subjectText: "VICP复合保温板", targetValue: null, operator: "READ", evidence: message }));
    expect((await readProductParameters(c.ctx)).facts.map(row => row.subjectType)).toEqual(["PRODUCT_EQUIVALENT", "SPEC_EQUIVALENT"]);
    c.tables.catalog_products[0].thermalConductivity = null; c.tables.product_parameters = [];
    const r = await readProductParameters(c.ctx); expect(r.diagnostics.issues).toContain("PARAMETER_NOT_INDEXED"); expect(r.diagnostics.issues).not.toContain("NAME_UNRESOLVED");
  });
  it("近似无默认窗口；显式容差、严格/包含边界可测量", () => {
    const rows = [productFact(.3)];
    expect(evaluateLambdaFacts(query({ operator: "APPROX" }), rows).diagnostics.issues).toContain("FILTER_CONFLICT");
    expect(renderLambdaAnswer(evaluateLambdaFacts(query({ operator: "APPROX" }), rows))).toContain("请明确容差");
    expect(evaluateLambdaFacts(query({ operator: "LT" }), rows).facts).toHaveLength(0);
    expect(evaluateLambdaFacts(query({ operator: "LTE" }), rows).facts).toHaveLength(1);
    expect(evaluateLambdaFacts(query({ operator: "APPROX", tolerance: .01 }), [productFact(.005)]).facts).toHaveLength(0);
  });
  it("同身份来源冲突拒绝，独立材料/不同原页不得按同值合并", () => {
    const a = productFact(.3), b = { ...a, value: .4, source: { kind: "KNOWLEDGE_FACT" as const, id: "f" } };
    expect(evaluateLambdaFacts(query(), [a, b]).diagnostics.issues).toContain("FILTER_CONFLICT");
    expect(evaluateLambdaFacts(query(), [a, b]).facts).toHaveLength(0);
    expect(evaluateLambdaFacts(query(), [a, { ...a, subjectId: "p2", source: { ...a.source, id: "p2" } }]).facts).toHaveLength(2);
    const equalSource = { ...a, source: { kind: "KNOWLEDGE_FACT" as const, id: "same-value", documentId: "d", versionId: "v" } };
    const merged = evaluateLambdaFacts(query(), [a, equalSource]);
    expect(merged.facts).toHaveLength(1); expect(merged.facts[0]!.sources).toHaveLength(2); expect(merged.diagnostics.matchedSourceCount).toBe(2);
  });
});
describe("执行时重新核验来源、范围与参数证据", () => {
  it.each(["project", "draft", "withdrawn", "replaced", "expired", "browse"])("%s来源不消费", async mode => {
    const c = context(); const document = { ...c.document }, version = { ...c.version } as any;
    if (mode === "project") document.projectId = "other" as any;
    if (mode === "draft") version.status = "DRAFT";
    if (mode === "withdrawn") document.deletedAt = new Date() as any;
    if (mode === "replaced") document.currentVersionId = "new";
    if (mode === "expired") version.expiryDate = "2000-01-01";
    if (mode === "browse") version.usageMode = "BROWSE_ONLY";
    c.tables.knowledge_facts = [{ document, version, fact: { id: "f", factType: "MATERIAL", subject: "mat", data: { materialId: "mat", lambda: .3 } } }];
    expect((await readProductParameters(c.ctx)).facts).toHaveLength(0);
    expect(c.clauses.join("\n")).toContain('"knowledge_documents"."project_id" is null');
    expect(c.clauses.join("\n")).toContain('"knowledge_facts"."source_version_id"');
  });
  it("Fact与Legacy同时读取，不因前者非空抹掉另一个来源", async () => {
    const c = context(); c.tables.knowledge_facts = [{ document: c.document, version: c.version, fact: { id: "f", factType: "MATERIAL", subject: "mat", data: { materialId: "mat", lambda: .3 } } }];
    const r = await readProductParameters(c.ctx); expect(r.facts).toHaveLength(0); expect(r.diagnostics.issues).toContain("FILTER_CONFLICT");
  });
  it("无权会话/项目变化停止读取，不能把权限失败伪装成无匹配", async () => {
    const c = context(); m.access.mockRejectedValueOnce(new Error("无权访问")); await expect(readProductParameters(c.ctx)).rejects.toThrow("无权访问"); expect(c.reads).toEqual([]);
    m.access.mockResolvedValueOnce({ projectId: "other" }); await expect(readProductParameters(c.ctx)).rejects.toThrow("项目已变化");
  });
  it("0.3→导热系数，Service重验同一pending并排除当前USER消息", async () => {
    const c = context("导热系数", query({ evidence: "导热系数" })); c.ctx.domainDecision.semantic.queryContext = "CLARIFICATION_REPLY"; c.ctx.domainDecision.semantic.relation = "CONTINUE";
    c.ctx.domainDecision.queryContextMessageId = "original"; c.ctx.domainDecision.queryCurrentMessageId = "current";
    m.pending.mockResolvedValue({ messageId: "original", message: "有保温0.3的材料么", inheritPrevious: false });
    expect((await readProductParameters(c.ctx)).query.targetValue).toBe(.3); expect(m.pending).toHaveBeenCalledWith(c.ctx.app, expect.anything(), "current");
    m.pending.mockResolvedValueOnce(null); await expect(readProductParameters(c.ctx)).rejects.toThrow("已失效");
  });
  it("Tool不能凭旧Domain/未知数字查询，READ不能丢原问数值", async () => {
    const c = context("λ0.3", query({ targetValue: .005 })); await expect(readProductParameters(c.ctx)).rejects.toThrow("目标值须来自");
    c.ctx.domainDecision.intent = "KNOWLEDGE_EXPLAIN"; await expect(readProductParameters(c.ctx)).rejects.toThrow("没有已核验");
  });
});
