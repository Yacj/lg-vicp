/**
 * 浏览器跨域配置：C 端/B 端本地与生产域名并存，预检必须稳定返回 CORS 头。
 * CORS_ORIGIN 支持 `*`、空值（回显请求 Origin）或逗号分隔白名单。
 * 允许头必须与 `deploy/nginx.conf` 预检白名单同步（B 端会带 X-Client-Type）。
 */
export const CORS_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"] as const;

export const CORS_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "Origin",
  "X-Requested-With",
  "X-Request-Id",
  "X-Client-Type"
] as const;

export const CORS_EXPOSED_HEADERS = ["x-request-id"] as const;

export type CorsOriginOption = true | string[];

/** 将 CORS_ORIGIN 解析为 @fastify/cors 的 origin 选项。 */
export function resolveCorsOrigin(corsOrigin: string): CorsOriginOption {
  const trimmed = corsOrigin.trim();
  if (trimmed === "" || trimmed === "*") {
    return true;
  }

  const origins = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) {
    return true;
  }

  // 始终返回数组，让 @fastify/cors 按请求 Origin 校验；单字符串会无条件回写该值
  return origins;
}

export function corsPluginOptions(corsOrigin: string) {
  return {
    origin: resolveCorsOrigin(corsOrigin),
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    credentials: true,
    maxAge: 86400,
    strictPreflight: false,
    preflightContinue: false,
    hook: "onRequest" as const
  };
}
