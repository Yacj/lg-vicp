import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
    listenTextResolver: (address) => `服务监听地址：${address}`
  });
  app.log.info(`蓝格 VICP 后端已启动：http://${env.HOST}:${env.PORT}`);
} catch (error) {
  app.log.error(error, "后端服务启动失败");
  process.exit(1);
}
