import { describe, expect, it } from "vitest";
import { createCaptcha, hashCaptcha, verifyCaptcha } from "./captcha.service.js";

describe("登录验证码", () => {
  it("生成图片并验证大小写不敏感的验证码", async () => {
    const captcha = createCaptcha();
    const values = new Map<string, string>([["captcha-key", hashCaptcha(captcha.code)]]);
    const redis = {
      get: async (key: string) => values.get(key) ?? null
    } as never;
    expect(captcha.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(await verifyCaptcha(redis, "captcha-key", captcha.code.toLowerCase())).toBe(true);
    expect(await verifyCaptcha(redis, "captcha-key", "WRONG")).toBe(false);
  });
});
