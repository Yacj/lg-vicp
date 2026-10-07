import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";

describe("工具审计可观测性", () => {
  it("同Step并行工具的重查/复用审计各自落库，不进入模型或SSE", async () => {
    const saved: Record<string, any>[] = [];
    const ctx = {
      app: { db: { insert: () => ({ values: async (row: Record<string, unknown>) => { saved.push(row); } }) } },
      conversation: { id: "conversation" }, assistantMessageId: "message", agentRunId: "run",
      abortSignal: new AbortController().signal, recentToolHashes: [], toolCallCount: { value: 0 }, maxToolCalls: 10, duplicateLimit: 2,
      onEvent: vi.fn()
    } as unknown as ToolRuntimeContext;
    const first = runRegisteredTool(ctx, "thermal", { targetK: 0.3 }, { toolCallId: "one", auditMetadata: () => ({ backendDecision: { reusePreviousCandidate: false } }) }, async () => {
      await Promise.resolve(); return { ok: true, data: { found: false, candidates: [] } };
    });
    const second = runRegisteredTool(ctx, "thermal", { targetK: 0.4 }, { toolCallId: "two", auditMetadata: () => ({ backendDecision: { reusePreviousCandidate: true } }) }, async () => ({ ok: true, data: { found: false, candidates: [] } }));
    const results = await Promise.all([first, second]);
    expect(saved.find(row => row.inputJson.targetK === 0.3)?.outputJson.backendDecision.reusePreviousCandidate).toBe(false);
    expect(saved.find(row => row.inputJson.targetK === 0.4)?.outputJson.backendDecision.reusePreviousCandidate).toBe(true);
    expect(JSON.stringify(results)).not.toContain("backendDecision");
    expect(JSON.stringify((ctx.onEvent as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("backendDecision");
  });
});
