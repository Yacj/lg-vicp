import { ConflictError } from "./errors.js";

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

export function uniqueViolationMessage(error: unknown, fallback = "数据已存在，请勿重复提交"): string {
  if (typeof error !== "object" || error === null) return fallback;
  const constraint = (error as { constraint?: unknown }).constraint;
  switch (constraint) {
    case "user_identities_identifier_unique":
    case "user_identities_type_identifier_unique":
      return "登录账号已存在";
    case "users_phone_unique":
      return "手机号已存在";
    case "users_email_unique":
      return "邮箱已存在";
    default:
      return fallback;
  }
}

export function asConflictError(error: unknown, fallback?: string): ConflictError | null {
  return isUniqueViolation(error) ? new ConflictError(uniqueViolationMessage(error, fallback)) : null;
}
