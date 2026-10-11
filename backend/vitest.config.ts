import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 本仓库测试大量使用 `await import("./x.service.js")` 冷加载 Fastify/Drizzle/AI SDK
    // 等重型 module graph。开发机 CPU 核数较少时（例如 4 核），并发文件下的首次
    // transform + 冷加载会超过 vitest 默认 5s 超时，产生与本轮改动无关的假失败。
    // 这里统一放宽到 30s，并限制并发文件数，保证 `pnpm test` 稳定可复现。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: true,
    maxWorkers: "50%",
    minWorkers: 1
  }
});
