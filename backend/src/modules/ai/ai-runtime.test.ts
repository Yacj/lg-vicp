import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
  process.env.AI_MAX_CONCURRENT_GENERATIONS = "2";
  process.env.AI_DAILY_REQUEST_LIMIT = "200";
});

type RedisLike = {
  incr: ReturnType<typeof vi.fn>;
  decr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

function redisMock(overrides: Partial<Record<"incr" | "decr" | "expire" | "get", unknown>> = {}): RedisLike {
  return {
    incr: vi.fn().mockResolvedValue(overrides.incr ?? 1),
    decr: vi.fn().mockResolvedValue(overrides.decr ?? 0),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(overrides.get ?? null)
  };
}

function appMock(redis: RedisLike) {
  return { redis } as unknown as FastifyInstance;
}

const user = { id: "u-1", role: "NORMAL_USER" } as const;
const superAdmin = { id: "u-2", role: "SUPER_ADMIN" } as const;

describe("reasoning 能力解析（resolveReasoningProviderOptions）", () => {
  it("OFF 模式遇到始终推理模型 → AI_REASONING_NOT_SUPPORTED", async () => {
    const { resolveReasoningProviderOptions } = await import("./ai-runtime.service.js");
    expect(() => resolveReasoningProviderOptions(
      { modelId: "m", providerName: "deepseek", capabilities: { reasoningAlwaysOn: true } },
      "OFF"
    )).toThrow("深度思考");
  });

  it("OFF 模式普通模型 → 无 providerOptions", async () => {
    const { resolveReasoningProviderOptions } = await import("./ai-runtime.service.js");
    expect(resolveReasoningProviderOptions(
      { modelId: "m", providerName: "deepseek", capabilities: { text: true } },
      "OFF"
    )).toBeUndefined();
  });

  it("ON 模式不支持推理 → undefined（由调用方降级）", async () => {
    const { resolveReasoningProviderOptions } = await import("./ai-runtime.service.js");
    expect(resolveReasoningProviderOptions(
      { modelId: "m", providerName: "deepseek", capabilities: { text: true } },
      "ON"
    )).toBeUndefined();
  });

  it("ON 模式支持推理与推理力度 → 按服务商驼峰键输出 reasoningEffort", async () => {
    const { resolveReasoningProviderOptions } = await import("./ai-runtime.service.js");
    const options = resolveReasoningProviderOptions(
      { modelId: "m", providerName: "openai-compatible", capabilities: { reasoning: true, reasoningEffort: true } },
      "ON"
    );
    expect(options).toEqual({ openaiCompatible: { reasoningEffort: "high" } });
  });

  it("ON 模式始终推理模型 → 无需额外参数", async () => {
    const { resolveReasoningProviderOptions } = await import("./ai-runtime.service.js");
    expect(resolveReasoningProviderOptions(
      { modelId: "m", providerName: "deepseek", capabilities: { reasoningAlwaysOn: true } },
      "ON"
    )).toBeUndefined();
  });
});

describe("配额（enforceAiQuota）", () => {
  it("SUPER_ADMIN 直接豁免且不访问 Redis", async () => {
    const { enforceAiQuota } = await import("./ai-runtime.service.js");
    const redis = redisMock();
    const quota = await enforceAiQuota(appMock(redis), superAdmin);
    expect(quota.exempt).toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("并发生成数超过上限 → AI_QUOTA_EXCEEDED 并释放占位", async () => {
    const { enforceAiQuota } = await import("./ai-runtime.service.js");
    const redis = redisMock({ incr: 3 });
    await expect(enforceAiQuota(appMock(redis), user)).rejects.toThrow("过多");
    expect(redis.decr).toHaveBeenCalledWith("ai:active:u-1");
    expect(redis.expire).toHaveBeenCalledTimes(0); // 首次并发计数为 3，不需要续期
  });

  it("每日请求数超过上限 → AI_QUOTA_EXCEEDED 并释放并发占位", async () => {
    const { enforceAiQuota } = await import("./ai-runtime.service.js");
    const redis = redisMock({ get: "1" }); // 并发计数存在，释放时递减
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(201); // 并发 1，每日 201
    await expect(enforceAiQuota(appMock(redis), user)).rejects.toThrow("上限");
    expect(redis.decr).toHaveBeenCalledWith("ai:active:u-1");
  });

  it("正常请求返回并发与每日计数", async () => {
    const { enforceAiQuota } = await import("./ai-runtime.service.js");
    const redis = redisMock();
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    const quota = await enforceAiQuota(appMock(redis), user);
    expect(quota).toMatchObject({ exempt: false, dailyUsed: 5, dailyLimit: 200, concurrentUsed: 1, concurrentLimit: 2 });
    // 仅首次并发计数为 1 时续期；每日计数 5 不需要续期
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });
});

describe("释放并发占位（releaseAiConcurrency）", () => {
  it("当前计数大于 0 时递减，否则不动", async () => {
    const { releaseAiConcurrency } = await import("./ai-runtime.service.js");
    const redis = redisMock({ get: "2" });
    await releaseAiConcurrency(appMock(redis), "u-1");
    expect(redis.decr).toHaveBeenCalledWith("ai:active:u-1");

    const redisZero = redisMock({ get: "0" });
    await releaseAiConcurrency(appMock(redisZero), "u-1");
    expect(redisZero.decr).not.toHaveBeenCalled();
  });
});