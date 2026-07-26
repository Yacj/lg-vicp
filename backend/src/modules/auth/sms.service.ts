import type { FastifyBaseLogger } from "fastify";

export interface SmsProvider {
  sendCode(phone: string, code: string): Promise<void>;
}

export function createSmsProvider(logger: FastifyBaseLogger, environment: "development" | "test" | "production"): SmsProvider {
  return {
    async sendCode(phone, code) {
      if (environment === "production") {
        throw new Error("短信服务尚未配置");
      }
      logger.info({ phone, code }, "开发环境短信验证码");
    }
  };
}
