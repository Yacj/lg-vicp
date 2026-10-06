import { describe, expect, it } from "vitest";
import { getClientProfileSummary, listClientSelectableDepartments } from "./client-profile.service.js";

function makeCountDb(rows: number[]) {
  let index = 0;
  const conditions: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async (condition: unknown) => {
          conditions.push(condition);
          const value = rows[index++];
          return value === undefined ? [] : [{ value }];
        }
      })
    })
  };

  return { db: db as any, conditions };
}

describe("C 端个人中心统计", () => {
  it("映射当前用户项目、公开项目和 C_APP 会话数量", async () => {
    const { db, conditions } = makeCountDb([12, 5, 8]);

    await expect(getClientProfileSummary({ db, userId: "user-1" })).resolves.toEqual({
      projects: { total: 12, public: 5 },
      conversations: { total: 8 }
    });
    expect(conditions).toHaveLength(3);
  });

  it("空统计结果返回零值", async () => {
    const { db } = makeCountDb([]);

    await expect(getClientProfileSummary({ db, userId: "user-2" })).resolves.toEqual({
      projects: { total: 0, public: 0 },
      conversations: { total: 0 }
    });
  });
});

describe("C 端可选部门", () => {
  it("无部门时返回空列表", async () => {
    await expect(listClientSelectableDepartments({
      db: {} as never,
      user: { departmentIds: [] }
    })).resolves.toEqual([]);
  });

  it("只返回本人所属部门，并带路径与是否有下级", async () => {
    const rows = [
      { id: "root", parentId: null, name: "集团" },
      { id: "east", parentId: "root", name: "华东" },
      { id: "east-a", parentId: "east", name: "上海" },
      { id: "west", parentId: "root", name: "华西" }
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: async () => rows
        })
      })
    };
    await expect(listClientSelectableDepartments({
      db: db as never,
      user: { departmentIds: ["east-a"] }
    })).resolves.toEqual([{
      id: "east-a",
      name: "上海",
      pathName: "集团 / 华东 / 上海",
      hasChildren: false
    }]);
  });
});