import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { createObjectStorage } from "../storage/index.js";

export const storagePlugin = fp(async (app) => {
  const storage = createObjectStorage(env);
  try {
    await storage.ensureBucket();
  } catch (error) {
    app.log.warn({ err: error }, "对象存储暂时不可用，服务将保持启动并由就绪检查报告状态");
  }
  app.decorate("storage", storage);
});
