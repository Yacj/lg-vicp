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

import { resolveKnowledgeSearchDocScope } from "./knowledge.service.js";

describe("resolveKnowledgeSearchDocScope", () => {
  it("生产对话无项目时只检索平台文档", () => {
    expect(resolveKnowledgeSearchDocScope({})).toBe("PLATFORM_ONLY");
    expect(resolveKnowledgeSearchDocScope({ projectId: null })).toBe("PLATFORM_ONLY");
  });

  it("关联项目时检索平台文档 + 当前项目文档", () => {
    expect(resolveKnowledgeSearchDocScope({ projectId: "proj-1" })).toBe("PLATFORM_AND_PROJECT");
  });

  it("B 端版本测试不叠加项目范围", () => {
    expect(resolveKnowledgeSearchDocScope({ versionId: "ver-1", projectId: "proj-1" })).toBe("VERSION_ONLY");
  });
});
