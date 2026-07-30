import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { BusinessError, UnauthorizedError } from "../shared/errors.js";
import { errorHandlerPlugin } from "./error-handler.js";
import { z } from "zod";

async function buildErrorTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);

  app.get("/business-error", async () => {
    throw new BusinessError("手机号或密码错误");
  });

  app.get("/unauthorized-error", async () => {
    throw new UnauthorizedError("请先登录");
  });

  app.get("/validation-error", async () => {
    z.object({ phone: z.string() }).parse({});
  });

  app.get("/server-error", async () => {
    throw new Error("database connection failed");
  });

  return app;
}

describe("统一错误响应", () => {
  it("登录凭据错误使用 HTTP 200，并返回数值 500 错误码", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/business-error" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 500,
        message: "手机号或密码错误"
      }
    });
    await app.close();
  });

  it("访问令牌认证错误使用 HTTP 200，并返回数值 401 错误码", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/unauthorized-error" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 401,
        message: "请先登录"
      }
    });
    await app.close();
  });

  it("参数校验错误使用 HTTP 200，并返回数值 400 错误码", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/validation-error" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 400
      }
    });
    await app.close();
  });

  it("未捕获的服务器异常使用 HTTP 500，并返回数值 500 错误码", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/server-error" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 500
      }
    });
    await app.close();
  });
});
