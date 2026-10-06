import { describe, expect, it } from "vitest";
import { inspectClientPasswordLogin } from "./client-password.service.js";

describe("客户端密码登录检查", () => {
  it("未设置密码时返回 PASSWORD_NOT_SET", () => {
    expect(inspectClientPasswordLogin({
      userId: "user-1",
      displayName: "用户8000",
      role: "NORMAL_USER",
      channelType: null,
      adminLoginEnabled: false,
      status: "ACTIVE",
      phone: "13800138000",
      passwordHash: null
    })).toEqual({ ok: false, error: "PASSWORD_NOT_SET" });
  });

  it("设置密码后可以进入校验", () => {
    expect(inspectClientPasswordLogin({
      userId: "user-1",
      displayName: "用户8000",
      role: "NORMAL_USER",
      channelType: null,
      adminLoginEnabled: false,
      status: "ACTIVE",
      phone: "13800138000",
      passwordHash: "argon2-hash"
    })).toMatchObject({ ok: true, passwordHash: "argon2-hash" });
  });

  it("禁用用户密码登录被拒绝", () => {
    expect(inspectClientPasswordLogin({
      userId: "user-1",
      displayName: "用户8000",
      role: "NORMAL_USER",
      channelType: null,
      adminLoginEnabled: false,
      status: "DISABLED",
      phone: "13800138000",
      passwordHash: "argon2-hash"
    })).toEqual({ ok: false, error: "USER_DISABLED" });
  });

  it("账号不存在不泄露为未设置密码", () => {
    expect(inspectClientPasswordLogin(null)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
