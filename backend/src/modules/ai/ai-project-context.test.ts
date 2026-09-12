import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

describe("项目上下文", () => {
  it("无 projectId 时跳过项目上下文，不阻断 AI", async () => {
    const { resolveProjectContext } = await import("./ai-generation.service.js");
    const result = await resolveProjectContext({ db: { select: () => ({}) } } as never, null);
    expect(result).toBeNull();
  });

  it("有项目时注入结构化字段", async () => {
    const { resolveProjectContext } = await import("./ai-generation.service.js");
    const app = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{
                name: "苏州住宅",
                description: "既有改造",
                region: "江苏苏州",
                buildingType: "RESIDENTIAL"
              }]
            })
          })
        })
      }
    };
    const text = await resolveProjectContext(app as never, "p-1");
    expect(text).toContain("项目名称：苏州住宅");
    expect(text).toContain("所在地区：江苏苏州");
    expect(text).toContain("建筑类型：RESIDENTIAL");
    expect(text).not.toContain("未关联项目");
  });
});
