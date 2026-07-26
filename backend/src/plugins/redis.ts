import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export function createRedisConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: (times) => times > 3 ? null : Math.min(times * 500, 2000)
  });
}

export const redisPlugin = fp(async (app) => {
  const redis = createRedisConnection();
  redis.on("error", (error) => app.log.error({ err: error }, "Redis 连接异常"));
  try {
    await redis.connect();
  } catch (error) {
    app.log.warn({ err: error }, "Redis 暂时不可用，服务将保持启动并由就绪检查报告状态");
  }
  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    if (redis.status === "ready" || redis.status === "connect") {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });
});
