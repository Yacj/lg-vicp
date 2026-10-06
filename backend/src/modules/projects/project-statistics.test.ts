import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AuthUser } from "../../shared/auth-user.js";
import { USER_ROLES } from "../../shared/constants.js";
import { getVisibleProjectStatistics, platformProjectScopeWhere, platformProjectSelect } from "./project.service.js";

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
      db: makeCountDb([12, 5, 7, 3]),
      user: superAdmin
    })).resolves.toEqual({ total: 12, public: 5, private: 7, department: 3 });
  });

  it("空统计结果返回零值", async () => {
    await expect(getVisibleProjectStatistics({
      db: makeCountDb([]),
      user: superAdmin
    })).resolves.toEqual({ total: 0, public: 0, private: 0, department: 0 });
  });
});

describe("平台项目列表 SQL", () => {
  it("JOIN 使用部门子查询本身，不引用 SELECT 别名", async () => {
    const client = postgres("postgres://127.0.0.1:9/none", { max: 1 });
    try {
      const sql = platformProjectSelect(drizzle(client)).toSQL();
      const text = sql.sql.toLowerCase();
      expect(text).toContain("left join");
      expect(text).toContain("select ud.department_id");
      expect(text).not.toMatch(/left join ["']?departments["']? on ["']?departments["']?\.\w+ = ["']?owner_department_id["']?/);
    } finally {
      await client.end({ timeout: 0 });
    }
  });
});
