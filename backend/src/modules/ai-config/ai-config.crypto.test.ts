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

describe("AI 配置密钥加密", () => {
  it("能够加密解密且不会保存明文", async () => {
    const { decryptSecret, encryptSecret } = await import("./ai-config.crypto.js");
    const secret = "sk-test-sensitive-value";
    const encrypted = encryptSecret(secret);
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(encrypted.iv).not.toBe("");
    expect(encrypted.tag).not.toBe("");
    expect(decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.tag)).toBe(secret);
  });
});
