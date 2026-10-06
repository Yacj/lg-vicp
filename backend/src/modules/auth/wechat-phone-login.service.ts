import { and, eq, isNull } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client.js";
import { userIdentities, users } from "../../db/schema.js";
import { AuthError } from "../../shared/auth-errors.js";
import { isUniqueViolation } from "../../shared/database-errors.js";
import { normalizeLoginIdentifier, normalizePhone } from "../../shared/login-identifier.js";
import { ensureClientAppAccess } from "./user-app-access.service.js";

export const WECHAT_MINI_IDENTITY_TYPE = "WECHAT_OPENID" as const;

export type WechatPhoneAccount = {
  userId: string;
  displayName: string;
  role: "SUPER_ADMIN" | "CHANNEL_USER" | "NORMAL_USER";
  channelType: "DEALER" | "SALESPERSON" | null;
  adminLoginEnabled: boolean;
  status: "ACTIVE" | "DISABLED";
  phone: string | null;
  passwordHash: string | null;
};

export type WechatPhoneIdentityDecision =
  | { action: "LOGIN"; account: WechatPhoneAccount; phoneMismatch: boolean; bindPhone: boolean }
  | { action: "BIND_WECHAT"; account: WechatPhoneAccount }
  | { action: "REGISTER" }
  | { action: "USER_DISABLED"; account: WechatPhoneAccount }
  | { action: "PHONE_IDENTITY_CONFLICT" };

export type WechatPhoneLoginOutcome = {
  account: WechatPhoneAccount;
  isFirstLogin: boolean;
  passwordSet: boolean;
  phoneMerged: boolean;
  wechatBound: boolean;
  phoneMismatch: boolean;
};

const MAX_UNIQUE_RETRIES = 3;

/** 小程序身份沿用现有 WECHAT_OPENID；identifier=openid，unionid 写入 metadata。 */
export function resolveWechatPhoneIdentity(input: {
  wechatUser: WechatPhoneAccount | null;
  phoneUser: WechatPhoneAccount | null;
  phone: string;
}): WechatPhoneIdentityDecision {
  const { wechatUser, phoneUser, phone } = input;
  if (wechatUser) {
    if (wechatUser.status !== "ACTIVE") return { action: "USER_DISABLED", account: wechatUser };
    if (phoneUser && phoneUser.userId !== wechatUser.userId) return { action: "PHONE_IDENTITY_CONFLICT" };
    return {
      action: "LOGIN",
      account: wechatUser,
      phoneMismatch: Boolean(wechatUser.phone && wechatUser.phone !== phone),
      bindPhone: !wechatUser.phone
    };
  }
  if (phoneUser) {
    if (phoneUser.status !== "ACTIVE") return { action: "USER_DISABLED", account: phoneUser };
    return { action: "BIND_WECHAT", account: phoneUser };
  }
  return { action: "REGISTER" };
}

export async function loginWithWechatPhone(db: Pick<Database, "transaction">, input: {
  openid: string;
  unionid?: string;
  phone: string;
}): Promise<WechatPhoneLoginOutcome> {
  const openid = normalizeLoginIdentifier(input.openid);
  const phone = normalizePhone(input.phone);
  const unionid = input.unionid ? normalizeLoginIdentifier(input.unionid) : undefined;
  return runWithUniqueRetry(() => db.transaction((tx) => applyWechatPhoneLogin(tx, { openid, unionid, phone })));
}

export async function runWithUniqueRetry<T>(run: () => Promise<T>, retries = MAX_UNIQUE_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error) || attempt === retries) throw error;
    }
  }
  throw lastError;
}

async function applyWechatPhoneLogin(tx: DbExecutor, input: {
  openid: string;
  unionid?: string;
  phone: string;
}): Promise<WechatPhoneLoginOutcome> {
  const wechatUser = await findAccountByIdentity(tx, WECHAT_MINI_IDENTITY_TYPE, input.openid);
  const phoneUser = await findAccountByPhone(tx, input.phone);
  const decision = resolveWechatPhoneIdentity({ wechatUser, phoneUser, phone: input.phone });

  if (decision.action === "USER_DISABLED") throw new AuthError("USER_DISABLED");
  if (decision.action === "PHONE_IDENTITY_CONFLICT") throw new AuthError("PHONE_IDENTITY_CONFLICT");

  if (decision.action === "LOGIN") {
    if (decision.bindPhone) {
      await ensurePhoneIdentity(tx, decision.account.userId, input.phone);
    }
    await ensureWechatIdentity(tx, decision.account.userId, input.openid, input.unionid);
    const account = await loadAccountById(tx, decision.account.userId);
    return {
      account,
      isFirstLogin: false,
      passwordSet: Boolean(account.passwordHash),
      phoneMerged: false,
      wechatBound: false,
      phoneMismatch: decision.phoneMismatch
    };
  }

  if (decision.action === "BIND_WECHAT") {
    await ensureWechatIdentity(tx, decision.account.userId, input.openid, input.unionid);
    await ensurePhoneIdentity(tx, decision.account.userId, input.phone);
    const account = await loadAccountById(tx, decision.account.userId);
    return {
      account,
      isFirstLogin: false,
      passwordSet: Boolean(account.passwordHash),
      phoneMerged: true,
      wechatBound: true,
      phoneMismatch: false
    };
  }

  const account = await createWechatPhoneUser(tx, input);
  return {
    account,
    isFirstLogin: true,
    passwordSet: false,
    phoneMerged: false,
    wechatBound: true,
    phoneMismatch: false
  };
}

async function createWechatPhoneUser(tx: DbExecutor, input: {
  openid: string;
  unionid?: string;
  phone: string;
}): Promise<WechatPhoneAccount> {
  const [user] = await tx.insert(users).values({
    phone: input.phone,
    displayName: `用户${input.phone.slice(-4)}`,
    role: "NORMAL_USER",
    channelType: null,
    adminLoginEnabled: false,
    status: "ACTIVE"
  }).returning({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    adminLoginEnabled: users.adminLoginEnabled,
    status: users.status,
    phone: users.phone
  });
  if (!user) throw new AuthError("WECHAT_API_ERROR", "注册失败，请稍后重试");

  await tx.insert(userIdentities).values({
    userId: user.userId,
    type: "PHONE",
    identifier: input.phone,
    passwordHash: null,
    verifiedAt: new Date()
  });
  await tx.insert(userIdentities).values({
    userId: user.userId,
    type: WECHAT_MINI_IDENTITY_TYPE,
    identifier: input.openid,
    passwordHash: null,
    metadata: input.unionid ? { unionid: input.unionid } : null,
    verifiedAt: new Date()
  });
  await ensureClientAppAccess(tx, user.userId);
  return { ...user, passwordHash: null };
}

async function ensureWechatIdentity(tx: DbExecutor, userId: string, openid: string, unionid?: string) {
  const [existing] = await tx.select({
    id: userIdentities.id,
    userId: userIdentities.userId,
    metadata: userIdentities.metadata
  }).from(userIdentities).where(and(
    eq(userIdentities.type, WECHAT_MINI_IDENTITY_TYPE),
    eq(userIdentities.identifier, openid),
    isNull(userIdentities.deletedAt)
  )).limit(1);
  if (existing) {
    if (existing.userId !== userId) throw new AuthError("WECHAT_IDENTITY_CONFLICT");
    if (unionid && existing.metadata?.unionid !== unionid) {
      await tx.update(userIdentities).set({
        metadata: { ...existing.metadata, unionid },
        updatedAt: new Date()
      }).where(eq(userIdentities.id, existing.id));
    }
    return;
  }
  await tx.insert(userIdentities).values({
    userId,
    type: WECHAT_MINI_IDENTITY_TYPE,
    identifier: openid,
    passwordHash: null,
    metadata: unionid ? { unionid } : null,
    verifiedAt: new Date()
  });
}

async function ensurePhoneIdentity(tx: DbExecutor, userId: string, phone: string) {
  await tx.update(users).set({ phone, updatedAt: new Date() }).where(and(
    eq(users.id, userId),
    isNull(users.phone)
  ));
  const [existing] = await tx.select({ id: userIdentities.id, userId: userIdentities.userId }).from(userIdentities).where(and(
    eq(userIdentities.type, "PHONE"),
    eq(userIdentities.identifier, phone),
    isNull(userIdentities.deletedAt)
  )).limit(1);
  if (existing) {
    if (existing.userId !== userId) throw new AuthError("PHONE_IDENTITY_CONFLICT");
    return;
  }
  await tx.insert(userIdentities).values({
    userId,
    type: "PHONE",
    identifier: phone,
    passwordHash: null,
    verifiedAt: new Date()
  });
}

async function findAccountByIdentity(tx: DbExecutor, type: "PHONE" | "WECHAT_OPENID", identifier: string) {
  const [row] = await tx.select({ userId: users.id }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(
    eq(userIdentities.type, type),
    eq(userIdentities.identifier, identifier),
    isNull(userIdentities.deletedAt),
    isNull(users.deletedAt)
  )).limit(1);
  return row ? loadAccountById(tx, row.userId) : null;
}

async function findAccountByPhone(tx: DbExecutor, phone: string) {
  const byIdentity = await findAccountByIdentity(tx, "PHONE", phone);
  if (byIdentity) return byIdentity;
  const [row] = await tx.select({ userId: users.id }).from(users).where(and(
    eq(users.phone, phone),
    isNull(users.deletedAt)
  )).limit(1);
  return row ? loadAccountById(tx, row.userId) : null;
}

async function loadAccountById(tx: DbExecutor, userId: string): Promise<WechatPhoneAccount> {
  const [user] = await tx.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    adminLoginEnabled: users.adminLoginEnabled,
    status: users.status,
    phone: users.phone
  }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (!user) throw new AuthError("WECHAT_API_ERROR", "账号不存在");
  const [phoneIdentity] = await tx.select({ passwordHash: userIdentities.passwordHash }).from(userIdentities).where(and(
    eq(userIdentities.userId, userId),
    eq(userIdentities.type, "PHONE"),
    isNull(userIdentities.deletedAt)
  )).limit(1);
  return { ...user, passwordHash: phoneIdentity?.passwordHash ?? null };
}
