import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { clientRegisterBodySchema, clientWechatPhoneLoginBodySchema, clientPasswordSmsBodySchema } = await import("./auth.routes.js");
const { getAccessTokenExpiresIn } = await import("./auth.service.js");
const { AUTH_ERROR_CODES } = await import("../../shared/auth-errors.js");

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

  it("前端传入 role 不会覆盖为超级管理员", () => {
    const parsed = clientRegisterBodySchema.parse({
      clientType: "C_APP",
      phone: "13800138000",
      password: "correct-horse-123",
      role: "SUPER_ADMIN"
    });
    expect(parsed).not.toHaveProperty("role");
  });
});

describe("微信手机号快捷登录入参", () => {
  it("只接受 loginCode 与 phoneCode，忽略前端传入的 role 和手机号", () => {
    const parsed = clientWechatPhoneLoginBodySchema.parse({
      loginCode: "wx-login-code",
      phoneCode: "wx-phone-code",
      role: "SUPER_ADMIN",
      phone: "13800138000",
      adminLoginEnabled: true
    });
    expect(parsed).toEqual({ loginCode: "wx-login-code", phoneCode: "wx-phone-code" });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("phone");
  });

  it("设置/重置密码必须带短信验证码且不能指定角色", () => {
    const parsed = clientPasswordSmsBodySchema.parse({
      clientType: "C_APP",
      phone: "13800138000",
      code: "123456",
      password: "new-pass-123",
      role: "SUPER_ADMIN"
    });
    expect(parsed).not.toHaveProperty("role");
    expect(AUTH_ERROR_CODES.PASSWORD_NOT_SET).toBe("PASSWORD_NOT_SET");
    expect(AUTH_ERROR_CODES.PHONE_IDENTITY_CONFLICT).toBe("PHONE_IDENTITY_CONFLICT");
    expect(AUTH_ERROR_CODES.WECHAT_IDENTITY_CONFLICT).toBe("WECHAT_IDENTITY_CONFLICT");
    expect(AUTH_ERROR_CODES.APP_ACCESS_DISABLED).toBe("APP_ACCESS_DISABLED");
  });
});