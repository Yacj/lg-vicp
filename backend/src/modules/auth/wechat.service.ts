import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { AuthError } from "../../shared/auth-errors.js";

const WECHAT_ACCESS_TOKEN_KEY = "wechat:mini:access_token";
const WECHAT_ACCESS_TOKEN_SAFETY_SECONDS = 300;
const WECHAT_ACCESS_TOKEN_MIN_TTL_SECONDS = 60;
const INVALID_CODE_ERRCODES = new Set([40029, 40163, 41008, 41029]);
const INVALID_CREDENTIAL_ERRCODE = 40001;

export type WechatCode2SessionResult = {
  openid: string;
  unionid?: string;
  sessionKey: string;
};

export type WechatPhoneNumberResult = {
  purePhoneNumber: string;
  phoneNumber: string;
  countryCode: string;
};

type WechatJson = Record<string, unknown>;

export class WechatMiniProgramService {
  constructor(
    private readonly options: {
      appId: string;
      appSecret: string;
      redis: Redis;
      fetchImpl?: typeof fetch;
      logger?: FastifyBaseLogger;
    }
  ) {}

  async code2Session(loginCode: string): Promise<WechatCode2SessionResult> {
    const payload = await this.requestJson("jscode2session", () => {
      const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
      url.searchParams.set("appid", this.options.appId);
      url.searchParams.set("secret", this.options.appSecret);
      url.searchParams.set("js_code", loginCode);
      url.searchParams.set("grant_type", "authorization_code");
      return { url: url.toString(), init: { method: "GET" } };
    }, "WECHAT_LOGIN_CODE_INVALID");

    const openid = asNonEmptyString(payload.openid);
    const sessionKey = asNonEmptyString(payload.session_key);
    if (!openid || !sessionKey) {
      throw new AuthError("WECHAT_LOGIN_CODE_INVALID");
    }
    const unionid = asNonEmptyString(payload.unionid);
    return unionid ? { openid, unionid, sessionKey } : { openid, sessionKey };
  }

  async getAccessToken(): Promise<string> {
    const cached = await this.options.redis.get(WECHAT_ACCESS_TOKEN_KEY);
    if (cached) return cached;

    const payload = await this.requestJson("token", () => {
      const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
      url.searchParams.set("grant_type", "client_credential");
      url.searchParams.set("appid", this.options.appId);
      url.searchParams.set("secret", this.options.appSecret);
      return { url: url.toString(), init: { method: "GET" } };
    }, "WECHAT_API_ERROR");

    const accessToken = asNonEmptyString(payload.access_token);
    const expiresIn = asPositiveNumber(payload.expires_in) ?? 7200;
    if (!accessToken) {
      throw new AuthError("WECHAT_API_ERROR");
    }
    const ttl = Math.max(WECHAT_ACCESS_TOKEN_MIN_TTL_SECONDS, expiresIn - WECHAT_ACCESS_TOKEN_SAFETY_SECONDS);
    await this.options.redis.set(WECHAT_ACCESS_TOKEN_KEY, accessToken, "EX", ttl);
    return accessToken;
  }

  async getPhoneNumber(phoneCode: string): Promise<WechatPhoneNumberResult> {
    const payload = await this.requestPhoneNumber(phoneCode);
    const phoneInfo = asObject(payload.phone_info);
    const purePhoneNumber = asNonEmptyString(phoneInfo?.purePhoneNumber);
    const phoneNumber = asNonEmptyString(phoneInfo?.phoneNumber) ?? purePhoneNumber;
    const countryCode = asNonEmptyString(phoneInfo?.countryCode) ?? "86";
    if (!purePhoneNumber || !phoneNumber) {
      throw new AuthError("WECHAT_PHONE_CODE_INVALID");
    }
    return { purePhoneNumber, phoneNumber, countryCode };
  }

  private async requestPhoneNumber(phoneCode: string, retried = false): Promise<WechatJson> {
    const accessToken = await this.getAccessToken();
    try {
      return await this.requestJson("getuserphonenumber", () => ({
        url: `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: phoneCode })
        }
      }), "WECHAT_PHONE_CODE_INVALID");
    } catch (error) {
      if (!retried && isInvalidCredentialError(error)) {
        await this.options.redis.del(WECHAT_ACCESS_TOKEN_KEY);
        return this.requestPhoneNumber(phoneCode, true);
      }
      throw error;
    }
  }

  private async requestJson(
    endpoint: string,
    build: () => { url: string; init: RequestInit },
    invalidCode: "WECHAT_LOGIN_CODE_INVALID" | "WECHAT_PHONE_CODE_INVALID" | "WECHAT_API_ERROR"
  ): Promise<WechatJson> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      const { url, init } = build();
      response = await fetchImpl(url, init);
    } catch {
      this.options.logger?.error({ endpoint }, "微信接口请求失败");
      throw new AuthError("WECHAT_API_ERROR");
    }

    let payload: WechatJson;
    try {
      payload = await response.json() as WechatJson;
    } catch {
      this.options.logger?.error({ endpoint, status: response.status }, "微信接口返回无法解析");
      throw new AuthError("WECHAT_API_ERROR");
    }

    const errcode = asNumber(payload.errcode);
    if (!response.ok && errcode == null) {
      this.options.logger?.error({ endpoint, status: response.status }, "微信接口 HTTP 失败");
      throw new AuthError("WECHAT_API_ERROR");
    }
    if (errcode && errcode !== 0) {
      this.options.logger?.warn({ endpoint, errcode }, "微信接口返回业务错误");
      if (errcode === INVALID_CREDENTIAL_ERRCODE) {
        throw Object.assign(new AuthError("WECHAT_API_ERROR"), { wechatErrcode: errcode });
      }
      if (INVALID_CODE_ERRCODES.has(errcode)) {
        throw new AuthError(invalidCode === "WECHAT_API_ERROR" ? "WECHAT_API_ERROR" : invalidCode);
      }
      throw new AuthError("WECHAT_API_ERROR");
    }
    return payload;
  }
}

export function createWechatMiniProgramService(
  redis: Redis,
  options?: { fetchImpl?: typeof fetch; logger?: FastifyBaseLogger }
): WechatMiniProgramService | null {
  const appId = env.WECHAT_MINI_APP_ID;
  const appSecret = env.WECHAT_MINI_APP_SECRET;
  if (!appId || !appSecret) return null;
  return new WechatMiniProgramService({
    appId,
    appSecret,
    redis,
    fetchImpl: options?.fetchImpl,
    logger: options?.logger
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

function isInvalidCredentialError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { wechatErrcode?: unknown }).wechatErrcode === INVALID_CREDENTIAL_ERRCODE);
}
