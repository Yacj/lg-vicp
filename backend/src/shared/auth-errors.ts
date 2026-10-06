import { AppError } from "./errors.js";

/**
 * 认证业务错误码（稳定字符串，随 details.errorCode 返回）。
 * error.code 仍为数值型 HTTP 语义码。
 */
export const AUTH_ERROR_CODES = {
  WECHAT_LOGIN_CODE_INVALID: "WECHAT_LOGIN_CODE_INVALID",
  WECHAT_PHONE_CODE_INVALID: "WECHAT_PHONE_CODE_INVALID",
  WECHAT_API_ERROR: "WECHAT_API_ERROR",
  USER_DISABLED: "USER_DISABLED",
  APP_ACCESS_DISABLED: "APP_ACCESS_DISABLED",
  PHONE_CONFLICT: "PHONE_CONFLICT",
  PHONE_IDENTITY_CONFLICT: "PHONE_IDENTITY_CONFLICT",
  WECHAT_IDENTITY_CONFLICT: "WECHAT_IDENTITY_CONFLICT",
  PASSWORD_NOT_SET: "PASSWORD_NOT_SET"
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

interface AuthErrorSpec {
  statusCode: number;
  message: string;
}

export const AUTH_ERROR_SPECS: Record<AuthErrorCode, AuthErrorSpec> = {
  WECHAT_LOGIN_CODE_INVALID: { statusCode: 400, message: "微信登录凭证无效或已过期，请重新授权" },
  WECHAT_PHONE_CODE_INVALID: { statusCode: 400, message: "微信手机号授权无效或已过期，请重新授权" },
  WECHAT_API_ERROR: { statusCode: 500, message: "微信服务暂时不可用，请稍后重试" },
  USER_DISABLED: { statusCode: 403, message: "账号已被禁用" },
  APP_ACCESS_DISABLED: { statusCode: 403, message: "当前端访问已被禁用" },
  PHONE_CONFLICT: { statusCode: 409, message: "该微信或手机号已绑定其他账号，请使用换绑流程" },
  PHONE_IDENTITY_CONFLICT: { statusCode: 409, message: "该手机号已绑定其他账号" },
  WECHAT_IDENTITY_CONFLICT: { statusCode: 409, message: "该微信已绑定其他账号" },
  PASSWORD_NOT_SET: { statusCode: 400, message: "该账号尚未设置密码，请先设置密码后再登录" }
};

export class AuthError extends AppError {
  constructor(code: AuthErrorCode, message?: string) {
    const spec = AUTH_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode, { errorCode: code });
  }
}
