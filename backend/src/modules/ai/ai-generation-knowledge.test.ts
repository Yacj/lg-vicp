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

vi.mock("../knowledge/knowledge.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../knowledge/knowledge.service.js")>();
  return {
    ...actual,
    searchProjectKnowledge: vi.fn()
  };
});

describe("loadKnowledgeForGeneration", () => {
  it("知识检索抛错时降级为空结果，不向外抛 500", async () => {
    const { searchProjectKnowledge } = await import("../knowledge/knowledge.service.js");
    vi.mocked(searchProjectKnowledge).mockRejectedValueOnce(new Error("unnest empty array"));
    const { loadKnowledgeForGeneration } = await import("./ai-knowledge-load.js");
    const log = { error: vi.fn() };

    const result = await loadKnowledgeForGeneration({
      app: {} as never,
      log: log as never,
      conversationId: "c-1",
      messageId: "m-1",
      content: "请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。",
      projectId: null,
      insulationSystemId: null,
      needSearch: true
    });

    expect(result).toEqual({ chunks: [], retrievalFailed: true });
    expect(log.error).toHaveBeenCalled();
  });

  it("不需要检索时不访问知识库", async () => {
    const { searchProjectKnowledge } = await import("../knowledge/knowledge.service.js");
    vi.mocked(searchProjectKnowledge).mockClear();
    const { loadKnowledgeForGeneration } = await import("./ai-knowledge-load.js");

    const result = await loadKnowledgeForGeneration({
      app: {} as never,
      log: { error: vi.fn() } as never,
      conversationId: "c-1",
      messageId: "m-1",
      content: "你好",
      projectId: null,
      insulationSystemId: null,
      needSearch: false
    });

    expect(result).toEqual({ chunks: [], retrievalFailed: false });
    expect(searchProjectKnowledge).not.toHaveBeenCalled();
  });
});
