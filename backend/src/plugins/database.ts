import fp from "fastify-plugin";
import { createDatabase } from "../db/client.js";
import { env } from "../config/env.js";

export const databasePlugin = fp(async (app) => {
  const connection = createDatabase(env);
  app.decorate("db", connection.db);
  app.decorate("sqlClient", connection.client);

  app.addHook("onClose", async () => {
    await connection.client.end({ timeout: 5 });
  });
});
