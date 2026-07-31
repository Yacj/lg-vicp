import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { clientRegisterBodySchema } = await import("./auth.routes.js");
const { getAccessTokenExpiresIn } = await import("./auth.service.js");

describe("客户端手机号密码注册", () => {
  it("按客户端返回不同的访问令牌有效期", () => {
    expect(getAccessTokenExpiresIn("B_ADMIN")).toBe("24h");
    expect(getAccessTokenExpiresIn("C_APP")).toBe("30d");
    expect(getAccessTokenExpiresIn("PC_AI")).toBe("30d");
  });

  it("接受 C_APP 和 PC_AI 注册请求", () => {
    expect(clientRegisterBodySchema.parse({
      clientType: "C_APP",
      phone: "13800138000",
      password: "correct-horse-123"
    })).toMatchObject({ clientType: "C_APP", phone: "13800138000" });

    expect(clientRegisterBodySchema.parse({
      clientType: "PC_AI",
      phone: "+8613800138000",
      password: "12345"
    })).toMatchObject({ clientType: "PC_AI", phone: "+8613800138000" });
  });

  it("拒绝 B_ADMIN、非法手机号和弱密码", () => {
    expect(clientRegisterBodySchema.safeParse({
      clientType: "B_ADMIN",
      phone: "13800138000",
      password: "correct-horse-123"
    }).success).toBe(false);

    expect(clientRegisterBodySchema.safeParse({
      clientType: "C_APP",
      phone: "13800",
      password: "correct-horse-123"
    }).success).toBe(false);

    expect(clientRegisterBodySchema.safeParse({
      clientType: "C_APP",
      phone: "13800138000",
      password: "1234"
    }).success).toBe(false);
  });
});