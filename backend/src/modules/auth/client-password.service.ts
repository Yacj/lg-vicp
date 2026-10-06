import * as argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { userIdentities, users } from "../../db/schema.js";
import { AuthError } from "../../shared/auth-errors.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { normalizePhone } from "../../shared/login-identifier.js";

export type ClientPhoneAccount = {
  userId: string;
  displayName: string;
  role: "SUPER_ADMIN" | "CHANNEL_USER" | "NORMAL_USER";
  channelType: "DEALER" | "SALESPERSON" | null;
  adminLoginEnabled: boolean;
  status: "ACTIVE" | "DISABLED";
  phone: string | null;
  passwordHash: string | null;
};

export type ClientPasswordLoginInspection =
  | { ok: true; account: ClientPhoneAccount; passwordHash: string }
  | { ok: false; error: "NOT_FOUND" | "USER_DISABLED" | "PASSWORD_NOT_SET" };

export function inspectClientPasswordLogin(account: ClientPhoneAccount | null): ClientPasswordLoginInspection {
  if (!account) return { ok: false, error: "NOT_FOUND" };
  if (account.status !== "ACTIVE") return { ok: false, error: "USER_DISABLED" };
  if (!account.passwordHash) return { ok: false, error: "PASSWORD_NOT_SET" };
  return { ok: true, account, passwordHash: account.passwordHash };
}

export async function findClientPhoneAccount(db: DbExecutor, phone: string): Promise<ClientPhoneAccount | null> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    adminLoginEnabled: users.adminLoginEnabled,
    status: users.status,
    phone: users.phone
  }).from(users).where(and(eq(users.phone, normalized), isNull(users.deletedAt))).limit(1);
  if (!user) {
    const [identity] = await db.select({ userId: userIdentities.userId }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(
      eq(userIdentities.type, "PHONE"),
      eq(userIdentities.identifier, normalized),
      isNull(userIdentities.deletedAt),
      isNull(users.deletedAt)
    )).limit(1);
    if (!identity) return null;
    return loadClientPhoneAccount(db, identity.userId);
  }
  return loadClientPhoneAccount(db, user.userId);
}

export async function setClientPassword(db: DbExecutor, phone: string, password: string) {
  const account = await requireActivePhoneAccount(db, phone);
  const identity = await requirePhoneIdentity(db, account.userId, phone);
  if (identity.passwordHash) throw new ConflictError("密码已设置，如需修改请使用重置密码");
  await writePhonePassword(db, identity.id, password);
  return account;
}

export async function resetClientPassword(db: DbExecutor, phone: string, password: string) {
  const account = await requireActivePhoneAccount(db, phone);
  const identity = await requirePhoneIdentity(db, account.userId, phone);
  if (!identity.passwordHash) throw new AuthError("PASSWORD_NOT_SET");
  await writePhonePassword(db, identity.id, password);
  return account;
}

async function requireActivePhoneAccount(db: DbExecutor, phone: string) {
  const account = await findClientPhoneAccount(db, phone);
  if (!account) throw new NotFoundError("手机号未注册");
  if (account.status !== "ACTIVE") throw new AuthError("USER_DISABLED");
  return account;
}

async function requirePhoneIdentity(db: DbExecutor, userId: string, phone: string) {
  const normalized = normalizePhone(phone);
  const [identity] = await db.select({
    id: userIdentities.id,
    passwordHash: userIdentities.passwordHash
  }).from(userIdentities).where(and(
    eq(userIdentities.userId, userId),
    eq(userIdentities.type, "PHONE"),
    eq(userIdentities.identifier, normalized),
    isNull(userIdentities.deletedAt)
  )).limit(1);
  if (identity) return identity;
  const [inserted] = await db.insert(userIdentities).values({
    userId,
    type: "PHONE",
    identifier: normalized,
    passwordHash: null,
    verifiedAt: new Date()
  }).returning({ id: userIdentities.id, passwordHash: userIdentities.passwordHash });
  if (!inserted) throw new NotFoundError("用户登录身份不存在");
  return inserted;
}

async function writePhonePassword(db: DbExecutor, identityId: string, password: string) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await db.update(userIdentities).set({
    passwordHash,
    verifiedAt: new Date(),
    updatedAt: new Date()
  }).where(eq(userIdentities.id, identityId));
}

async function loadClientPhoneAccount(db: DbExecutor, userId: string): Promise<ClientPhoneAccount> {
  const [user] = await db.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    adminLoginEnabled: users.adminLoginEnabled,
    status: users.status,
    phone: users.phone
  }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (!user) throw new NotFoundError("手机号未注册");
  const [phoneIdentity] = await db.select({ passwordHash: userIdentities.passwordHash }).from(userIdentities).where(and(
    eq(userIdentities.userId, userId),
    eq(userIdentities.type, "PHONE"),
    isNull(userIdentities.deletedAt)
  )).limit(1);
  return { ...user, passwordHash: phoneIdentity?.passwordHash ?? null };
}
