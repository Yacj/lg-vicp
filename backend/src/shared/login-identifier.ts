/** 登录标识的统一归一化规则：所有写入、查询和限流键都必须复用。 */
export const LOGIN_PHONE_PATTERN = /^\+?[0-9]{6,20}$/;

export function normalizePhone(phone: string): string {
  return phone.trim();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeLoginIdentifier(identifier: string): string {
  const normalized = identifier.trim();
  return LOGIN_PHONE_PATTERN.test(normalized) ? normalizePhone(normalized) : normalizeUsername(normalized);
}

export function isPhoneLoginIdentifier(identifier: string): boolean {
  return LOGIN_PHONE_PATTERN.test(normalizePhone(identifier));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeOptionalEmail(email: string | null | undefined): string | null | undefined {
  if (email == null) return email;
  return normalizeEmail(email);
}
