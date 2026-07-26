import fp from "fastify-plugin";
import { closeQueues, createQueues } from "../queues/queues.js";

export const queuesPlugin = fp(async (app) => {
  const queues = createQueues(app.redis);
  for (const queue of Object.values(queues)) {
    queue.on("error", (error: Error) => app.log.error({ err: error, queue: queue.name }, "队列连接异常"));
  }
  app.decorate("queues", queues);

  app.addHook("onClose", async () => {
    await closeQueues(queues);
  });
});
