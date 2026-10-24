import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "../../shared/auth-user.js";
import { resolveSourceDetail } from "./knowledge-wiki-read.service.js";
import { readFileSync } from "node:fs";
const auditedPages = JSON.parse(readFileSync(new URL("../../../tests/fixtures/confirmed-source-page-labels.json", import.meta.url), "utf8")).pages;

/** 来源详情服务真实投影，数据库/存储使用通用协议夹具。 */
function fixture(usageMode = "AI_ENABLED", effectiveDate: string | null = null, override: Record<string, unknown> = {}) {
  const page = { id: "page", documentId: "doc", versionId: "version", pageNumber: 1, physicalPageNumber: 1, pageLabel: "22", sectionId: null,
    parsedText: "旧机器文本", pageImageObjectKey: "fixtures/full-page.png", metadata: { confirmedStructuredData: { fullText: "", systems: [{ constructionCode: "A1-3", options: [{ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }] }] } } };
  Object.assign(page, override);
  const document = { id: "doc", title: "协议测试资料", projectId: null, status: "ACTIVE", deletedAt: null, currentVersionId: page.versionId };
  const version = { id: page.versionId, status: "PUBLISHED", expiryDate: null, effectiveDate, usageMode };
  const responses = [[page], [document], [version], [], [], []];
  const sign = vi.fn(async () => "https://example.test/fresh-full-page");
  const app = { db: { select: () => {
    const rows = responses.shift() ?? [];
    const query: any = { from: () => query, where: () => query, limit: () => Promise.resolve(rows), orderBy: () => Promise.resolve(rows) }; return query;
  } }, storage: { createDownloadUrl: sign } } as unknown as FastifyInstance;
  return { app, sign };
}
describe("C端来源详情确认页面模型与签名前权限", () => {
  it.each([[3, null], [5, "25"], [6, "26"], [33, "53"]])("来源页%d的定位与正文使用同一核验印刷页码，不把旧物理序号标为印刷页", async (physical, expected) => {
    const original = auditedPages.find((page: any) => page.physicalPageNumber === physical);
    const { app } = fixture("AI_ENABLED", null, { id: original.pageId, versionId: "b93a1099-4f32-45b4-8683-b3a3ef5bb64e",
      physicalPageNumber: physical, pageLabel: String(physical), pageLabelSource: "MANUAL", pageLabelVerified: true,
      metadata: { confirmedStructuredData: original.data } });
    const result = await resolveSourceDetail(app, { id: "user" } as AuthUser, { pageId: original.pageId });
    expect(result.location.pageLabel).toBe(expected); expect(result.page?.pageLabel).toBe(expected);
    expect(result.location.physicalPageNumber).toBe(physical);
  });
  it("来源内容指纹变化后定位页码也失效，不能以旧定位字段覆盖未知印刷页码", async () => {
    const original = structuredClone(auditedPages.find((page: any) => page.physicalPageNumber === 6)); original.data.pageTitle += "修订";
    const { app } = fixture("AI_ENABLED", null, { id: original.pageId, versionId: "b93a1099-4f32-45b4-8683-b3a3ef5bb64e", pageLabel: "6",
      metadata: { confirmedStructuredData: original.data } });
    const result = await resolveSourceDetail(app, { id: "user" } as AuthUser, { pageId: original.pageId });
    expect(result.location.pageLabel).toBeNull(); expect(result.page?.pageLabel).toBeNull();
  });
  it("原接口返回完整模型和新签名原图，印刷页码与物理定位分开", async () => {
    const { app, sign } = fixture();
    const result = await resolveSourceDetail(app, { id: "user" } as AuthUser, { pageId: "page" });
    expect(result.page?.renderModel?.constructions[0]?.options[0]).toMatchObject({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
    expect(result.location.pageLabel).toBe("22"); expect(result.location.physicalPageNumber).toBe(1);
    expect(result.page?.pageImageUrl).toContain("fresh-full-page"); expect(sign).toHaveBeenCalledTimes(1);
  });
  it.each([["BROWSE_ONLY", null], ["AI_ENABLED", "2999-01-01"]])("不可引用状态%s/%s在签名前拒绝", async (mode, date) => {
    const { app, sign } = fixture(mode!, date);
    await expect(resolveSourceDetail(app, { id: "user" } as AuthUser, { pageId: "page" })).rejects.toThrow("不可用于 AI 引用");
    expect(sign).not.toHaveBeenCalled();
  });
});
