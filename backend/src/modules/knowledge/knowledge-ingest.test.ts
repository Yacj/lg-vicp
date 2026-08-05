import "dotenv/config"; // 必须在导入 ingest 服务前加载 env（服务顶层引用 env 配置）
import { describe, expect, it } from "vitest";
import { ConflictError } from "../../shared/errors.js";
import {
  assertNoDuplicateSha256,
  DEFAULT_RANKING_WEIGHTS,
  renderDownloadUrl,
  safeExtension
} from "./knowledge-ingest.service.js";

/** drizzle 链式查询的最小桩：where().limit() 按调用次序依次返回预设行 */
function stubDb(...queries: Array<Array<Record<string, unknown>>>): any {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => queries[Math.min(call++, queries.length - 1)]
        })
      })
    })
  };
}

describe("SHA-256 去重", () => {
  const sha = "a".repeat(64);

  it("无重复时直接通过", async () => {
    await expect(assertNoDuplicateSha256(stubDb([]), sha)).resolves.toBeUndefined();
  });

  it("sha256 为空时跳过检查", async () => {
    await expect(assertNoDuplicateSha256(stubDb([]), null)).resolves.toBeUndefined();
  });

  it("命中已发布版本时抛出冲突", async () => {
    const db = stubDb([{ id: "file-1" }], [{ id: "version-1" }]);
    await expect(assertNoDuplicateSha256(db, sha)).rejects.toThrow(ConflictError);
  });

  it("命中未发布版本时同样拒绝并提示先处理草稿", async () => {
    const db = stubDb([{ id: "file-1" }], [{ id: "version-1" }]);
    const dbDraft = stubDb([{ id: "file-1" }], []);
    await expect(assertNoDuplicateSha256(db, sha)).rejects.toThrow("已入库并发布");
    await expect(assertNoDuplicateSha256(dbDraft, sha)).rejects.toThrow("未发布");
  });

  it("excludeFileId 排除自身后允许通过", async () => {
    const db = stubDb([]); // 排除自身后无命中
    await expect(assertNoDuplicateSha256(db, sha, "file-1")).resolves.toBeUndefined();
  });
});

describe("抓取 URL 模板渲染", () => {
  it("替换 {date} 为当天日期", () => {
    const now = new Date("2026-03-14T08:00:00Z");
    expect(renderDownloadUrl("https://std.example.gov.cn/{date}/file.pdf", now)).toBe(
      "https://std.example.gov.cn/2026-03-14/file.pdf"
    );
  });

  it("无占位符时原样返回", () => {
    expect(renderDownloadUrl("https://std.example.gov.cn/fixed.pdf")).toBe(
      "https://std.example.gov.cn/fixed.pdf"
    );
  });
});

describe("文件扩展名清洗", () => {
  it("保留合法扩展名", () => {
    expect(safeExtension("热工表.xlsx")).toBe(".xlsx");
    expect(safeExtension("构造图集.pdf")).toBe(".pdf");
  });

  it("无扩展名返回空串", () => {
    expect(safeExtension("README")).toBe("");
  });
});

describe("检索权重兜底", () => {
  it("包含全部排序分量且与种子一致", () => {
    expect(DEFAULT_RANKING_WEIGHTS.TITLE_HIT).toBe(30);
    expect(DEFAULT_RANKING_WEIGHTS.CLAUSE_NO_HIT).toBe(25);
    expect(DEFAULT_RANKING_WEIGHTS.PHRASE_HIT).toBe(20);
    expect(DEFAULT_RANKING_WEIGHTS.KEYWORD_HIT).toBe(5);
    expect(DEFAULT_RANKING_WEIGHTS.ALIAS_HIT).toBe(4);
    expect(DEFAULT_RANKING_WEIGHTS.FULLTEXT_HIT).toBe(1);
    expect(DEFAULT_RANKING_WEIGHTS.FUZZY_HIT).toBe(0.5);
    expect(DEFAULT_RANKING_WEIGHTS.EVIDENCE_LEVEL_BONUS).toBe(3);
    expect(DEFAULT_RANKING_WEIGHTS.CURRENT_VERSION_BONUS).toBe(2);
  });
});