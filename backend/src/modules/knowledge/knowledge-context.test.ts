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

import { formatKnowledgeContext, type WikiHit } from "./knowledge.service.js";

const hit: WikiHit = {
  sourceId: "section-1",
  documentId: "doc-1",
  versionId: "ver-1",
  content: "窗洞口应做不燃材料封堵。",
  sourcePage: 7,
  sourceSection: null,
  headingPath: ["4 节点做法", "4.1 窗洞口"],
  sourceTitle: "VICP建筑构造图集",
  retrievalUnit: "SECTION",
  score: 1,
  pageLabel: "A7"
};

describe("formatKnowledgeContext", () => {
  it("检索失败时给出可理解的降级说明，不抛错", () => {
    const text = formatKnowledgeContext([], { retrievalFailed: true });
    expect(text).toContain("知识资料检索暂时不可用");
    expect(text).toContain("不得编造");
  });

  it("headingPath 不是数组时不 500，仍能组装上下文", () => {
    const text = formatKnowledgeContext([{
      ...hit,
      headingPath: "4 节点做法" as unknown as string[]
    }]);
    expect(text).toContain("VICP建筑构造图集");
    expect(text).toContain("A7 页");
    expect(text).toContain("4 节点做法");
  });

  it("正常命中使用印刷页码与章节路径", () => {
    const text = formatKnowledgeContext([hit]);
    expect(text).toContain("A7 页");
    expect(text).toContain("4 节点做法 / 4.1 窗洞口");
  });
});
