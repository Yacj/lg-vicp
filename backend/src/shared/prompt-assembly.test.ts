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
  it("按平台基础 → 场景 → 项目上下文 → 检索结果的顺序组装", async () => {
    const { buildSystemMessages, PLATFORM_BASE_SYSTEM_PROMPT } = await import("./prompt-assembly.js");
    const messages = buildSystemMessages({
      scenePrompt: "场景提示词",
      projectContext: "项目A",
      knowledgeContext: "资料B"
    });
    expect(messages).toHaveLength(4);
    expect(messages[0]!.content).toBe(PLATFORM_BASE_SYSTEM_PROMPT);
    expect(messages[1]!.content).toBe("场景提示词");
    expect(messages[2]!.content).toContain("项目A");
    expect(messages[3]!.content).toContain("资料B");
  });

  it("未提供项目/检索上下文时不注入对应段落", async () => {
    const { buildSystemMessages } = await import("./prompt-assembly.js");
    const messages = buildSystemMessages({ scenePrompt: "场景提示词" });
    expect(messages).toHaveLength(2);
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