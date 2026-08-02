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

describe("AI 错误码", () => {
  it("错误码常量与规格表一一对应", async () => {
    const { AI_ERROR_CODES, AI_ERROR_SPECS } = await import("./ai-errors.js");
    const codes = Object.keys(AI_ERROR_CODES);
    expect(Object.keys(AI_ERROR_SPECS).sort()).toEqual(codes.sort());
    for (const code of codes) {
      const spec = AI_ERROR_SPECS[code as keyof typeof AI_ERROR_SPECS];
      expect(spec.statusCode).toBeGreaterThanOrEqual(400);
      expect(typeof spec.retryable).toBe("boolean");
      expect(spec.message.length).toBeGreaterThan(0);
    }
  });

  it("AiError 携带稳定 code、语义状态码与 retryable", async () => {
    const { AiError } = await import("./ai-errors.js");
    const error = new AiError("AI_MODEL_TIMEOUT");
    expect(error.code).toBe("AI_MODEL_TIMEOUT");
    expect(error.statusCode).toBe(500);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("超时");
  });
});

describe("底层错误映射", () => {
  it("HTTP 429 或限流文案 → AI_PROVIDER_RATE_LIMIT", async () => {
    const { toAiError } = await import("./ai-errors.js");
    expect(toAiError(Object.assign(new Error("upstream busy"), { statusCode: 429 })).code).toBe("AI_PROVIDER_RATE_LIMIT");
    expect(toAiError(new Error("Rate limit exceeded, retry later")).code).toBe("AI_PROVIDER_RATE_LIMIT");
  });

  it("超时错误 → AI_MODEL_TIMEOUT", async () => {
    const { toAiError } = await import("./ai-errors.js");
    const timeoutError = new Error("request timed out");
    timeoutError.name = "TimeoutError";
    expect(toAiError(timeoutError).code).toBe("AI_MODEL_TIMEOUT");
    expect(toAiError(new Error("upstream timed out after 60s")).code).toBe("AI_MODEL_TIMEOUT");
  });

  it("内容拒绝 → AI_CONTENT_REJECTED", async () => {
    const { toAiError } = await import("./ai-errors.js");
    expect(toAiError(new Error("content filter triggered")).code).toBe("AI_CONTENT_REJECTED");
    expect(toAiError(new Error("ContentPolicy violation")).code).toBe("AI_CONTENT_REJECTED");
  });

  it("上下文超长 → AI_CONTEXT_TOO_LONG", async () => {
    const { toAiError } = await import("./ai-errors.js");
    expect(toAiError(new Error("This model's maximum context length is 8192 tokens")).code).toBe("AI_CONTEXT_TOO_LONG");
  });

  it("密钥无效 → AI_CONFIG_INVALID", async () => {
    const { toAiError } = await import("./ai-errors.js");
    expect(toAiError(Object.assign(new Error("bad auth"), { statusCode: 401 })).code).toBe("AI_CONFIG_INVALID");
    expect(toAiError(new Error("invalid api key provided")).code).toBe("AI_CONFIG_INVALID");
  });

  it("未识别错误兜底为 AI_PROVIDER_UNAVAILABLE（可重试）", async () => {
    const { toAiError } = await import("./ai-errors.js");
    const mapped = toAiError(new Error("unexpected upstream failure"));
    expect(mapped.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });
});