import fp from "fastify-plugin";

export const requestContextPlugin = fp(async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.log.info({ method: request.method, url: request.url }, "收到请求");
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime
    }, "请求处理完成");
  });
});
