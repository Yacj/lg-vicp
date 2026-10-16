import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), values: vi.fn() }));
vi.mock("../knowledge/knowledge.service.js", () => ({ searchProjectKnowledge: mocks.search }));
import { loadKnowledgeForGeneration, requestedSpecClasses } from "./ai-knowledge-load.js";
beforeEach(() => vi.clearAllMocks());
it("仅提取完整型号格式，不把年份/厚度当型号", () => {
  expect(requestedSpecClasses("Ⅰ型和Ⅱ型、III型").map(item => item.specClass)).toEqual(["I", "II", "III"]);
  expect(requestedSpecClasses("45mm、2026年、A3-2")).toEqual([]);
});
it("多型号在同项目同体系权限范围逐项召回，III不冒充II，保留两个型号证据", async () => {
  const hit = (spec: string) => ({ documentId: "d", pageId: spec, chunkId: spec, pageTitle: `${spec}型VICP系统`, content: `${spec}型真实资料`, score: 1 });
  mocks.search.mockImplementation(async (_app, _project, query) => query === "II型" ? [hit("III"), hit("II")] : [hit("I")]);
  const app = { db: { insert: () => ({ values: mocks.values }) } }, log = { error: vi.fn() };
  const result = await loadKnowledgeForGeneration({ app: app as any, log: log as any, conversationId: "c", messageId: "m", content: "I型和II型的区别", projectId: "private", insulationSystemId: "system", needSearch: true });
  expect(result.chunks.slice(0, 2).map(hit => hit.pageId)).toEqual(["I", "II"]);
  expect(result.chunks.some(hit => hit.pageId === "III")).toBe(false);
  for (const call of mocks.search.mock.calls) { expect(call[1]).toBe("private"); expect(call[3].insulationSystemId).toBe("system"); }
});
