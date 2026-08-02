import { z } from "zod";

const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(30).default(5),
  JWT_SECRET: z.string().min(16),
  JWT_B_ACCESS_EXPIRES_IN: z.string().default("24h"),
  JWT_C_ACCESS_EXPIRES_IN: z.string().default("30d"),
  JWT_PC_AI_ACCESS_EXPIRES_IN: z.string().default("30d"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  AI_MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().min(1).default(2),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).default(200),
  AI_CONTEXT_MAX_MESSAGES: z.coerce.number().int().min(2).max(100).default(20),
  AI_CONTEXT_OUTPUT_RESERVE_RATIO: z.coerce.number().min(0).max(0.5).default(0.1),
  AI_CONFIG_ENCRYPTION_KEY: z.string().refine(
    (value) => Buffer.byteLength(value, "utf8") === 32,
    "必须恰好为 32 字节"
  ),
  STORAGE_PROVIDER: z.enum(["minio", "oss"]).default("minio"),
  STORAGE_BUCKET: z.string().min(3).default("lg-vicp"),
  STORAGE_ENDPOINT: z.string().default("localhost"),
  STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_USE_SSL: z.stringbool().default(false),
  STORAGE_PUBLIC_ENDPOINT: z.string().default("localhost"),
  STORAGE_PUBLIC_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_PUBLIC_USE_SSL: z.stringbool().default(false),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  OSS_REGION: z.string().default("oss-cn-hangzhou"),
  OSS_ENDPOINT: optionalString,
  OSS_INTERNAL: z.stringbool().default(false),
  STORAGE_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: optionalString,
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(3).default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(5),
  CORS_ORIGIN: z.string().default("*")
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量配置无效：${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();
