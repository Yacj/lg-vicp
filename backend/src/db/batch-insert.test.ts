import { describe, expect, it } from "vitest";
import { PG_MAX_BIND_PARAMS, insertBatchSize, toInsertBatches } from "./batch-insert.js";

describe("批量写入切分", () => {
  it("按列数推算不触碰绑定参数上限的批大小", () => {
    expect(insertBatchSize(16)).toBe(Math.floor(PG_MAX_BIND_PARAMS / 16));
    expect(insertBatchSize(16) * 16).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
  });

  it("列数超过参数上限时至少写入一行", () => {
    expect(insertBatchSize(PG_MAX_BIND_PARAMS + 1)).toBe(1);
  });

  it("调用方指定的行数上限优先于参数上限", () => {
    expect(insertBatchSize(4, 100)).toBe(100);
  });

  it("拒绝非法列数", () => {
    expect(() => insertBatchSize(0)).toThrow("列数必须为正整数");
  });

  it("空输入不产生批次", () => {
    expect([...toInsertBatches([])]).toEqual([]);
  });

  it("按首行键数推断列数并完整覆盖所有行", () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ a: index, b: index }));
    const batches = [...toInsertBatches(rows, 100)];

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(rows);
  });

  it("单批行数受绑定参数上限约束", () => {
    const rows = Array.from({ length: 5 }, () => ({ a: 1, b: 2, c: 3 }));
    const batches = [...toInsertBatches(rows, undefined, 6)];

    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
  });
});