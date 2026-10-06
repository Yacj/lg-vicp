import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { ForbiddenError } = await import("../../shared/errors.js");
const { assertAccountCanUseClient, resolveClientAccessRole } = await import("./auth.service.js");

describe("账号分端登录闸门", () => {
  it("普通用户只能登录 C 端 / PC AI 端，有效身份仍是普通用户", () => {
    expect(resolveClientAccessRole("NORMAL_USER", "C_APP")).toBe("NORMAL_USER");
    expect(resolveClientAccessRole("NORMAL_USER", "PC_AI")).toBe("NORMAL_USER");
    expect(() => assertAccountCanUseClient({ role: "NORMAL_USER" }, "B_ADMIN")).toThrow(ForbiddenError);
  });

  it("超级管理员可以登录各端，C 端有效身份是普通用户，不再拒绝进 C 端", () => {
    expect(resolveClientAccessRole("SUPER_ADMIN", "B_ADMIN")).toBe("SUPER_ADMIN");
    expect(resolveClientAccessRole("SUPER_ADMIN", "C_APP")).toBe("NORMAL_USER");
    expect(resolveClientAccessRole("SUPER_ADMIN", "PC_AI")).toBe("NORMAL_USER");
    expect(() => assertAccountCanUseClient({ role: "SUPER_ADMIN" }, "C_APP")).not.toThrow();
  });

  it("渠道账号不能登录后台，C 端有效身份是普通用户", () => {
    expect(() => assertAccountCanUseClient({ role: "CHANNEL_USER" }, "B_ADMIN")).toThrow("当前账号不能登录，请联系管理员");
    expect(resolveClientAccessRole("CHANNEL_USER", "C_APP")).toBe("NORMAL_USER");
    expect(resolveClientAccessRole("CHANNEL_USER", "PC_AI")).toBe("NORMAL_USER");
  });
});
