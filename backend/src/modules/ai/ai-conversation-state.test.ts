import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
  process.env.AI_SUMMARY_MESSAGE_THRESHOLD = "12";
  process.env.AI_SUMMARY_TOKEN_THRESHOLD = "4000";
});

describe("滚动摘要触发", () => {
  it("消息数达阈值时触发", async () => {
    const { shouldUpdateConversationSummary } = await import("./ai-conversation-state.service.js");
    expect(shouldUpdateConversationSummary({
      unsummarizedCount: 12,
      unsummarizedTokens: 10,
      droppedEarlyMessages: false
    })).toBe(true);
  });

  it("即将被裁剪的旧消息触发", async () => {
    const { shouldUpdateConversationSummary } = await import("./ai-conversation-state.service.js");
    expect(shouldUpdateConversationSummary({
      unsummarizedCount: 2,
      unsummarizedTokens: 10,
      droppedEarlyMessages: true
    })).toBe(true);
  });

  it("未达阈值且未被裁剪时不触发", async () => {
    const { shouldUpdateConversationSummary } = await import("./ai-conversation-state.service.js");
    expect(shouldUpdateConversationSummary({
      unsummarizedCount: 2,
      unsummarizedTokens: 10,
      droppedEarlyMessages: false
    })).toBe(false);
  });
});

describe("会话状态注入", () => {
  it("保留目标、已确认事实和待确认项", async () => {
    const { formatConversationStateContext } = await import("./ai-conversation-state.service.js");
    const text = formatConversationStateContext({
      summary: "用户要把目标K从0.35改为0.30，并否决了岩棉方案。",
      activeGoal: "选定保温方案并计算K值",
      confirmedFactsJson: [{ key: "目标K", value: "0.30" }],
      openQuestionsJson: [{ question: "基层厚度尚未确认" }],
      importantReferencesJson: [{ kind: "CALC", title: "热工计算记录" }]
    });
    expect(text).toContain("目标K");
    expect(text).toContain("0.30");
    expect(text).toContain("否决了岩棉");
    expect(text).toContain("基层厚度");
  });
});
