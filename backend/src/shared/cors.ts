/**
 * 浏览器与 API 必须同源：开发走 Vite 代理，生产走同域反代。
 * 不再注册 @fastify/cors，也不回写 Access-Control-*。
 */
export const CORS_DISABLED = true;
