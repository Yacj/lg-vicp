import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkMigrationConsistency } from "./verify-migrations.mjs";

function check(mutator) {
  const dir = mkdtempSync(path.join(tmpdir(), "vicp-migration-check-"));
  const journal = { entries: [
    { idx: 0, tag: "0000_first", when: 1 },
    { idx: 1, tag: "0001_second", when: 2 }
  ] };
  try {
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "0000_first.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "0001_second.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "meta/0000_snapshot.json"), JSON.stringify({ id: "first", prevId: "00000000-0000-0000-0000-000000000000" }));
    writeFileSync(path.join(dir, "meta/0001_snapshot.json"), JSON.stringify({ id: "second", prevId: "first" }));
    mutator?.(dir, journal);
    writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
    return checkMigrationConsistency(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("迁移静态一致性", () => {
  it("当前仓库 SQL 与 journal 完整对应，包括 0032", () => expect(checkMigrationConsistency()).toEqual([]));
  it("正常链通过", () => expect(check()).toEqual([]));
  it("未登记 SQL 被拒绝", () => expect(check((dir) => writeFileSync(path.join(dir, "0002_missing.sql"), "SELECT 1;"))).toContain("SQL 未登记 journal：0002_missing.sql"));
  it("journal 缺 SQL 被拒绝", () => expect(check((dir) => rmSync(path.join(dir, "0001_second.sql")))).toContain("journal 对应 SQL 缺失：0001_second"));
  it("重复 idx 被拒绝", () => expect(check((_, j) => { j.entries[1].idx = 0; })).toContain("重复 idx：0"));
  it("序号跳号被拒绝", () => expect(check((_, j) => { j.entries[1].tag = "0002_second"; })).toEqual(expect.arrayContaining([expect.stringContaining("序号缺口")])));
  it("snapshot 链不一致被拒绝", () => expect(check((dir) => writeFileSync(path.join(dir, "meta/0001_snapshot.json"), JSON.stringify({ id: "second", prevId: "wrong" })))).toContain("snapshot 链不匹配：0001_snapshot.json"));
});
