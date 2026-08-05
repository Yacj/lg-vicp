import "dotenv/config";
import { describe, expect, it } from "vitest";
import { MdError } from "../../shared/md-errors.js";
import {
  listPublishedProductParameters,
  requirePublishedSpecParameters
} from "./md-read.service.js";

/**
 * 只读服务桩：记录 where 收到的条件参数（drizzle and() 结果），按调用顺序返回预设行。
 * 服务内状态过滤不可由调用方控制，测试断言过滤条件必然存在、结果必须经过过滤语义。
 */
function makeDb(...results: Array<Array<Record<string, unknown>>>): {
  db: any;
  whereArgs: unknown[][];
} {
  let call = 0;
  const whereArgs: unknown[][] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          whereArgs.push(args);
          return {
            orderBy: async () => results[Math.min(call++, results.length - 1)] ?? []
          };
        }
      })
    })
  };
  return { db, whereArgs };
}

describe("已发布参数读取服务", () => {
  it("无条件查询时仍然携带过滤条件（状态不可由调用方控制）", async () => {
    const { db, whereArgs } = makeDb([]);
    const result = await listPublishedProductParameters(db, {});
    expect(result).toEqual([]);
    expect(whereArgs).toHaveLength(1);
    // and(...) 必须收到条件列表，即服务内部无条件也强制附加状态与有效期过滤
    expect(whereArgs[0][0]).toBeTruthy();
  });

  it("specId / parameterCode / usage 过滤追加后正常查询", async () => {
    const { db, whereArgs } = makeDb([]);
    await listPublishedProductParameters(db, { specId: "s-1", parameterCode: "K", usage: "ATLAS_QUERY" });
    expect(whereArgs).toHaveLength(1);
    expect(whereArgs[0][0]).toBeTruthy();
  });

  it("usage 过滤：allowedUsage 为空的参数不被用途条件排除（由 SQL 语义保证）", async () => {
    const row = { id: "p-1", parameterCode: "K", allowedUsage: [], status: "PUBLISHED" };
    const { db } = makeDb([row]);
    const result = await listPublishedProductParameters(db, { usage: "ATLAS_QUERY" });
    expect(result).toEqual([row]);
  });

  it("计算前置：无已发布可用参数时抛 MD_NOT_PUBLISHED", async () => {
    const { db } = makeDb([]);
    await expect(requirePublishedSpecParameters(db, { usage: "ATLAS_QUERY" }))
      .rejects.toThrow(MdError);
    await expect(requirePublishedSpecParameters(db, { usage: "ATLAS_QUERY" }))
      .rejects.toThrow("没有已发布");
  });

  it("计算前置：存在可用参数时原样返回", async () => {
    const row = { id: "p-1", parameterCode: "K", status: "PUBLISHED" };
    const { db } = makeDb([row]);
    const result = await requirePublishedSpecParameters(db, { usage: "ATLAS_QUERY" });
    expect(result).toEqual([row]);
  });
});