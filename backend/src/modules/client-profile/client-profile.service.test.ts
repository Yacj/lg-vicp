import { describe, expect, it } from "vitest";
import { getClientProfileSummary } from "./client-profile.service.js";

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