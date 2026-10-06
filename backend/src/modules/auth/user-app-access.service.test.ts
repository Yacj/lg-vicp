import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../shared/errors.js";
import { AUTH_ERROR_CODES } from "../../shared/auth-errors.js";
import {
  appCodeForClient,
  assertRouteAudience,
  buildAccessTokenClaims,
  decideLoginAccess,
  initialAccessForProvision,
  migrationAccessRowsForRole,
  resolvePayloadAudience,
  shouldAutoProvisionClient,
  tokenAudienceForClient
} from "./user-app-access.service.js";

describe("user_app_access 迁移与开通", () => {
  it("SUPER_ADMIN 只迁移 ADMIN access，不默认开 CLIENT", () => {
    expect(migrationAccessRowsForRole("SUPER_ADMIN")).toEqual([
      { app: "ADMIN", role: "SUPER_ADMIN" }
    ]);
    expect(initialAccessForProvision("ADMIN_CREATE")).toEqual([
      { app: "ADMIN", role: "SUPER_ADMIN" }
    ]);
  });

  it("历史 NORMAL_USER 迁移为 CLIENT / NORMAL_USER", () => {
    expect(migrationAccessRowsForRole("NORMAL_USER")).toEqual([
      { app: "CLIENT", role: "NORMAL_USER" }
    ]);
    expect(initialAccessForProvision("CLIENT_REGISTER")).toEqual([
      { app: "CLIENT", role: "NORMAL_USER" }
    ]);
  });

  it("历史 CHANNEL_USER 只开 CLIENT，不开 ADMIN", () => {
    expect(migrationAccessRowsForRole("CHANNEL_USER")).toEqual([
      { app: "CLIENT", role: "NORMAL_USER" }
    ]);
  });
});

describe("C 端登录自动补 CLIENT", () => {
  const adminAccess = { app: "ADMIN" as const, role: "SUPER_ADMIN" as const, status: "ACTIVE" as const };

  it("同手机号第一次微信进 C 端：已有 ADMIN 则自动补 CLIENT", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "C_APP",
      existing: null
    })).toEqual({ action: "AUTO_PROVISION_CLIENT" });
    expect(shouldAutoProvisionClient("C_APP")).toBe(true);
    expect(appCodeForClient("C_APP")).toBe("CLIENT");
    expect(adminAccess.app).toBe("ADMIN");
  });

  it("同手机号密码进 C 端：自动补 CLIENT", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "C_APP",
      existing: null
    }).action).toBe("AUTO_PROVISION_CLIENT");
  });

  it("同手机号短信进 C 端：自动补 CLIENT", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "PC_AI",
      existing: null
    }).action).toBe("AUTO_PROVISION_CLIENT");
    expect(shouldAutoProvisionClient("PC_AI")).toBe(true);
  });

  it("已有 CLIENT 不重复创建", () => {
    const existing = { app: "CLIENT" as const, role: "NORMAL_USER" as const, status: "ACTIVE" as const };
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "C_APP",
      existing
    })).toEqual({ action: "ALLOW", access: existing });
  });

  it("无部门 CLIENT 仍可登录", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "C_APP",
      existing: { app: "CLIENT", role: "NORMAL_USER", status: "ACTIVE" }
    }).action).toBe("ALLOW");
  });

  it("禁用用户两端都失效", () => {
    expect(decideLoginAccess({
      userStatus: "DISABLED",
      clientType: "B_ADMIN",
      existing: { app: "ADMIN", role: "SUPER_ADMIN", status: "ACTIVE" }
    })).toEqual({ action: "USER_DISABLED" });
    expect(decideLoginAccess({
      userStatus: "DISABLED",
      clientType: "C_APP",
      existing: { app: "CLIENT", role: "NORMAL_USER", status: "ACTIVE" }
    })).toEqual({ action: "USER_DISABLED" });
    expect(AUTH_ERROR_CODES.USER_DISABLED).toBe("USER_DISABLED");
  });

  it("按端禁用返回 APP_ACCESS_DISABLED", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "C_APP",
      existing: { app: "CLIENT", role: "NORMAL_USER", status: "DISABLED" }
    })).toEqual({ action: "APP_ACCESS_DISABLED" });
    expect(AUTH_ERROR_CODES.APP_ACCESS_DISABLED).toBe("APP_ACCESS_DISABLED");
  });

  it("B 端缺少 ADMIN access 时拒绝且不自动开通", () => {
    expect(decideLoginAccess({
      userStatus: "ACTIVE",
      clientType: "B_ADMIN",
      existing: null
    })).toEqual({ action: "DENY_ADMIN" });
    expect(shouldAutoProvisionClient("B_ADMIN")).toBe(false);
  });
});

describe("Token audience 强隔离", () => {
  it("B 端 Token 带 aud=admin 与 SUPER_ADMIN", () => {
    expect(buildAccessTokenClaims({
      userId: "user-a",
      clientType: "B_ADMIN",
      jti: "jti-1"
    })).toEqual({
      sub: "user-a",
      tokenType: "access",
      clientType: "B_ADMIN",
      aud: "admin",
      role: "SUPER_ADMIN",
      jti: "jti-1"
    });
    expect(tokenAudienceForClient("B_ADMIN")).toBe("admin");
  });

  it("C 端 Token 带 aud=client 与 NORMAL_USER", () => {
    expect(buildAccessTokenClaims({
      userId: "user-a",
      clientType: "C_APP",
      jti: "jti-2"
    })).toMatchObject({
      sub: "user-a",
      aud: "client",
      role: "NORMAL_USER",
      clientType: "C_APP"
    });
  });

  it("C 端 token 不能进 /platform", () => {
    expect(() => assertRouteAudience("/api/v1/platform/users", "client", "C_APP")).toThrow(ForbiddenError);
    expect(() => assertRouteAudience("/api/v1/workspace/home", "client", "PC_AI")).toThrow("当前登录端无权访问后台接口");
  });

  it("B 端 token 不能冒充 /client", () => {
    expect(() => assertRouteAudience("/api/v1/client/projects", "admin", "B_ADMIN")).toThrow("当前登录端无权访问客户端接口");
    expect(() => assertRouteAudience("/api/v1/platform/users", "admin", "B_ADMIN")).not.toThrow();
    expect(() => assertRouteAudience("/api/v1/client/knowledge/documents", "client", "C_APP")).not.toThrow();
  });

  it("aud 与 clientType 混用会被拒绝", () => {
    expect(() => resolvePayloadAudience("client", "B_ADMIN")).toThrow("令牌端不匹配，请重新登录");
    expect(() => resolvePayloadAudience("admin", "C_APP")).toThrow("令牌端不匹配，请重新登录");
    expect(resolvePayloadAudience(undefined, "C_APP")).toBe("client");
  });

  it("项目 / Conversation / Memory 继续归属同一 userId", () => {
    const adminToken = buildAccessTokenClaims({ userId: "same-user", clientType: "B_ADMIN", jti: "a" });
    const clientToken = buildAccessTokenClaims({ userId: "same-user", clientType: "C_APP", jti: "b" });
    expect(adminToken.sub).toBe(clientToken.sub);
  });
});
