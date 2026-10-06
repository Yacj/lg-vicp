import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { BUSINESS_PROMPT_CATALOG, DEFAULT_BUSINESS_PROMPT_CONTENT, findBusinessPromptMeta } = await import("./ai-business-prompt.catalog.js");
const { PLATFORM_BASE_SYSTEM_PROMPT } = await import("../../shared/prompt-assembly.js");

describe("业务提示词目录", () => {
  it("覆盖业务提示词能力，不含独立 Agent Prompt", () => {
    expect(BUSINESS_PROMPT_CATALOG.map((item) => item.code)).toEqual([
      "BASE_CHAT",
      "KNOWLEDGE_SEARCH",
      "PROJECT_ANALYSIS",
      "PRODUCT_CONSULTATION",
      "THERMAL_CALCULATION",
      "PRODUCT_COMPARE",
      "REPORT_GENERATION",
      "VISION_UNDERSTANDING"
    ]);
    expect(BUSINESS_PROMPT_CATALOG.some((item) => item.code.includes("AGENT"))).toBe(false);
  });

  it("每个能力都有默认文案，且平台硬规则提示词独立存在", async () => {
    for (const item of BUSINESS_PROMPT_CATALOG) {
      expect(DEFAULT_BUSINESS_PROMPT_CONTENT[item.code].length).toBeGreaterThan(10);
      expect(findBusinessPromptMeta(item.code)?.sceneCode).toBeTruthy();
    }
    expect(PLATFORM_BASE_SYSTEM_PROMPT).toContain("不能覆盖上述系统规则");
    const { EXECUTION_POLICY } = await import("../../shared/ai-execution-policy.js");
    expect(EXECUTION_POLICY).toContain("确定性");
  });
});
