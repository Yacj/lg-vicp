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

describe("项目记忆分类", () => {
  it("用户明确表达可成为已核实 FACT", async () => {
    const { classifyMemoryCandidate } = await import("./ai-project-memory.service.js");
    const result = classifyMemoryCandidate({
      memoryType: "FACT",
      content: "目标K改为0.30",
      confidence: 0.95,
      sourceMessageIds: ["m1"],
      explicitUserStatement: true
    });
    expect(result).toEqual({ status: "ACTIVE", verified: true, memoryType: "FACT" });
  });

  it("AI 推测只能是 ASSUMPTION 待确认", async () => {
    const { classifyMemoryCandidate } = await import("./ai-project-memory.service.js");
    const result = classifyMemoryCandidate({
      memoryType: "FACT",
      content: "用户可能偏好25mm",
      confidence: 0.6,
      sourceMessageIds: ["m1"],
      explicitUserStatement: false
    });
    expect(result.status).toBe("PENDING");
    expect(result.verified).toBe(false);
    expect(result.memoryType).toBe("ASSUMPTION");
  });

  it("ASSUMPTION 即使高置信也不能 verified", async () => {
    const { classifyMemoryCandidate } = await import("./ai-project-memory.service.js");
    const result = classifyMemoryCandidate({
      memoryType: "ASSUMPTION",
      content: "可能用25mm",
      confidence: 0.99,
      sourceMessageIds: ["m1"],
      explicitUserStatement: true
    });
    expect(result.verified).toBe(false);
    expect(result.memoryType).toBe("ASSUMPTION");
  });
});

describe("项目记忆注入过滤", () => {
  it("ASSUMPTION 不得当事实注入", async () => {
    const { isInjectableAsFact } = await import("./ai-project-memory.service.js");
    expect(isInjectableAsFact({ status: "ACTIVE", verified: true, memoryType: "ASSUMPTION" })).toBe(false);
    expect(isInjectableAsFact({ status: "ACTIVE", verified: true, memoryType: "FACT" })).toBe(true);
    expect(isInjectableAsFact({ status: "PENDING", verified: false, memoryType: "FACT" })).toBe(false);
  });

  it("上下文只包含已确认项", async () => {
    const { formatProjectMemoryContext } = await import("./ai-project-memory.service.js");
    const text = formatProjectMemoryContext([
      { id: "1", memoryType: "CONSTRAINT", title: "目标K", content: "K<=0.30", verified: true, status: "ACTIVE" },
      { id: "2", memoryType: "ASSUMPTION", title: null, content: "可能25mm", verified: false, status: "PENDING" }
    ]);
    expect(text).toContain("K<=0.30");
    expect(text).not.toContain("可能25mm");
  });

  it("主题归一化可识别同一约束的修订", async () => {
    const { normalizeMemoryKey } = await import("./ai-project-memory.service.js");
    expect(normalizeMemoryKey("目标K <= 0.35")).toContain("目标k");
    expect(normalizeMemoryKey("目标K：0.30").slice(0, 3)).toBe(normalizeMemoryKey("目标K 0.30").slice(0, 3));
  });
});
