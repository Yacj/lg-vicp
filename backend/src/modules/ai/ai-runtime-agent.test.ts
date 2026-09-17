import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

describe("Tool 输入哈希与循环防护", () => {
  it("相同 tool+input 生成稳定哈希", async () => {
    const { hashToolInput, stableStringify } = await import("./ai-tools.js");
    const a = hashToolInput("thermal_calculate", { schemeId: "s1", thicknessMm: 25 });
    const b = hashToolInput("thermal_calculate", { thicknessMm: 25, schemeId: "s1" });
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

describe("能力路由只选择 Tool Set", () => {
  it("寒暄不给任何工具", async () => {
    const { selectAllowedToolNames } = await import("./ai-capability-router.js");
    expect(selectAllowedToolNames({
      capabilities: {
        needKnowledgeSearch: false,
        explicitKnowledgeRequest: false,
        needProjectContext: false,
        needThermalTool: false,
        needComparisonTool: false,
        needReportContext: false
      },
      hasProject: true,
      allowKnowledgeSearch: true
    })).toEqual([]);
  });

  it("热工问题开放计算与比较，不直接生成报告", async () => {
    const { selectAllowedToolNames } = await import("./ai-capability-router.js");
    const tools = selectAllowedToolNames({
      capabilities: {
        needKnowledgeSearch: false,
        explicitKnowledgeRequest: false,
        needProjectContext: true,
        needThermalTool: true,
        needComparisonTool: false,
        needReportContext: false
      },
      hasProject: true,
      allowKnowledgeSearch: true
    });
    expect(tools).toContain("thermal_calculate");
    expect(tools).toContain("compare_solutions");
    expect(tools).not.toContain("generate_report_draft");
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
