import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { structuredReferenceFixture } from "../structured-reference.fixture.js";
import { createSearchKnowledgeTool } from "./search-knowledge.tool.js";
import { decideDomainTurn } from "../ai-domain-turn-decision.js";
import { resolveConfirmedReferenceAnswer } from "../ai-reference-pages.service.js";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), publish: vi.fn() }));
vi.mock("../ai-knowledge-load.js", () => ({ loadKnowledgeForGeneration: mocks.load }));
vi.mock("../ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));
vi.mock("../candidate-result.service.js", () => ({ publishCandidateResult: mocks.publish }));

beforeEach(() => vi.clearAllMocks());
function context(message: string) {
  const rows = structuredReferenceFixture().map(({ page }) => ({ page, document: { id: page.documentId, title: "模拟图集", projectId: null,
    status: "ACTIVE", deletedAt: null, currentVersionId: page.versionId, insulationSystemId: null },
    version: { id: page.versionId, status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null } }));
  const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
  const app = { db: { insert, select: (fields: any) => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: async () => fields?.id ? rows.map(row => ({ id: row.page.id })) : rows };
    return chain;
  } }, log: { warn: vi.fn() }, storage: { createDownloadUrl: vi.fn(async () => "https://fixture.test/signed") } };
  const ctx = { app, request: { log: app.log }, user: { id: "test-user", clientType: "C_APP" },
    conversation: { id: "fixture-conversation", projectId: null, insulationSystemId: null }, userMessage: message,
    domainDecision: decideDomainTurn(message), answerContract: "REFERENCE_LOOKUP", taskState: { taskType: "GENERAL" },
    abortSignal: new AbortController().signal, recentToolHashes: [], toolCallCount: { value: 0 }, duplicateLimit: 3, maxToolCalls: 8,
    onReferenceAnswer: vi.fn(), onEvent: vi.fn() } as any;
  return ctx;
}
const query = "Ⅲ型 VICP 薄抹灰，45mm 厚，不同基层传热系数有什么区别？";

describe("Agent search_knowledge的跨页确认事实链（模拟检索，非线上路由）", () => {
  it("全文仅命中页5，工具仍交付四条/两页；模型检索词不覆盖用户约束", async () => {
    mocks.load.mockResolvedValue({ chunks: [{ documentId: "fixture-document", versionId: "fixture-version", pageId: "fixture-page-5", sourceTitle: "模拟图集" }], retrievalFailed: false });
    const ctx = context(query);
    const output = await createSearchKnowledgeTool(ctx).execute!({ query: "A3-2 K0.294", scope: "ATLAS" }, { toolCallId: "call", messages: [] } as any) as any;
    expect(output.ok).toBe(true); expect(ctx.onReferenceAnswer).toHaveBeenCalledTimes(1);
    const [answer, pages] = ctx.onReferenceAnswer.mock.calls[0];
    const resolved = resolveConfirmedReferenceAnswer(answer, pages);
    expect(resolved.pages.map(page => [page.page.pageLabel, page.matches.length])).toEqual([["5", 2], ["6", 2]]);
    expect(resolved.text).toContain("共 4 条"); expect(resolved.text).toContain("K=0.248");
    expect(mocks.publish.mock.calls[0]![1].candidates).toHaveLength(4);
    expect(mocks.publish.mock.calls[0]![1].query).toMatchObject({ thicknessMm: 45, specClass: "III", filters: [] });
    expect(ctx.onEvent.mock.calls.map((call: any[]) => call[0])).toContain("tool_result");
  });
  it("检索失败不返回权威答案或发布候选", async () => {
    mocks.load.mockResolvedValue({ chunks: [], retrievalFailed: true });
    const ctx = context(query);
    await createSearchKnowledgeTool(ctx).execute!({ query, scope: "ATLAS" }, { toolCallId: "call", messages: [] } as any);
    expect(ctx.onReferenceAnswer).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
});
