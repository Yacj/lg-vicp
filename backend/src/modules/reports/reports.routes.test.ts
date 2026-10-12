import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://localhost:5432/lg_vicp_test",
  JWT_SECRET: "test-jwt-secret-123",
  AI_CONFIG_ENCRYPTION_KEY: "12345678901234567890123456789012",
  STORAGE_ACCESS_KEY: "test-access",
  STORAGE_SECRET_KEY: "test-secret",
  BOOTSTRAP_ADMIN_PASSWORD: "test-admin-password"
});

const { authPlugin } = await import("../../plugins/auth.js");
const { errorHandlerPlugin } = await import("../../plugins/error-handler.js");
const { reportRoutes } = await import("./reports.routes.js");

describe("报告类型接口鉴权", () => {
  it.each(["missing", "invalid", "expired"] as const)("%s 令牌返回统一 401 业务错误", async (kind) => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(reportRoutes, { prefix: "/api/v1" });
    try {
      const token = kind === "expired"
        ? app.jwt.sign({ sub: "test-user", tokenType: "access", exp: 1 })
        : "invalid-token";
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/reports/types?_t=1791801587628",
        headers: kind === "missing" ? {} : { authorization: `Bearer ${token}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: false,
        error: { code: 401, message: "登录状态无效或已过期" },
        requestId: expect.any(String)
      });
    } finally {
      await app.close();
    }
  });
});
