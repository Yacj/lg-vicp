import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
  process.env.AI_CONTEXT_MAX_MESSAGES = "20";
  process.env.AI_CONTEXT_OUTPUT_RESERVE_RATIO = "0.1";
});

describe("提示词组装", () => {
  it("按平台硬规则 → 执行规范 → 回答规则 → 业务 Prompt → 项目上下文 → 参考资料的顺序组装", async () => {
    const {
      buildSystemMessages,
      PLATFORM_BASE_SYSTEM_PROMPT
    } = await import("./prompt-assembly.js");
    const { EXECUTION_POLICY } = await import("./ai-execution-policy.js");
    const { GLOBAL_RESPONSE_POLICY, HARD_RESPONSE_CONSTRAINTS } = await import("./ai-response-policy.js");
    const messages = buildSystemMessages({
      scenePrompt: "场景提示词",
      projectContext: "项目A",
      knowledgeContext: "资料B"
    });
    expect(messages[0]!.content).toBe(PLATFORM_BASE_SYSTEM_PROMPT);
    expect(messages[1]!.content).toBe(EXECUTION_POLICY);
    expect(messages[2]!.content).toBe(GLOBAL_RESPONSE_POLICY);
    expect(messages[3]!.content).toContain("【最终答案形态】");
    expect(messages[4]!.content).toBe("场景提示词");
    expect(messages.some((item) => item.content.includes("项目A"))).toBe(true);
    expect(messages.some((item) => item.content.includes("资料B"))).toBe(true);
    expect(messages[messages.length - 1]!.content).toBe(HARD_RESPONSE_CONSTRAINTS);
  });

  it("未提供项目/检索上下文时仍注入全局规则与不可覆盖约束", async () => {
    const { buildSystemMessages } = await import("./prompt-assembly.js");
    const messages = buildSystemMessages({ scenePrompt: "场景提示词" });
    expect(messages.map((item) => item.content)).toContain("场景提示词");
    expect(messages.length).toBeGreaterThanOrEqual(6);
  });

  it("热工能力约束作为独立系统消息注入，且要求静默使用", async () => {
    const { buildSystemMessages, formatThermalCapabilityContext } = await import("./prompt-assembly.js");
    const messages = buildSystemMessages({
      scenePrompt: "场景提示词",
      thermalContext: formatThermalCapabilityContext()
    });
    expect(messages.some((item) => item.content.includes("热工计算"))).toBe(true);
    expect(messages.some((item) => item.content.includes("仅供判断"))).toBe(true);
  });
});

describe("Token 估算", () => {
  it("ASCII 按 4 字符 1 token 估算", async () => {
    const { estimateTokens } = await import("./prompt-assembly.js");
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world")).toBe(3); // 11 / 4 向上取整
  });

  it("CJK 按 1.5 字符 1 token 估算", async () => {
    const { estimateTokens } = await import("./prompt-assembly.js");
    expect(estimateTokens("你好世界")).toBe(3); // 4 / 1.5 向上取整
  });
});

describe("上下文预算裁剪", () => {
  it("预算充足且未超条数上限时保留全部历史", async () => {
    const { budgetHistory } = await import("./prompt-assembly.js");
    const history = Array.from({ length: 5 }, (_, index) => ({ role: "user" as const, content: "a".repeat(100) }));
    const kept = budgetHistory({
      history,
      systemTokens: 100,
      userMessageTokens: 50,
      contextWindow: 1000,
      maxOutputTokens: 200
    });
    // available = 1000 - 100 - 50 - 200 - 100 = 550；5 条 × 25 tokens = 125
    expect(kept).toHaveLength(5);
    expect(kept.map((m) => m.content)).toEqual(history.map((m) => m.content));
  });

  it("超预算时优先保留较新的历史", async () => {
    const { budgetHistory } = await import("./prompt-assembly.js");
    const history = Array.from({ length: 10 }, (_, index) => ({ role: "user" as const, content: "a".repeat(400) }));
    const kept = budgetHistory({
      history,
      systemTokens: 100,
      userMessageTokens: 50,
      contextWindow: 1000,
      maxOutputTokens: 200
    });
    // available = 550；每条 100 tokens，最多 5 条
    expect(kept.length).toBe(5);
    expect(kept[kept.length - 1]!.content).toBe(history[history.length - 1]!.content);
  });

  it("超过条数上限时按 maxMessages 截断", async () => {
    const { budgetHistory } = await import("./prompt-assembly.js");
    const history = Array.from({ length: 10 }, (_, index) => ({ role: "assistant" as const, content: "a".repeat(20) }));
    const kept = budgetHistory({
      history,
      systemTokens: 100,
      userMessageTokens: 50,
      contextWindow: 2000,
      maxOutputTokens: 200,
      maxMessages: 3
    });
    expect(kept).toHaveLength(3);
    expect(kept[0]!.content).toBe(history[7]!.content);
  });

  it("预算为负时返回空历史", async () => {
    const { budgetHistory } = await import("./prompt-assembly.js");
    const kept = budgetHistory({
      history: [{ role: "user", content: "x" }],
      systemTokens: 500,
      userMessageTokens: 500,
      contextWindow: 1000,
      maxOutputTokens: 200
    });
    expect(kept).toEqual([]);
  });
});

describe("分桶截断", () => {
  it("空文本返回空串", async () => {
    const { truncateToTokenBudget } = await import("./prompt-assembly.js");
    expect(truncateToTokenBudget("", 10)).toBe("");
    expect(truncateToTokenBudget(null, 10)).toBe("");
  });
});