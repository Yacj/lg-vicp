import { describe, expect, it } from "vitest";
import { AuthError } from "../../shared/auth-errors.js";
import { isUniqueViolation } from "../../shared/database-errors.js";
import {
  resolveWechatPhoneIdentity,
  runWithUniqueRetry,
  type WechatPhoneAccount
} from "./wechat-phone-login.service.js";

function account(overrides: Partial<WechatPhoneAccount> = {}): WechatPhoneAccount {
  return {
    userId: "user-1",
    displayName: "用户8000",
    role: "NORMAL_USER",
    channelType: null,
    adminLoginEnabled: false,
    status: "ACTIVE",
    phone: "13800138000",
    passwordHash: "hash",
    ...overrides
  };
}

describe("微信手机号身份匹配", () => {
  it("已绑定微信身份则登录该用户", () => {
    const wechatUser = account({ userId: "wx-user" });
    expect(resolveWechatPhoneIdentity({
      wechatUser,
      phoneUser: wechatUser,
      phone: "13800138000"
    })).toMatchObject({ action: "LOGIN", account: wechatUser, phoneMismatch: false, bindPhone: false });
  });

  it("未找到微信身份但手机号已注册则绑定微信", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: null,
      phoneUser: account({ userId: "phone-user", passwordHash: "hash" }),
      phone: "13800138000"
    })).toMatchObject({ action: "BIND_WECHAT", account: { userId: "phone-user" } });
  });

  it("两者都没有则首次自动注册", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: null,
      phoneUser: null,
      phone: "13800138000"
    })).toEqual({ action: "REGISTER" });
  });

  it("微信身份与手机号属于不同用户时返回 PHONE_IDENTITY_CONFLICT", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: account({ userId: "wx-user", phone: "13800138000" }),
      phoneUser: account({ userId: "other-user", phone: "13900139000" }),
      phone: "13900139000"
    })).toEqual({ action: "PHONE_IDENTITY_CONFLICT" });
  });

  it("openid 已绑定且系统手机号不同时不覆盖，只标记 mismatch", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: account({ userId: "wx-user", phone: "13800138000" }),
      phoneUser: null,
      phone: "13900139000"
    })).toMatchObject({
      action: "LOGIN",
      phoneMismatch: true,
      bindPhone: false
    });
  });

  it("已绑定微信但尚未写入手机号时补绑手机号", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: account({ userId: "wx-user", phone: null, passwordHash: null }),
      phoneUser: null,
      phone: "13800138000"
    })).toMatchObject({ action: "LOGIN", bindPhone: true, phoneMismatch: false });
  });

  it("禁用用户微信登录被拒绝", () => {
    expect(resolveWechatPhoneIdentity({
      wechatUser: account({ status: "DISABLED" }),
      phoneUser: null,
      phone: "13800138000"
    })).toMatchObject({ action: "USER_DISABLED" });
    expect(resolveWechatPhoneIdentity({
      wechatUser: null,
      phoneUser: account({ status: "DISABLED" }),
      phone: "13800138000"
    })).toMatchObject({ action: "USER_DISABLED" });
  });

  it("首次注册用户固定为普通用户且不能从前端指定角色", () => {
    const decision = resolveWechatPhoneIdentity({
      wechatUser: null,
      phoneUser: null,
      phone: "13800138000"
    });
    expect(decision).toEqual({ action: "REGISTER" });
    expect(account({ role: "NORMAL_USER", adminLoginEnabled: false, passwordHash: null })).toMatchObject({
      role: "NORMAL_USER",
      adminLoginEnabled: false,
      passwordHash: null,
      channelType: null
    });
  });
});

describe("并发首次登录幂等", () => {
  it("唯一冲突后重新执行查询而不是直接失败", async () => {
    let attempts = 0;
    const result = await runWithUniqueRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      return { userId: "user-1", isFirstLogin: false };
    });
    expect(attempts).toBe(2);
    expect(result).toEqual({ userId: "user-1", isFirstLogin: false });
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("非唯一冲突错误不会重试", async () => {
    await expect(runWithUniqueRetry(async () => {
      throw new AuthError("WECHAT_API_ERROR");
    })).rejects.toBeInstanceOf(AuthError);
  });
});
