import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { emitReferencePages, isReferencePageConsumable } from "./thermal-calculate.tool.js";

describe("REFERENCE_PAGE 正式知识页防御", () => {
  it.each(["21", null])("来源页标签%s经过Tool/SSE仍与物理页序1分开", async (pageLabel) => {
    const rows = [{ pageId: "page", documentId: "doc", documentTitle: "图集", pageNumber: 1, physicalPageNumber: 1,
      pageLabel, pageImageObjectKey: "p.png", versionId: "v", currentVersionId: "v", versionStatus: "PUBLISHED",
      documentStatus: "ACTIVE", documentDeletedAt: null, effectiveDate: null, expiryDate: null }];
    const query: any = { from: () => query, innerJoin: () => query, where: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve) };
    const onEvent = vi.fn();
    const result = await emitReferencePages({ app: { db: { select: () => query }, log: { warn: vi.fn() },
      storage: { createDownloadUrl: async () => "https://example.test/p.png" } }, onEvent } as any,
    [{ id: "c", sourceDocumentId: "doc", sourcePageId: "page", sourcePageLabel: "1", thicknessMm: 60, productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12 }]);
    expect(result.candidates[0]?.sourcePageLabel).toBe(pageLabel);
    const block = onEvent.mock.calls.find(([name]) => name === "reference_pages")?.[1].referencePages[0];
    expect(block.page.pageLabel ?? null).toBe(pageLabel);
    expect(block.page.physicalPageNumber).toBe(1);
    expect(result.sources[0]).toMatchObject({ physicalPageNumber: 1 });
  });
  it("仅允许已发布、有效且未删除的知识页", () => {
    const base = {
      versionId: "version-1",
      versionStatus: "PUBLISHED",
      documentStatus: "ACTIVE",
      documentDeletedAt: null,
      currentVersionId: "version-1",
      effectiveDate: null,
      expiryDate: null
    };
    expect(isReferencePageConsumable(base, "2026-10-06")).toBe(true);
    expect(isReferencePageConsumable({ ...base, versionStatus: "DRAFT" }, "2026-10-06")).toBe(false);
    expect(isReferencePageConsumable({ ...base, documentDeletedAt: new Date() }, "2026-10-06")).toBe(false);
    expect(isReferencePageConsumable({ ...base, expiryDate: "2026-10-05" }, "2026-10-06")).toBe(false);
  });

  it("历史脏数据指向 DRAFT 页时不签名、不输出 REFERENCE_PAGE", async () => {
    const createDownloadUrl = vi.fn();
    const onEvent = vi.fn();
    const rows = [{
      pageId: "page-1",
      documentId: "doc-1",
      documentTitle: "草稿图集",
      pageNumber: 22,
      physicalPageNumber: 22,
      pageLabel: "22",
      pageImageObjectKey: "private/draft-page.png",
      versionId: "version-1",
      versionStatus: "DRAFT",
      effectiveDate: null,
      expiryDate: null,
      documentStatus: "ACTIVE",
      documentDeletedAt: null,
      currentVersionId: "version-1"
    }];
    const query: any = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve)
    };
    const outcome = await emitReferencePages({
      app: {
        db: { select: () => query },
        storage: { createDownloadUrl },
        log: { warn: vi.fn() }
      },
      onEvent
    } as any, [{
      id: "row-1",
      sourceDocumentId: "doc-1",
      sourcePageId: "page-1",
      sourcePageLabel: "22",
      thicknessMm: 18,
      productThermalResistance: 2.88,
      totalThermalResistance: 3.297,
      kValue: 0.303
    }]);
    expect(outcome).toMatchObject({ missingPage: true, sources: [], warnings: [] });
    expect(outcome.candidates[0]?.kValue).toBe(0.303);
    expect(createDownloadUrl).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("Case K：无 ORIGINAL 的页面驱动知识仍输出 ReferencePage（双 R + 完整原页）", async () => {
    const createDownloadUrl = vi.fn(async (key: string) => `https://example.test/${key}`);
    const onEvent = vi.fn();
    // 页面驱动版本：没有 ORIGINAL 资产，只有 knowledge_pages 原页图
    const rows = [{
      pageId: "page-12",
      documentId: "doc-page-driven",
      documentTitle: "VICP 页面驱动图集",
      pageNumber: 12,
      physicalPageNumber: 12,
      pageLabel: "12",
      pageImageObjectKey: "knowledge/page-images/doc-page-driven/ver-1/p12.png",
      versionId: "ver-1",
      versionStatus: "PUBLISHED",
      effectiveDate: null,
      expiryDate: null,
      documentStatus: "ACTIVE",
      documentDeletedAt: null,
      currentVersionId: "ver-1"
    }];
    const query: any = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve)
    };
    const outcome = await emitReferencePages({
      app: {
        db: { select: () => query },
        storage: { createDownloadUrl },
        log: { warn: vi.fn() }
      },
      onEvent
    } as any, [{
      id: "row-1",
      systemName: "外墙外保温",
      schemeCode: "VICP-25",
      sourceDocumentId: "doc-page-driven",
      sourcePageId: "page-12",
      sourcePageLabel: "12",
      thicknessMm: 25,
      productThermalResistance: 4,
      totalThermalResistance: 4.306822098,
      kValue: 0.2321897625
    }]);

    expect(outcome.missingPage).toBe(false);
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0]).toMatchObject({ pageId: "page-12", pageLabel: "12", physicalPageNumber: 12 });
    const referenceEvent = onEvent.mock.calls.find((call) => call[0] === "reference_pages")?.[1] as any;
    const block = referenceEvent.referencePages[0];
    expect(block.type).toBe("REFERENCE_PAGE");
    expect(block.page.pageId).toBe("page-12");
    expect(block.page.pageLabel).toBe("12");
    expect(block.page.imageUrl).toContain("p12.png");
    // 双 R 不混用、不互推
    expect(block.summary.productThermalResistance).toBe(4);
    expect(block.summary.totalThermalResistance).toBe(4.306822098);
    expect(createDownloadUrl).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith("sources", expect.anything());
  });
});
