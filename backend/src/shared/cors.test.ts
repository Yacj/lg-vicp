import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { corsPluginOptions } from "./cors.js";

async function buildCorsApp() {
  const app = Fastify({ logger: false });
  await app.register(cors, corsPluginOptions);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    strictTransportSecurity: false
  });
  app.post("/api/v1/auth/client/login/password", async () => ({ ok: true }));
  return app;
}

describe("任意来源 CORS 放行", () => {
  it("C 端局域网 Origin 预检登录接口返回 Allow-Origin", async () => {
    const app = await buildCorsApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/client/login/password",
      headers: {
        origin: "http://192.168.2.117:8871",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://192.168.2.117:8871");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(response.headers["cross-origin-resource-policy"]).toBeUndefined();
    await app.close();
  });

  it("任意 Origin 的实际请求都回写 Allow-Origin", async () => {
    const app = await buildCorsApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/client/login/password",
      headers: {
        origin: "https://random-c-client.example:9999",
        "content-type": "application/json"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://random-c-client.example:9999");
    await app.close();
  });
});
