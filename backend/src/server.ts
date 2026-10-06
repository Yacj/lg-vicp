import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { configureConsoleEncoding } from "./shared/console-encoding.js";
import { logDocxRendererAvailability } from "./workers/docx-to-pdf.js";

configureConsoleEncoding();

const app = await buildApp();

try {
  // LibreOffice 探测：不可用不阻断 API 启动
  await logDocxRendererAvailability();

  const listenAddress = await app.listen({
    host: env.HOST,
    port: env.PORT
  });
  const localHost = env.HOST === "0.0.0.0" || env.HOST === "::" ? "localhost" : env.HOST;
  const localUrl = `http://${localHost}:${env.PORT}`;

  app.log.info({
    apiUrl: localUrl,
    swaggerUrl: `${localUrl}/docs`,
    listenAddress
  }, "蓝格 VICP 后端已启动");
  if (typeof process.send === "function") {
    process.send("ready");
  }
} catch (error) {
  app.log.error(error, "后端服务启动失败");
  process.exit(1);
}
