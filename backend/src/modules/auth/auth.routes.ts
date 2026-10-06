import { randomInt, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import type { DbExecutor } from "../../db/client.js";
import { departments, loginLogs, refreshTokens, userDepartments, userIdentities, users } from "../../db/schema.js";
import { AUTH_CLIENTS, AUDIT_ACTIONS, USER_ROLES } from "../../shared/constants.js";
import type { AuthClient } from "../../shared/auth-user.js";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { canCreateProjectFromClient } from "../../shared/permissions.js";
import { AuthError } from "../../shared/auth-errors.js";
import { BusinessError, ForbiddenError, ConflictError, NotFoundError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError } from "../../shared/errors.js";
import { asConflictError } from "../../shared/database-errors.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { hashRefreshToken, issueTokenPair, rotateRefreshToken, signAccessToken } from "./auth.service.js";
import {
  ensureClientAppAccess,
  listAppAccessForUser,
  requireAppAccessForLogin,
  serializeAppAccess,
  tokenAudienceForClient
} from "./user-app-access.service.js";
import { CAPTCHA_TTL_SECONDS, createCaptcha, hashCaptcha, verifyCaptcha } from "./captcha.service.js";
import { findClientPhoneAccount, inspectClientPasswordLogin, resetClientPassword, setClientPassword } from "./client-password.service.js";
import { createSmsProvider } from "./sms.service.js";
import { loginWithWechatPhone } from "./wechat-phone-login.service.js";
import { createWechatMiniProgramService } from "./wechat.service.js";
import { getMenuTree, getPermissionCodes, getRoleCodes, getRoleScopes } from "../menus/menu.service.js";
import { normalizeLoginIdentifier, normalizePhone } from "../../shared/login-identifier.js";

const loginBodySchema = z.object({
  identifier: z.string().trim().min(1, "请输入用户名或手机号"),
  password: z.string().min(1, "请输入密码")
});

const bLoginBodySchema = loginBodySchema.extend({
  captchaUuid: z.uuid("验证码标识格式不正确"),
  captchaCode: z.string().trim().min(4, "请输入验证码").max(8, "验证码格式不正确")
});
const clientTypeSchema = z.enum([AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI]);
const clientSmsSendBodySchema = z.object({
  clientType: clientTypeSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确"),
  purpose: z.enum(["LOGIN", "PASSWORD"]).default("LOGIN")
});
const clientSmsLoginBodySchema = z.object({
  clientType: clientTypeSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确"),
  code: z.string().trim().regex(/^\d{6}$/, "短信验证码格式不正确")
});
export const clientPasswordLoginBodySchema = z.object({
  clientType: clientTypeSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确"),
  password: z.string().min(1, "请输入密码")
});
export const clientRegisterBodySchema = z.object({
  clientType: clientTypeSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确"),
  password: z.string().min(5, "密码至少需要 5 个字符").max(128, "密码不能超过 128 个字符")
});
const clientWechatLoginBodySchema = z.object({
  clientType: clientTypeSchema,
  code: z.string().trim().min(1, "请输入微信登录凭证")
});
export const clientWechatPhoneLoginBodySchema = z.object({
  loginCode: z.string().trim().min(1, "请提供微信登录凭证"),
  phoneCode: z.string().trim().min(1, "请提供微信手机号授权凭证")
});
export const clientPasswordSmsBodySchema = z.object({
  clientType: clientTypeSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确"),
  code: z.string().trim().regex(/^\d{6}$/, "短信验证码格式不正确"),
  password: z.string().min(5, "密码至少需要 5 个字符").max(128, "密码不能超过 128 个字符")
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(32, "刷新令牌格式不正确")
});

const devTokenBodySchema = z.object({
  userId: z.uuid("用户 ID 格式不正确")
});

type Account = {
  userId: string;
  displayName: string;
  role: "SUPER_ADMIN" | "CHANNEL_USER" | "NORMAL_USER";
  channelType: "DEALER" | "SALESPERSON" | null;
  adminLoginEnabled: boolean;
  status: "ACTIVE" | "DISABLED";
  passwordHash: string | null;
};
type LoginAccount = Pick<Account, "userId" | "displayName" | "role" | "channelType" | "adminLoginEnabled">;

function publicUser(
  account: Pick<Account, "userId" | "displayName" | "role" | "channelType" | "adminLoginEnabled">,
  clientType: AuthClient,
  accessRole: "SUPER_ADMIN" | "NORMAL_USER",
  appAccess: ReturnType<typeof serializeAppAccess> = []
) {
  return {
    id: account.userId,
    displayName: account.displayName,
    role: accessRole,
    channelType: accessRole === USER_ROLES.NORMAL_USER ? null : account.channelType,
    adminLoginEnabled: accessRole === USER_ROLES.SUPER_ADMIN && account.adminLoginEnabled,
    clientType,
    audience: tokenAudienceForClient(clientType),
    appAccess
  };
}

async function enforcePasswordLoginRateLimit(
  app: FastifyInstance,
  request: Parameters<typeof getCurrentUser>[0],
  namespace: string,
  identifier: string,
  clientType?: AuthClient,
): Promise<void> {
  const normalized = normalizeLoginIdentifier(identifier);
  const clientPart = clientType ? `:${clientType}` : "";
  const ipKey = `auth:${namespace}:login:ip${clientPart}:${request.ip}`;
  const accountKey = `auth:${namespace}:login:identifier${clientPart}:${normalized}`;
  const [ipAttempts, accountAttempts] = await Promise.all([
    app.redis.incr(ipKey),
    app.redis.incr(accountKey)
  ]);
  if (ipAttempts === 1) await app.redis.expire(ipKey, 300);
  if (accountAttempts === 1) await app.redis.expire(accountKey, 300);
  if (ipAttempts > 30 || accountAttempts > 10) {
    throw new TooManyRequestsError("登录尝试过于频繁，请稍后再试");
  }
}

function smsCodeKey(purpose: "LOGIN" | "PASSWORD", clientType: AuthClient, phone: string) {
  const scope = purpose === "PASSWORD" ? "password" : "login";
  return `auth:sms:${scope}:${clientType}:${phone}`;
}

async function consumePasswordSmsCode(app: FastifyInstance, clientType: AuthClient, phone: string, code: string) {
  const key = smsCodeKey("PASSWORD", clientType, phone);
  const stored = await app.redis.getdel(key);
  if (!stored || stored !== hashCaptcha(code)) {
    throw new BusinessError("短信验证码错误或已过期");
  }
}

async function findAccount(app: FastifyInstance, identifier: string, type?: "USERNAME" | "PHONE") {
  const [account] = await app.db.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    adminLoginEnabled: users.adminLoginEnabled,
    status: users.status,
    passwordHash: userIdentities.passwordHash
  }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(
    eq(userIdentities.identifier, identifier),
    type ? eq(userIdentities.type, type) : undefined,
    isNotNull(userIdentities.passwordHash),
    isNull(userIdentities.deletedAt),
    isNull(users.deletedAt)
  )).limit(1);
  return account;
}

async function issueLogin(
  app: FastifyInstance,
  request: Parameters<typeof getCurrentUser>[0],
  account: LoginAccount & { status?: "ACTIVE" | "DISABLED" },
  clientType: AuthClient,
  db: DbExecutor = app.db,
  action: "login" | "register" = "login",
  extras: Record<string, unknown> = {}
) {
  const access = await requireAppAccessForLogin(db, {
    userId: account.userId,
    userStatus: account.status ?? "ACTIVE",
    clientType
  });
  const accessRole = access.role;
  const tokens = await issueTokenPair(app, request, account.userId, clientType, db, accessRole);
  await db.insert(loginLogs).values({ userId: account.userId, identifier: account.displayName, clientType, result: "SUCCESS", action, ip: request.ip, userAgent: request.headers["user-agent"], message: action === "register" ? "注册成功" : "登录成功" });
  const actor = {
    id: account.userId,
    role: accessRole,
    channelType: accessRole === USER_ROLES.NORMAL_USER ? null : account.channelType,
    adminLoginEnabled: accessRole === USER_ROLES.SUPER_ADMIN && account.adminLoginEnabled,
    clientType
  };
  await writeAuditLog({
    db,
    request,
    actor,
    action: action === "register" ? AUDIT_ACTIONS.AUTH_REGISTER : AUDIT_ACTIONS.AUTH_LOGIN,
    targetType: "user",
    targetId: account.userId,
    afterJson: { clientType, accessRole, accountRole: account.role, app: access.app, ...extras }
  });
  if (access.created) {
    await writeAuditLog({
      db,
      request,
      actor,
      action: AUDIT_ACTIONS.AUTH_C_ACCESS_OPENED,
      targetType: "user",
      targetId: account.userId,
      afterJson: { clientType, accountRole: account.role, accessRole, app: access.app }
    });
  }
  const appAccess = serializeAppAccess(await listAppAccessForUser(db, account.userId));
  return { user: publicUser(account, clientType, accessRole, appAccess), ...tokens };
}

async function registerClientUser(
  app: FastifyInstance,
  request: Parameters<typeof getCurrentUser>[0] & { body: z.infer<typeof clientRegisterBodySchema> }
) {
  const phone = normalizePhone(request.body.phone);
  const ipKey = `auth:register:ip:${request.ip}`;
  const phoneKey = `auth:register:phone:${phone}`;
  const ipAttempts = await app.redis.incr(ipKey);
  const phoneAttempts = await app.redis.incr(phoneKey);
  if (ipAttempts === 1) await app.redis.expire(ipKey, 300);
  if (phoneAttempts === 1) await app.redis.expire(phoneKey, 300);
  if (ipAttempts > 30 || phoneAttempts > 5) {
    throw new TooManyRequestsError("注册请求过于频繁，请稍后再试");
  }

  const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id });
  try {
    const result = await app.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(and(eq(users.phone, phone), isNull(users.deletedAt))).limit(1);
      if (existing) throw new ConflictError("手机号已注册，请直接登录");

      const [user] = await tx.insert(users).values({
        phone,
        displayName: `用户${phone.slice(-4)}`,
        role: "NORMAL_USER",
        channelType: null,
        adminLoginEnabled: false,
        status: "ACTIVE"
      }).returning({
        userId: users.id,
        displayName: users.displayName,
        role: users.role,
        channelType: users.channelType,
        adminLoginEnabled: users.adminLoginEnabled
      });
      if (!user) throw new ConflictError("注册失败，请稍后重试");

      await tx.insert(userIdentities).values({
        userId: user.userId,
        type: "PHONE",
        identifier: phone,
        passwordHash,
        verifiedAt: new Date()
      });
      await ensureClientAppAccess(tx, user.userId);
      return issueLogin(app, request, { ...user, status: "ACTIVE" }, request.body.clientType, tx, "register");
    });
    return { message: "注册成功", ...result };
  } catch (error) {
    const conflict = asConflictError(error, "手机号已注册，请直接登录");
    if (conflict) throw conflict;
    throw error;
  }
}

export async function authRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  app.addHook("onError", async (request) => {
    if (!request.url.startsWith("/api/v1/auth/")) return;
    const action = request.url.includes("captcha") ? "captcha"
      : request.url.includes("sms") ? "sms"
      : request.url.includes("refresh") ? "refresh"
      : request.url.includes("logout") ? "logout"
      : request.url.includes("register") ? "register"
      : request.url.includes("password") ? "password"
      : request.url.includes("wechat") ? "wechat_phone"
      : "login";
    try {
      const body = request.body as Record<string, unknown> | null | undefined;
      const identifier = body && ("identifier" in body || "phone" in body)
        ? String(body.identifier ?? body.phone)
        : undefined;
      await app.db.insert(loginLogs).values({ identifier, result: "FAILED", action, ip: request.ip, userAgent: request.headers["user-agent"], message: "认证请求失败" });
    } catch {
      // 日志写入失败不能覆盖原始认证错误。
    }
  });

  route.get("/b/captchaImage", {
    schema: { tags: ["B端 / 认证"], summary: "生成 B 端登录验证码" }
  }, async (request) => {
    const ipKey = `auth:captcha:ip:${request.ip}`;
    const attempts = await app.redis.incr(ipKey);
    if (attempts === 1) await app.redis.expire(ipKey, 60);
    if (attempts > 30) throw new TooManyRequestsError("验证码请求过于频繁，请稍后再试");
    const captcha = createCaptcha();
    const uuid = randomUUID();
    await app.redis.set(`auth:captcha:${uuid}`, hashCaptcha(captcha.code), "EX", CAPTCHA_TTL_SECONDS);
    return ok(request, {
      captchaEnabled: true,
      uuid,
      image: captcha.image,
      img: captcha.image,
      expiresIn: CAPTCHA_TTL_SECONDS
    });
  });

  route.post("/b/login", {
    schema: { tags: ["B端 / 认证"], summary: "B 端账号密码登录", body: bLoginBodySchema }
  }, async (request) => {
    const identifier = normalizeLoginIdentifier(request.body.identifier);
    await enforcePasswordLoginRateLimit(app, request, "b", identifier);
    const captchaKey = `auth:captcha:${request.body.captchaUuid}`;
    const verifyKey = `auth:captcha:attempts:${request.body.captchaUuid}`;
    const validCaptcha = await verifyCaptcha(app.redis, captchaKey, request.body.captchaCode);
    if (!validCaptcha) {
      const attempts = await app.redis.incr(verifyKey);
      if (attempts === 1) await app.redis.expire(verifyKey, CAPTCHA_TTL_SECONDS);
      if (attempts >= 5) await app.redis.del(captchaKey, verifyKey);
      throw new BusinessError("验证码错误或已过期");
    }
    await app.redis.del(captchaKey, verifyKey);
    const account = await findAccount(app, identifier);
    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, request.body.password))) {
      throw new BusinessError("用户名、手机号或密码错误");
    }
    if (account.status !== "ACTIVE") throw new AuthError("USER_DISABLED");
    return ok(request, await issueLogin(app, request, account, AUTH_CLIENTS.B_ADMIN));
  });

  route.post("/client/sms/send", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "发送客户端登录或密码短信验证码", body: clientSmsSendBodySchema }
  }, async (request) => {
    const phone = normalizePhone(request.body.phone);
    const purpose = request.body.purpose;
    const phoneKey = `auth:sms:send:phone:${purpose}:${request.body.clientType}:${phone}`;
    const ipKey = `auth:sms:send:ip:${request.ip}`;
    const phoneAttempts = await app.redis.incr(phoneKey);
    const ipAttempts = await app.redis.incr(ipKey);
    if (phoneAttempts === 1) await app.redis.expire(phoneKey, 60);
    if (ipAttempts === 1) await app.redis.expire(ipKey, 60);
    if (phoneAttempts > 5 || ipAttempts > 30) throw new TooManyRequestsError("短信验证码请求过于频繁，请稍后再试");
    const account = await findClientPhoneAccount(app.db, phone);
    if (!account) throw new NotFoundError("手机号未注册，请先注册");
    if (account.status !== "ACTIVE") throw new AuthError("USER_DISABLED");
    const code = String(randomInt(100000, 1000000));
    const redisKey = smsCodeKey(purpose, request.body.clientType, phone);
    await app.redis.set(redisKey, hashCaptcha(code), "EX", 300);
    try {
      await createSmsProvider(app.log, env.NODE_ENV).sendCode(phone, code);
    } catch {
      await app.redis.del(redisKey);
      throw new ServiceUnavailableError("短信服务暂不可用");
    }
    return ok(request, { message: "短信验证码已发送", expiresIn: 300 });
  });

  route.post("/client/login/sms", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端短信验证码登录", body: clientSmsLoginBodySchema }
  }, async (request) => {
    const phone = normalizePhone(request.body.phone);
    const key = smsCodeKey("LOGIN", request.body.clientType, phone);
    const stored = await app.redis.getdel(key);
    if (!stored || stored !== hashCaptcha(request.body.code)) throw new BusinessError("短信验证码错误或已过期");
    const account = await findClientPhoneAccount(app.db, phone);
    if (!account) throw new NotFoundError("手机号未注册，请先注册");
    if (account.status !== "ACTIVE") throw new AuthError("USER_DISABLED");
    return ok(request, await issueLogin(app, request, account, request.body.clientType));
  });

  route.post("/client/register/password", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端手机号密码注册", body: clientRegisterBodySchema }
  }, async (request) => ok(request, await registerClientUser(app, request)));

  route.post("/register", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "C 端手机号密码注册", body: clientRegisterBodySchema }
  }, async (request) => ok(request, await registerClientUser(app, request)));

  route.post("/client/login/password", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端手机号密码登录", body: clientPasswordLoginBodySchema }
  }, async (request) => {
    await enforcePasswordLoginRateLimit(app, request, "client", request.body.phone, request.body.clientType);
    const account = await findClientPhoneAccount(app.db, request.body.phone);
    const inspection = inspectClientPasswordLogin(account);
    if (!inspection.ok) {
      if (inspection.error === "USER_DISABLED") throw new AuthError("USER_DISABLED");
      if (inspection.error === "PASSWORD_NOT_SET") throw new AuthError("PASSWORD_NOT_SET");
      throw new BusinessError("手机号或密码错误");
    }
    if (!(await argon2.verify(inspection.passwordHash, request.body.password))) {
      throw new BusinessError("手机号或密码错误");
    }
    return ok(request, await issueLogin(app, request, inspection.account, request.body.clientType));
  });

  route.post("/client/login/wechat", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端微信登录（请改用微信手机号快捷登录）", body: clientWechatLoginBodySchema }
  }, async () => {
    throw new ForbiddenError("请使用微信手机号快捷登录");
  });

  route.post("/client/wechat-phone-login", {
    schema: { tags: ["C端 / 认证"], summary: "微信手机号快捷登录（首次自动注册）", body: clientWechatPhoneLoginBodySchema }
  }, async (request) => {
    const wechat = createWechatMiniProgramService(app.redis, { logger: request.log });
    if (!wechat) throw new AuthError("WECHAT_API_ERROR", "微信登录尚未配置");
    await enforcePasswordLoginRateLimit(app, request, "wechat-phone", request.ip, AUTH_CLIENTS.C_APP);

    const session = await wechat.code2Session(request.body.loginCode);
    const phoneInfo = await wechat.getPhoneNumber(request.body.phoneCode);
    const phone = normalizePhone(phoneInfo.purePhoneNumber);
    let outcome;
    try {
      outcome = await loginWithWechatPhone(app.db, {
        openid: session.openid,
        unionid: session.unionid,
        phone
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (asConflictError(error)) throw new AuthError("PHONE_IDENTITY_CONFLICT");
      throw error;
    }

    if (outcome.account.status !== "ACTIVE") throw new AuthError("USER_DISABLED");
    request.log.info({
      event: "wechat_phone_login",
      userId: outcome.account.userId,
      method: "WECHAT_PHONE",
      isFirstLogin: outcome.isFirstLogin,
      phoneMerged: outcome.phoneMerged,
      wechatBound: outcome.wechatBound,
      phoneMismatch: outcome.phoneMismatch
    }, "微信手机号登录成功");
    const issued = await issueLogin(
      app,
      request,
      outcome.account,
      AUTH_CLIENTS.C_APP,
      app.db,
      outcome.isFirstLogin ? "register" : "login",
      {
        method: "WECHAT_PHONE",
        isFirstLogin: outcome.isFirstLogin,
        phoneMerged: outcome.phoneMerged,
        wechatBound: outcome.wechatBound,
        phoneMismatch: outcome.phoneMismatch
      }
    );
    return ok(request, {
      ...issued,
      isFirstLogin: outcome.isFirstLogin,
      passwordSet: outcome.passwordSet,
      phoneMismatch: outcome.phoneMismatch
    });
  });

  route.post("/client/password/set", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "短信验证后设置登录密码", body: clientPasswordSmsBodySchema }
  }, async (request) => {
    const phone = normalizePhone(request.body.phone);
    await consumePasswordSmsCode(app, request.body.clientType, phone, request.body.code);
    const account = await app.db.transaction(async (tx) => {
      const user = await setClientPassword(tx, phone, request.body.password);
      await writeAuditLog({
        db: tx,
        request,
        actor: { id: user.userId, role: user.role, channelType: user.channelType, adminLoginEnabled: user.adminLoginEnabled, clientType: request.body.clientType },
        action: AUDIT_ACTIONS.AUTH_PASSWORD_SET,
        targetType: "user",
        targetId: user.userId,
        afterJson: { clientType: request.body.clientType }
      });
      return user;
    });
    return ok(request, { message: "密码设置成功", passwordSet: true, userId: account.userId });
  });

  route.post("/client/password/reset", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "短信验证后重置登录密码", body: clientPasswordSmsBodySchema }
  }, async (request) => {
    const phone = normalizePhone(request.body.phone);
    await consumePasswordSmsCode(app, request.body.clientType, phone, request.body.code);
    const account = await app.db.transaction(async (tx) => {
      const user = await resetClientPassword(tx, phone, request.body.password);
      await writeAuditLog({
        db: tx,
        request,
        actor: { id: user.userId, role: user.role, channelType: user.channelType, adminLoginEnabled: user.adminLoginEnabled, clientType: request.body.clientType },
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
        targetType: "user",
        targetId: user.userId,
        afterJson: { clientType: request.body.clientType }
      });
      return user;
    });
    return ok(request, { message: "密码重置成功", passwordSet: true, userId: account.userId });
  });

  route.post("/login", {
    schema: {
      tags: ["共用 / 认证"],
      body: loginBodySchema
    }
  }, async (request) => {
    const identifier = normalizeLoginIdentifier(request.body.identifier);
    await enforcePasswordLoginRateLimit(app, request, "common", identifier);
    const account = await findAccount(app, identifier);

    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, request.body.password))) {
      throw new BusinessError("用户名、手机号或密码错误");
    }
    if (account.status !== "ACTIVE") {
      throw new BusinessError("账号已被禁用");
    }

    const clientType = account.role === USER_ROLES.SUPER_ADMIN ? AUTH_CLIENTS.B_ADMIN : AUTH_CLIENTS.C_APP;
    return ok(request, await issueLogin(app, request, account, clientType));
  });

  route.post("/refresh", {
    schema: { tags: ["共用 / 认证"], summary: "刷新访问令牌", body: refreshBodySchema }
  }, async (request) => ok(request, await rotateRefreshToken(app, request, request.body.refreshToken)));

  route.post("/logout", {
    schema: { tags: ["共用 / 认证"], summary: "退出登录", body: refreshBodySchema }
  }, async (request) => {
    const tokenHash = hashRefreshToken(request.body.refreshToken);
    let stored: { userId: string; clientType: AuthClient; accessJti: string | null; expiresAt: Date } | undefined;
    let revoked = false;
    await app.db.transaction(async (tx) => {
      const [row] = await tx.select({
        userId: refreshTokens.userId,
        clientType: refreshTokens.clientType,
        accessJti: refreshTokens.accessJti,
        expiresAt: refreshTokens.expiresAt
      }).from(refreshTokens).where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt))).limit(1);
      if (!row) return;
      stored = row;
      const [updated] = await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt))).returning({ id: refreshTokens.id });
      revoked = Boolean(updated);
      if (!revoked) return;
      const [user] = await tx.select({ id: users.id, role: users.role, channelType: users.channelType, adminLoginEnabled: users.adminLoginEnabled })
        .from(users).where(eq(users.id, row.userId)).limit(1);
      if (user) {
        await writeAuditLog({
          db: tx, request, actor: { ...user, clientType: row.clientType },
          action: AUDIT_ACTIONS.AUTH_LOGOUT, targetType: "user", targetId: user.id,
          afterJson: { refreshTokenRevoked: true }
        });
      }
    });
    if (stored && revoked && stored.accessJti) {
      const ttl = Math.max(1, Math.ceil((stored.expiresAt.getTime() - Date.now()) / 1000));
      await app.redis.set(`auth:access:blacklist:${stored.accessJti}`, "1", "EX", ttl);
    }
    return ok(request, { message: "已安全退出登录" });
  });

  if (env.NODE_ENV !== "production") {
    route.post("/dev-token", {
      schema: { tags: ["B端 / 认证"], summary: "生成开发环境访问令牌", body: devTokenBodySchema }
    }, async (request) => {
      const [user] = await app.db.select({ id: users.id }).from(users).where(eq(users.id, request.body.userId)).limit(1);
      if (!user) {
        throw new UnauthorizedError("开发令牌对应的用户不存在");
      }
      return ok(request, { token: signAccessToken(app, user.id, AUTH_CLIENTS.B_ADMIN), clientType: AUTH_CLIENTS.B_ADMIN });
    });
  }

  route.get("/b/getInfo", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["B端 / 认证"], summary: "获取 B 端当前用户信息" }
  }, async (request) => {
    const current = getCurrentUser(request);
    const [user] = await app.db.select({
      id: users.id,
      displayName: users.displayName,
      phone: users.phone,
      email: users.email,
      role: users.role,
      channelType: users.channelType,
      adminLoginEnabled: users.adminLoginEnabled,
      status: users.status
    }).from(users).where(eq(users.id, current.id)).limit(1);
    if (!user) throw new UnauthorizedError("用户不存在或已被禁用");
    const permissionCodes = await getPermissionCodes(app, current);
    const departmentRows = await app.db.select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
      isPrimary: userDepartments.isPrimary
    }).from(userDepartments).innerJoin(departments, eq(departments.id, userDepartments.departmentId))
      .where(eq(userDepartments.userId, current.id));
    const appAccess = serializeAppAccess(await listAppAccessForUser(app.db, current.id));
    return ok(request, {
      user: { ...user, clientType: current.clientType, audience: current.audience, appAccess },
      departments: departmentRows,
      permissions: [...permissionCodes],
      roles: await getRoleCodes(app, current),
      dataScopes: await getRoleScopes(app, current)
    });
  });

  route.get("/b/getRouters", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["B端 / 认证"], summary: "获取 B 端动态路由" }
  }, async (request) => {
    const current = getCurrentUser(request);
    const permissionCodes = await getPermissionCodes(app, current);
    return ok(request, { routers: await getMenuTree(app, current), permissions: [...permissionCodes] });
  });

  route.get("/client/getInfo", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI)],
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "获取客户端当前用户信息" }
  }, async (request) => {
    const current = getCurrentUser(request);
    const [user] = await app.db.select({
      id: users.id,
      displayName: users.displayName,
      phone: users.phone,
      email: users.email,
      role: users.role,
      channelType: users.channelType,
      status: users.status
    }).from(users).where(eq(users.id, current.id)).limit(1);
    if (!user) throw new UnauthorizedError("用户不存在或已被禁用");
    const appAccess = serializeAppAccess(await listAppAccessForUser(app.db, current.id));
    return ok(request, {
      user: {
        ...user,
        role: current.role,
        channelType: current.channelType,
        clientType: current.clientType,
        audience: current.audience,
        appAccess
      },
      capabilities: {
        canCreateProject: canCreateProjectFromClient(current),
        canUseAi: true,
        canGenerateReport: canCreateProjectFromClient(current),
        canViewPublicProject: true
      }
    });
  });

  route.get("/me", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 认证"], summary: "获取当前登录用户" }
  }, async (request) => ok(request, { user: getCurrentUser(request) }));
}
