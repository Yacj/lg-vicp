import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { corsPluginOptions, resolveCorsOrigin } from "./cors.js";

describe("CORS 来源解析", () => {
  it("空值和 * 回显请求 Origin", () => {
    expect(resolveCorsOrigin("")).toBe(true);
    expect(resolveCorsOrigin(" * ")).toBe(true);
    expect(resolveCorsOrigin("https://a.example, *")).toBe(true);
  });

  it("支持逗号分隔的多来源白名单", () => {
    expect(resolveCorsOrigin("http://localhost:5173")).toEqual(["http://localhost:5173"]);
    expect(resolveCorsOrigin("http://localhost:5173, http://localhost:8871")).toEqual([
      "http://localhost:5173",
      "http://localhost:8871"
    ]);
  });
});

describe("浏览器预检 OPTIONS", () => {
  async function buildCorsApp(corsOrigin: string) {
    const app = Fastify({ logger: false });
    await app.register(cors, corsPluginOptions(corsOrigin));
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      strictTransportSecurity: false
    });
    app.get("/api/v1/ai/conversations", async () => ({ ok: true }));
    return app;
  }

  it("C 端 Authorization 预检返回 Allow-Origin 且不经过业务路由", async () => {
    const app = await buildCorsApp("*");
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/ai/conversations?clientApp=c_app&page=1",
      headers: {
        origin: "http://localhost:8871",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:8871");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(response.headers["cross-origin-resource-policy"]).toBeUndefined();
    await app.close();
  });

  it("白名单外的来源不写 Allow-Origin", async () => {
    const app = await buildCorsApp("http://localhost:5173");
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/ai/conversations",
      headers: {
        origin: "http://localhost:8871",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("白名单内的 C 端来源可以预检通过", async () => {
    const app = await buildCorsApp("http://localhost:5173,http://localhost:8871");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ai/conversations",
      headers: {
        origin: "http://localhost:8871",
        authorization: "Bearer test"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:8871");
    await app.close();
  });
});
