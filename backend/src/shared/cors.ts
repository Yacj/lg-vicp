/**
 * 对任意浏览器来源放行跨域（含局域网 IP / 任意端口）。
 * 回显请求 Origin，避免 `*` 与 credentials 冲突；鉴权仍走 JWT，不依赖同源。
 */
export const CORS_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"] as const;

export const CORS_EXPOSED_HEADERS = ["x-request-id"] as const;

export const corsPluginOptions = {
  origin: true as const,
  credentials: true,
  methods: [...CORS_METHODS],
  exposedHeaders: [...CORS_EXPOSED_HEADERS],
  maxAge: 86400,
  strictPreflight: false,
  preflightContinue: false,
  hook: "onRequest" as const
};
