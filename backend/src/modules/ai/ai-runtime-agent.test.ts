import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import {
  applyResponseMessages,
  parseAgentRunState,
  prepareResumeState,
  type AgentRunState
} from "./ai-agent.service.js";
import type { ModelMessage } from "ai";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

beforeAll(() => {
  process.env.NODE_ENV = "test";
});

describe("Tool 输入哈希与循环防护", () => {
  it("相同 tool+input 生成稳定哈希", async () => {
    const { hashToolInput, stableStringify } = await import("./ai-tools.js");
    const a = hashToolInput("thermal", { schemeId: "s1", thicknessMm: 25 });
    const b = hashToolInput("thermal", { thicknessMm: 25, schemeId: "s1" });
    expect(a).toBe(b);
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("连续重复达到阈值判定循环", async () => {
    const { hashToolInput } = await import("./ai-tools.js");
    const { detectDuplicateLoop } = await import("./ai-agent.service.js");
    const hash = hashToolInput("search_knowledge", { query: "窗洞口" });
    expect(detectDuplicateLoop([hash], hash, 2)).toBe(true);
    expect(detectDuplicateLoop([], hash, 2)).toBe(false);
    expect(detectDuplicateLoop(["other"], hash, 2)).toBe(false);
  });

  it("多方案结果进入 WAITING_USER_INPUT 信号", async () => {
    const { isAgentWaitSignal } = await import("./ai-tools.js");
    expect(isAgentWaitSignal({
      __agentSignal: "WAITING_USER_INPUT",
      prompt: "请选择",
      options: [{ index: 1 }, { index: 2 }]
    })).toBe(true);
    expect(isAgentWaitSignal({ ok: true })).toBe(false);
  });

  it("工具输出过长时截断存储", async () => {
    const { summarizeToolPayload } = await import("./ai-tools.js");
    const summarized = summarizeToolPayload({ dump: "x".repeat(20_000) }, 100);
    expect(summarized.truncated).toBe(true);
    expect(String(summarized.preview).length).toBeLessThanOrEqual(100);
  });
});

describe("Agent Run 超时失效", () => {
  it("RUNNING 超过整体超时视为过期，WAITING 不算", async () => {
    const { isStaleRunningAgentRun } = await import("./ai-agent.service.js");
    const now = Date.parse("2026-09-21T08:00:00.000Z");
    expect(isStaleRunningAgentRun({
      status: "RUNNING",
      startedAt: new Date(now - 180_000)
    }, now, 120_000)).toBe(true);
    expect(isStaleRunningAgentRun({
      status: "RUNNING",
      startedAt: new Date(now - 10_000)
    }, now, 120_000)).toBe(false);
    expect(isStaleRunningAgentRun({
      status: "WAITING_USER_INPUT",
      startedAt: new Date(now - 180_000)
    }, now, 120_000)).toBe(false);
  });
});

describe("能力路由只做预路由，不卡死 Tool 选择", () => {
  it("寒暄不给任何工具", async () => {
    const { selectAllowedToolNames } = await import("./ai-capability-router.js");
    expect(selectAllowedToolNames({
      capabilities: {
        idle: true,
        needKnowledgeSearch: false,
        explicitKnowledgeRequest: false,
        needProjectContext: false,
        needReferenceLookup: false,
        needThermalTool: false,
        needComparisonTool: false,
        needProductData: false,
        needReportContext: false
      },
      hasProject: true,
      allowKnowledgeSearch: true
    })).toEqual([]);
  });

  it("无热工关键字的方案请求仍开放项目/知识/热工/对比/报告", async () => {
    const { resolveAiCapabilities, selectAllowedToolNames } = await import("./ai-capability-router.js");
    const capabilities = resolveAiCapabilities({
      message: "帮我找一个这个项目合适的方案",
      projectId: "proj-1"
    });
    expect(capabilities.idle).toBe(false);
    const tools = selectAllowedToolNames({
      capabilities,
      hasProject: true,
      allowKnowledgeSearch: true
    });
    expect(tools).toEqual([
      "search_knowledge",
      "get_project_state",
      "get_product_data",
      "thermal",
      "compare_products",
      "compare_solutions",
      "generate_report"
    ]);
  });

  it("旧 Tool 名可映射到领域级 Tool", async () => {
    const { normalizeAllowedToolNames } = await import("./ai-capability-router.js");
    expect(normalizeAllowedToolNames([
      "get_project_context",
      "get_project_memory",
      "generate_report_draft",
      "get_report_types",
      "thermal_calculate"
    ])).toEqual(["get_project_state", "thermal", "generate_report"]);
  });
});

describe("Vision 语义持久化解析", () => {
  it("解析观察摘要、可见文字和对象", async () => {
    const { parseVisionSemantics } = await import("./ai-vision.service.js");
    const parsed = parseVisionSemantics([
      "【观察摘要】节点图左侧窗洞口，右侧第二个节点为阳角。",
      "【可见文字】25mm VICP",
      "【可见对象】窗洞口，阳角，保温层"
    ].join("\n"));
    expect(parsed.semanticSummary).toContain("第二个节点");
    expect(parsed.extractedText).toContain("25mm");
    expect(parsed.detectedObjects).toContain("阳角");
  });
});

const COMPARE_OUTPUT = {
  ok: true,
  data: {
    candidates: [
      { index: 1, candidateId: "cand-a", scheme: { code: "S1" }, kValue: 0.35, thicknessMm: 20 },
      { index: 2, candidateId: "cand-b", scheme: { code: "S2" }, kValue: 0.28, thicknessMm: 25 },
      { index: 3, candidateId: "cand-c", scheme: { code: "S3" }, kValue: 0.40, thicknessMm: 30 }
    ],
    choiceRequired: true
  },
  summary: "找到 3 个候选，需要用户选择"
};

function waitingRunState(): AgentRunState {
  return {
    system: "你是建筑节能助手",
    messages: [
      { role: "user", content: "帮我选满足K值的方案" },
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "call-compare",
          toolName: "compare_solutions",
          input: { targetK: 0.4 }
        }]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call-compare",
          toolName: "compare_solutions",
          output: { type: "json", value: COMPARE_OUTPUT }
        }]
      },
      { role: "assistant", content: "请从三个候选中选择一个。" }
    ],
    waiting: {
      reason: "USER_CHOICE",
      prompt: "请从候选方案中选择一个",
      options: COMPARE_OUTPUT.data.candidates,
      sourceToolCallId: "call-compare"
    },
    sources: [],
    recentToolHashes: [],
    fullText: "请从三个候选中选择一个。",
    userVisibleText: "请从三个候选中选择一个。",
    internalStepText: ""
  };
}

function mockUsage() {
  return {
    inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 8, text: 8, reasoning: undefined }
  };
}

describe("Agent Resume 必须保留 tool-call / tool-result", () => {
  it("WAITING 状态不能只追加 fullText，必须保留三个方案", () => {
    const merged = applyResponseMessages(
      [{ role: "user", content: "帮我选满足K值的方案" }],
      waitingRunState().messages.slice(1)
    );
    const serialized = JSON.stringify(merged);
    expect(serialized).toContain("cand-b");
    expect(serialized).toContain("0.28");
    expect(serialized).toContain("compare_solutions");
    expect(parseAgentRunState({
      ...waitingRunState(),
      waitingPrompt: "旧字段"
    }).waiting?.prompt).toBe("请从候选方案中选择一个");
  });

  it("用户回复“第二个”后模型能读到第二方案数据并继续", async () => {
    const resumed = await prepareResumeState({
      id: "run-1",
      status: "WAITING_USER_INPUT",
      stateJson: waitingRunState()
    } as never, "第二个");

    expect(resumed.messages.at(-1)).toMatchObject({ role: "user" });
    expect(String((resumed.messages.at(-1) as { content: string }).content)).toContain("第二个");
    expect(JSON.stringify(resumed.messages)).toContain("cand-b");

    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        const blob = JSON.stringify(prompt);
        const knowsSecond = blob.includes("cand-b") && blob.includes("0.28") && blob.includes("第二个");
        return {
          content: [{
            type: "text",
            text: knowsSecond
              ? "已按第二个方案 S2 继续，candidateId=cand-b，K=0.28，厚度 25mm。"
              : "我不知道第二个方案是什么。"
          }],
          finishReason: "stop",
          usage: mockUsage(),
          warnings: []
        };
      },
      doStream: async ({ prompt }) => {
        const blob = JSON.stringify(prompt);
        const knowsSecond = blob.includes("cand-b") && blob.includes("0.28") && blob.includes("第二个");
        const text = knowsSecond
          ? "已按第二个方案 S2 继续，candidateId=cand-b，K=0.28，厚度 25mm。"
          : "我不知道第二个方案是什么。";
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: text },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop", usage: mockUsage() }
          ])
        };
      }
    });

    const result = await generateText({
      model,
      system: resumed.system,
      messages: resumed.messages as ModelMessage[],
      stopWhen: stepCountIs(1)
    });
    expect(result.text).toContain("cand-b");
    expect(result.text).toContain("0.28");
    expect(result.text).not.toContain("我不知道第二个方案是什么");
  });
});
