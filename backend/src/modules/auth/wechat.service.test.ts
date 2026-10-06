import { describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { AuthError } = await import("../../shared/auth-errors.js");
const { WechatMiniProgramService } = await import("./wechat.service.js");

function createRedis(initial?: Record<string, string>) {
  const store = new Map<string, { value: string; ttl?: number }>(
    Object.entries(initial ?? {}).map(([key, value]) => [key, { value }])
  );
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    set: vi.fn(async (key: string, value: string, _mode?: string, ttl?: number) => {
      store.set(key, { value, ttl });
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    })
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function createLogger() {
  const entries: Array<{ level: string; payload: unknown; message?: string }> = [];
  return {
    entries,
    logger: {
      error: (payload: unknown, message?: string) => entries.push({ level: "error", payload, message }),
      warn: (payload: unknown, message?: string) => entries.push({ level: "warn", payload, message }),
      info: (payload: unknown, message?: string) => entries.push({ level: "info", payload, message })
    }
  };
}

describe("WechatMiniProgramService", () => {
  it("code2Session 用 loginCode 换 openid，并保留 session_key 仅在服务内部", async () => {
    const redis = createRedis();
    const fetchImpl = vi.fn(async () => jsonResponse({
      openid: "openid-1",
      unionid: "union-1",
      session_key: "session-secret"
    }));
    const { logger, entries } = createLogger();
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: redis as never,
      fetchImpl: fetchImpl as never,
      logger: logger as never
    });
    const result = await service.code2Session("login-code");
    expect(result).toEqual({ openid: "openid-1", unionid: "union-1", sessionKey: "session-secret" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("jscode2session");
    expect(JSON.stringify(entries)).not.toContain("super-secret");
    expect(JSON.stringify(entries)).not.toContain("session-secret");
    expect(JSON.stringify(entries)).not.toContain("login-code");
  });

  it("loginCode 无效时返回 WECHAT_LOGIN_CODE_INVALID", async () => {
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: createRedis() as never,
      fetchImpl: (async () => jsonResponse({ errcode: 40029, errmsg: "invalid code" })) as never
    });
    await expect(service.code2Session("bad-code")).rejects.toMatchObject({
      details: { errorCode: "WECHAT_LOGIN_CODE_INVALID" }
    });
  });

  it("access_token 命中 Redis 缓存时不再请求微信", async () => {
    const redis = createRedis({ "wechat:mini:access_token": "cached-token" });
    const fetchImpl = vi.fn();
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: redis as never,
      fetchImpl: fetchImpl as never
    });
    await expect(service.getAccessToken()).resolves.toBe("cached-token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("access_token 缓存 TTL 使用 expires_in 减安全余量", async () => {
    const redis = createRedis();
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "fresh-token", expires_in: 7200 }));
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: redis as never,
      fetchImpl: fetchImpl as never
    });
    await expect(service.getAccessToken()).resolves.toBe("fresh-token");
    expect(redis.set).toHaveBeenCalledWith("wechat:mini:access_token", "fresh-token", "EX", 6900);
  });

  it("phoneCode 换号优先使用 purePhoneNumber", async () => {
    const redis = createRedis({ "wechat:mini:access_token": "cached-token" });
    const fetchImpl = vi.fn(async () => jsonResponse({
      errcode: 0,
      phone_info: {
        phoneNumber: "+8613800138000",
        purePhoneNumber: "13800138000",
        countryCode: "86"
      }
    }));
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: redis as never,
      fetchImpl: fetchImpl as never
    });
    await expect(service.getPhoneNumber("phone-code")).resolves.toEqual({
      purePhoneNumber: "13800138000",
      phoneNumber: "+8613800138000",
      countryCode: "86"
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("getuserphonenumber");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ code: "phone-code" })
    });
  });

  it("phoneCode 无效时返回 WECHAT_PHONE_CODE_INVALID", async () => {
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: createRedis({ "wechat:mini:access_token": "cached-token" }) as never,
      fetchImpl: (async () => jsonResponse({ errcode: 40163, errmsg: "code been used" })) as never
    });
    await expect(service.getPhoneNumber("used-code")).rejects.toBeInstanceOf(AuthError);
    await expect(service.getPhoneNumber("used-code")).rejects.toMatchObject({
      details: { errorCode: "WECHAT_PHONE_CODE_INVALID" }
    });
  });

  it("access_token 失效时清缓存并重试一次", async () => {
    const redis = createRedis({ "wechat:mini:access_token": "stale-token" });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("stale-token")) {
        return jsonResponse({ errcode: 40001, errmsg: "invalid credential" });
      }
      if (String(url).includes("cgi-bin/token")) {
        return jsonResponse({ access_token: "new-token", expires_in: 7200 });
      }
      return jsonResponse({
        errcode: 0,
        phone_info: { purePhoneNumber: "13800138000", phoneNumber: "13800138000", countryCode: "86" }
      });
    });
    const service = new WechatMiniProgramService({
      appId: "wx-app",
      appSecret: "super-secret",
      redis: redis as never,
      fetchImpl: fetchImpl as never
    });
    await expect(service.getPhoneNumber("phone-code")).resolves.toMatchObject({ purePhoneNumber: "13800138000" });
    expect(redis.del).toHaveBeenCalledWith("wechat:mini:access_token");
  });
});
