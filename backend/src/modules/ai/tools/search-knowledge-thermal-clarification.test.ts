import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { createSearchKnowledgeTool } from "./search-knowledge.tool.js";
import type { ToolRuntimeContext } from "./tool-runtime.js";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../ai-knowledge-load.js", () => ({ loadKnowledgeForGeneration: mocks.load }));
vi.mock("./tool-runtime.js", () => ({ runRegisteredTool: async (_ctx: unknown, _name: unknown, _args: unknown, _options: unknown, run: () => unknown) => run() }));

describe("知识Tool热工指标澄清", () => {
  it("模型改写成总R查询也不能绕过真实用户原话的歧义", async () => {
    const ctx = { userMessage: "有传热8.3的保温板么", taskState: { taskType: "GENERAL" } } as ToolRuntimeContext;
    const tool = createSearchKnowledgeTool(ctx);
    const result = await tool.execute!({ query: "整墙总热阻8.3", scope: "ATLAS" }, { toolCallId: "call", messages: [] });
    expect(result).toMatchObject({ data: { interpretation: { metric: "AMBIGUOUS", needsClarification: true }, primaryCandidate: null } });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
