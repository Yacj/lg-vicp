import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { CORS_DISABLED } from "./cors.js";

describe("同源访问，不回写 CORS", () => {
  it("策略关闭跨域", () => {
    expect(CORS_DISABLED).toBe(true);
  });

  it("带 Origin 的请求不写 Access-Control-Allow-Origin", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/v1/auth/b/captchaImage", async () => ({ ok: true }));
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/b/captchaImage",
      headers: {
        origin: "http://192.168.2.117:5173"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
