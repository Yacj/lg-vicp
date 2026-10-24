import "dotenv/config";
import { expect, it } from "vitest";
import { parseSemanticQuery } from "./semantic-query.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
it.each([false, true])("执行检索的自动文档范围不升级为用户硬条件；显式来源仍保留：%s", async explicit => {
  const message = "再看28mm", userQuery = { systemHint: "VICP", ...(explicit ? { referenceSetIds: ["3bdc6ed2-11e7-48c6-bfb2-b4e3a90ba402"] } : {}) };
  const semantic = domainSemanticFixture(message, "REFERENCE_REFINE", { pageQuery: { queryMode: "REFINE_QUERY", intent: "REFERENCE_LOOKUP", confidence: .98,
    constraints: [{ type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 28, evidence: "28mm", hard: true, confidence: .98 }], preferences: [], unresolved: [] } });
  const ctx = { userMessage: message, conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null },
    domainDecision: { intent: "REFERENCE_REFINE", mutation: "QUERY", semantic }, taskState: { confirmedPageLookup: {
      query: { ...userQuery, documentIds: ["auto-document"], knowledgeVersionIds: ["auto-version"] }, requestQuery: userQuery,
      conversationId: "c", userId: "u", clientApp: "c_app", projectId: null, createdAt: new Date().toISOString()
    } } } as any;
  const result = await parseSemanticQuery(ctx, {}, { entities: [], aliases: [] });
  expect(result.query).toMatchObject({ thicknessMm: 28, systemHint: "VICP" });
  expect(result.query.documentIds).toBeUndefined(); expect(result.query.knowledgeVersionIds).toBeUndefined();
  expect(result.query.referenceSetIds).toEqual(userQuery.referenceSetIds);
  expect(ctx.taskState.confirmedPageLookup.query.documentIds).toEqual(["auto-document"]);
});
