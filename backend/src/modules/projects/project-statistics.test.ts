import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth-user.js";
import { USER_ROLES } from "../../shared/constants.js";
import { getVisibleProjectStatistics, platformProjectScopeWhere } from "./project.service.js";

const superAdmin: Pick<AuthUser, "id" | "role"> = {
  id: "admin-1",
  role: USER_ROLES.SUPER_ADMIN
};

const channelUser: Pick<AuthUser, "id" | "role"> = {
  id: "channel-1",
  role: USER_ROLES.CHANNEL_USER
};

const normalUser: Pick<AuthUser, "id" | "role"> = {
  id: "normal-1",
  role: USER_ROLES.NORMAL_USER
};

function makeCountDb(rows: number[]) {
  let index = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          const value = rows[index++];
          return value === undefined ? [] : [{ value }];
        }
      })
    })
  };
  return db as any;
}

describe("平台项目可见范围", () => {
  it("超级管理员不附加范围过滤", () => {
    expect(platformProjectScopeWhere(superAdmin)).toBeUndefined();
  });

  it("渠道账号和普通账号都有可见范围，不依赖按钮权限码", () => {
    expect(platformProjectScopeWhere(channelUser)).toBeDefined();
    expect(platformProjectScopeWhere(normalUser)).toBeDefined();
  });
});

describe("可见项目统计", () => {
  it("映射总数、公开和私有计数", async () => {
    await expect(getVisibleProjectStatistics({
      db: makeCountDb([12, 5, 7]),
      user: channelUser
    })).resolves.toEqual({ total: 12, public: 5, private: 7 });
  });

  it("空统计结果返回零值", async () => {
    await expect(getVisibleProjectStatistics({
      db: makeCountDb([]),
      user: channelUser
    })).resolves.toEqual({ total: 0, public: 0, private: 0 });
  });
});
