import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../shared/errors.js";
import { errorHandlerPlugin } from "./error-handler.js";
import { z } from "zod";

async function buildErrorTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);

  app.get("/business-error", async () => {
    throw new UnauthorizedError("手机号或密码错误");
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
  it("业务认证错误使用 HTTP 200，并通过 error.code 返回错误类型", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/business-error" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "手机号或密码错误"
      }
    });
    await app.close();
  });

  it("参数校验错误使用 HTTP 200，并保留校验错误码", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/validation-error" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR"
      }
    });
    await app.close();
  });

  it("未捕获的服务器异常仍使用 HTTP 500", async () => {
    const app = await buildErrorTestApp();
    const response = await app.inject({ method: "GET", url: "/server-error" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR"
      }
    });
    await app.close();
  });
});
