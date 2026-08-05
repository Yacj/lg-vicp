import { randomInt, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import type { DbExecutor } from "../../db/client.js";
import { departments, loginLogs, refreshTokens, userDepartments, userIdentities, users } from "../../db/schema.js";
import { AUTH_CLIENTS, AUDIT_ACTIONS } from "../../shared/constants.js";
import type { AuthClient } from "../../shared/auth-user.js";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { canCreateProjectFromClient } from "../../shared/permissions.js";
import { BusinessError, ForbiddenError, ConflictError, NotFoundError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { hashRefreshToken, issueTokenPair, rotateRefreshToken, signAccessToken } from "./auth.service.js";
import { CAPTCHA_TTL_SECONDS, createCaptcha, hashCaptcha, verifyCaptcha } from "./captcha.service.js";
import { createSmsProvider } from "./sms.service.js";
import { createWechatAuthProvider } from "./wechat.service.js";
import { getMenuTree, getPermissionCodes, getRoleCodes, getRoleScopes } from "../menus/menu.service.js";

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
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确")
});
const clientSmsLoginBodySchema = clientSmsSendBodySchema.extend({
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
  status: "ACTIVE" | "DISABLED";
  passwordHash: string | null;
};
type LoginAccount = Pick<Account, "userId" | "displayName" | "role" | "channelType">;

function publicUser(account: Pick<Account, "userId" | "displayName" | "role" | "channelType">, clientType: AuthClient) {
  return {
    id: account.userId,
    displayName: account.displayName,
    role: account.role,
    channelType: account.channelType,
    clientType
  };
}

async function findAccount(app: FastifyInstance, identifier: string, type?: "USERNAME" | "PHONE") {
  const [account] = await app.db.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    status: users.status,
    passwordHash: userIdentities.passwordHash
  }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(
    eq(userIdentities.identifier, identifier),
    type ? eq(userIdentities.type, type) : undefined,
    isNotNull(userIdentities.passwordHash),
    isNull(users.deletedAt)
  )).limit(1);
  return account;
}

async function findPhoneUser(app: FastifyInstance, phone: string) {
  const [account] = await app.db.select({
    userId: users.id,
    displayName: users.displayName,
    role: users.role,
    channelType: users.channelType,
    status: users.status
  }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(
    eq(userIdentities.type, "PHONE"),
    eq(userIdentities.identifier, phone),
    isNull(users.deletedAt)
  )).limit(1);
  return account;
}

async function issueLogin(
  app: FastifyInstance,
  request: Parameters<typeof getCurrentUser>[0],
  account: LoginAccount,
  clientType: AuthClient,
  db: DbExecutor = app.db,
  action: "login" | "register" = "login"
) {
  const tokens = await issueTokenPair(app, request, account.userId, clientType, db);
  await db.insert(loginLogs).values({ userId: account.userId, identifier: account.displayName, clientType, result: "SUCCESS", action, ip: request.ip, userAgent: request.headers["user-agent"], message: action === "register" ? "注册成功" : "登录成功" });
  await writeAuditLog({
    db,
    request,
    actor: { id: account.userId, role: account.role, channelType: account.channelType, clientType },
    action: action === "register" ? AUDIT_ACTIONS.AUTH_REGISTER : AUDIT_ACTIONS.AUTH_LOGIN,
    targetType: "user",
    targetId: account.userId,
    afterJson: { clientType }
  });
  return { user: publicUser(account, clientType), ...tokens };
}

export async function authRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  app.addHook("onError", async (request) => {
    if (!request.url.startsWith("/api/v1/auth/")) return;
    const action = request.url.includes("captcha") ? "captcha" : request.url.includes("sms") ? "sms" : request.url.includes("refresh") ? "refresh" : request.url.includes("logout") ? "logout" : request.url.includes("register") ? "register" : "login";
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
    const loginIdentifier = request.body.identifier.trim().toLowerCase();
    const ipRateKey = `auth:b:login:ip:${request.ip}`;
    const accountRateKey = `auth:b:login:identifier:${loginIdentifier}`;
    const ipAttempts = await app.redis.incr(ipRateKey);
    const accountAttempts = await app.redis.incr(accountRateKey);
    if (ipAttempts === 1) await app.redis.expire(ipRateKey, 300);
    if (accountAttempts === 1) await app.redis.expire(accountRateKey, 300);
    if (ipAttempts > 30 || accountAttempts > 10) throw new TooManyRequestsError("登录尝试过于频繁，请稍后再试");
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
    const identifier = request.body.identifier.trim();
    const account = await findAccount(app, identifier);
    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, request.body.password))) {
      throw new BusinessError("用户名、手机号或密码错误");
    }
    if (account.status !== "ACTIVE") throw new BusinessError("账号已被禁用");
    if (account.role === "NORMAL_USER") throw new ForbiddenError("普通用户不能登录 B 端管理后台");
    return ok(request, await issueLogin(app, request, account, AUTH_CLIENTS.B_ADMIN));
  });

  route.post("/client/sms/send", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "发送客户端登录短信验证码", body: clientSmsSendBodySchema }
  }, async (request) => {
    const phoneKey = `auth:sms:send:phone:${request.body.clientType}:${request.body.phone}`;
    const ipKey = `auth:sms:send:ip:${request.ip}`;
    const phoneAttempts = await app.redis.incr(phoneKey);
    const ipAttempts = await app.redis.incr(ipKey);
    if (phoneAttempts === 1) await app.redis.expire(phoneKey, 60);
    if (ipAttempts === 1) await app.redis.expire(ipKey, 60);
    if (phoneAttempts > 5 || ipAttempts > 30) throw new TooManyRequestsError("短信验证码请求过于频繁，请稍后再试");
    const account = await findPhoneUser(app, request.body.phone);
    if (!account) throw new NotFoundError("手机号未注册，请联系管理员创建账号");
    if (account.status !== "ACTIVE") throw new BusinessError("账号已被禁用");
    const code = String(randomInt(100000, 1000000));
    await app.redis.set(`auth:sms:login:${request.body.clientType}:${request.body.phone}`, hashCaptcha(code), "EX", 300);
    try {
      await createSmsProvider(app.log, env.NODE_ENV).sendCode(request.body.phone, code);
    } catch {
      await app.redis.del(`auth:sms:login:${request.body.clientType}:${request.body.phone}`);
      throw new ServiceUnavailableError("短信服务暂不可用");
    }
    return ok(request, { message: "短信验证码已发送", expiresIn: 300 });
  });

  route.post("/client/login/sms", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端短信验证码登录", body: clientSmsLoginBodySchema }
  }, async (request) => {
    const key = `auth:sms:login:${request.body.clientType}:${request.body.phone}`;
    const stored = await app.redis.getdel(key);
    if (!stored || stored !== hashCaptcha(request.body.code)) throw new BusinessError("短信验证码错误或已过期");
    const account = await findPhoneUser(app, request.body.phone);
    if (!account) throw new NotFoundError("手机号未注册，请联系管理员创建账号");
    if (account.status !== "ACTIVE") throw new BusinessError("账号已被禁用");
    return ok(request, await issueLogin(app, request, account, request.body.clientType));
  });

  route.post("/client/register/password", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端手机号密码注册", body: clientRegisterBodySchema }
  }, async (request) => {
    const phone = request.body.phone.trim();
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
    const result = await app.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      if (existing) throw new ConflictError("手机号已注册，请直接登录");

      const [user] = await tx.insert(users).values({
        phone,
        displayName: `用户${phone.slice(-4)}`,
        role: "NORMAL_USER",
        channelType: null,
        status: "ACTIVE"
      }).returning({
        userId: users.id,
        displayName: users.displayName,
        role: users.role,
        channelType: users.channelType
      });
      if (!user) throw new ConflictError("注册失败，请稍后重试");

      await tx.insert(userIdentities).values({
        userId: user.userId,
        type: "PHONE",
        identifier: phone,
        passwordHash,
        verifiedAt: new Date()
      });
      return issueLogin(app, request, user, request.body.clientType, tx, "register");
    });

    return ok(request, { message: "注册成功", ...result });
  });

  route.post("/client/login/password", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端手机号密码登录", body: clientPasswordLoginBodySchema }
  }, async (request) => {
    const account = await findAccount(app, request.body.phone, "PHONE");
    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, request.body.password))) {
      throw new BusinessError("手机号或密码错误");
    }
    if (account.status !== "ACTIVE") throw new BusinessError("账号已被禁用");
    return ok(request, await issueLogin(app, request, account, request.body.clientType));
  });

  route.post("/client/login/wechat", {
    schema: { tags: ["C端 / 认证", "PC AI端 / 认证"], summary: "客户端微信登录", body: clientWechatLoginBodySchema }
  }, async (request) => {
    const provider = createWechatAuthProvider();
    if (!provider) throw new ForbiddenError("微信登录尚未配置");
    await provider.exchangeCode(request.body.code);
    throw new ForbiddenError("微信登录账号绑定尚未完成");
  });

  route.post("/login", {
    schema: {
      tags: ["共用 / 认证"],
      body: loginBodySchema
    }
  }, async (request) => {
    const identifier = request.body.identifier.trim();
    const account = await findAccount(app, identifier);

    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, request.body.password))) {
      throw new BusinessError("用户名、手机号或密码错误");
    }
    if (account.status !== "ACTIVE") {
      throw new BusinessError("账号已被禁用");
    }

    const clientType = account.role === "NORMAL_USER" ? AUTH_CLIENTS.C_APP : AUTH_CLIENTS.B_ADMIN;
    return ok(request, await issueLogin(app, request, account, clientType));
  });

  route.post("/refresh", {
    schema: { tags: ["共用 / 认证"], summary: "刷新访问令牌", body: refreshBodySchema }
  }, async (request) => ok(request, await rotateRefreshToken(app, request, request.body.refreshToken)));

  route.post("/logout", {
    schema: { tags: ["共用 / 认证"], summary: "退出登录", body: refreshBodySchema }
  }, async (request) => {
    const [stored] = await app.db.select({ userId: refreshTokens.userId, clientType: refreshTokens.clientType }).from(refreshTokens).where(and(
      eq(refreshTokens.tokenHash, hashRefreshToken(request.body.refreshToken)),
      isNull(refreshTokens.revokedAt)
    )).limit(1);
    await app.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(
      eq(refreshTokens.tokenHash, hashRefreshToken(request.body.refreshToken)), isNull(refreshTokens.revokedAt)
    ));
    if (stored) {
      const [user] = await app.db.select({ id: users.id, role: users.role, channelType: users.channelType })
        .from(users).where(eq(users.id, stored.userId)).limit(1);
      if (user) {
        await writeAuditLog({
          db: app.db, request, actor: { ...user, clientType: stored.clientType },
          action: AUDIT_ACTIONS.AUTH_LOGOUT, targetType: "user", targetId: user.id
        });
      }
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
    return ok(request, {
      user: { ...user, clientType: current.clientType },
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
    return ok(request, {
      user: { ...user, clientType: current.clientType },
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
