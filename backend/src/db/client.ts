import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env.js";
import * as schema from "./schema.js";

export interface DatabaseConnection {
  db: PostgresJsDatabase<typeof schema>;
  client: postgres.Sql;
}

export type Database = DatabaseConnection["db"];
export type DbExecutor = Pick<Database, "insert" | "select" | "update" | "delete" | "execute">;

export function createDatabase(env: Env): DatabaseConnection {
  const client = postgres(env.DATABASE_URL, {
    max: env.DATABASE_MAX_CONNECTIONS,
    connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
    prepare: env.NODE_ENV !== "test",
    onnotice: env.NODE_ENV === "development" ? undefined : () => undefined
  });

  return {
    client,
    db: drizzle(client, { schema })
  };
}
