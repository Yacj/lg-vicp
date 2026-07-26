import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import type { Database } from "../db/client.js";
import type { AppQueues } from "../queues/queues.js";
import type { ObjectStorage } from "../storage/index.js";
import type { AuthUser } from "./auth-user.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    sqlClient: postgres.Sql;
    redis: Redis;
    queues: AppQueues;
    storage: ObjectStorage;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    currentUser?: AuthUser;
  }
}

export {};
