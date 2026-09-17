import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
  process.env.AI_CONTEXT_BUCKET_SUMMARY_TOKENS = "800";
});

describe("Token 分桶裁剪", () => {
  it("超预算时截断并保留开头", async () => {
    const { truncateToTokenBudget, estimateTokens } = await import("../../shared/prompt-assembly.js");
    const text = "目标K值0.30。".repeat(200);
    const truncated = truncateToTokenBudget(text, 20);
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(20);
    expect(truncated.startsWith("目标K值")).toBe(true);
  });

  it("压缩重复来源行", async () => {
    const { compressToolOrKnowledgeText } = await import("../../shared/prompt-assembly.js");
    const text = ["[资料1] 图集 A7", "[资料1] 图集 A7", "额外说明"].join("\n");
    const compressed = compressToolOrKnowledgeText(text, 200);
    expect(compressed.split("\n").filter((line) => line.includes("图集 A7"))).toHaveLength(1);
  });
});

describe("历史附件语义", () => {
  it("格式化可追问的图片摘要", async () => {
    const { formatAttachmentContext } = await import("./ai-context-builder.js");
    const text = formatAttachmentContext([{
      messageId: "m1",
      fileId: "f1",
      semanticSummary: "节点大样图，左侧窗洞口，右侧第二个节点为阳角。",
      extractedText: "25mm",
      detectedObjects: ["窗洞口", "阳角"],
      model: "vision",
      createdAt: new Date()
    }]);
    expect(text).toContain("刚才那张图");
    expect(text).toContain("第二个节点");
    expect(text).toContain("fileId=f1");
  });
});
