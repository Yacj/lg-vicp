import { describe, expect, it } from "vitest";
import {
  crawlTriggerBodySchema,
  documentListQuerySchema,
  manualDocumentCreateSchema,
  replacementCreateSchema,
  sourceCreateSchema
} from "./standard.schemas.js";

const baseDocument = {
  provinceCode: "500000",
  provinceName: "重庆市",
  documentNo: "DBJ50/T-428-2023",
  title: "居住建筑节能设计标准",
  indicators: [{ indicatorName: "传热系数限值", value: 0.45, evidenceRef: "第4.2.1条" }]
};

describe("standard schemas", () => {
  it("人工录入组合提交：合法输入通过并带默认值", () => {
    const parsed = manualDocumentCreateSchema.parse(baseDocument);
    expect(parsed.ingestType).toBeUndefined(); // ingestType 由服务层固定 MANUAL
    expect(parsed.standardStatus).toBe("OFFICIAL");
    expect(parsed.applicability).toEqual([]);
    expect(parsed.indicators[0].indicatorType).toBe("K_VALUE");
  });

  it("人工录入组合提交：指标证据引用缺失被拒（refine 兜底）", () => {
    expect(() => manualDocumentCreateSchema.parse({
      ...baseDocument,
      indicators: [{ indicatorName: "传热系数限值", value: 0.45, evidenceRef: "  " }]
    })).toThrow(/evidenceRef/);
  });

  it("人工录入组合提交：无指标被拒", () => {
    expect(() => manualDocumentCreateSchema.parse({ ...baseDocument, indicators: [] })).toThrow();
  });

  it("人工录入组合提交：非法省份/编号/数值被拒", () => {
    expect(() => manualDocumentCreateSchema.parse({ ...baseDocument, provinceCode: "" })).toThrow();
    expect(() => manualDocumentCreateSchema.parse({ ...baseDocument, documentNo: "  " })).toThrow();
    expect(() => manualDocumentCreateSchema.parse({
      ...baseDocument,
      indicators: [{ indicatorName: "x", value: -1, evidenceRef: "第4.2.1条" }]
    })).toThrow();
  });

  it("来源创建：默认值（today 范围、空栏目/规则、启用）", () => {
    const parsed = sourceCreateSchema.parse({
      provinceCode: "440000",
      provinceName: "广东省",
      officialDomain: "https://std.gd.gov.cn"
    });
    expect(parsed.crawlScope).toBe("today");
    expect(parsed.catalogUrls).toEqual([]);
    expect(parsed.extractRules).toEqual([]);
    expect(parsed.keywords).toEqual({ titleKeywords: [], excludeKeywords: [] });
    expect(parsed.enabled).toBe(true);
  });

  it("来源创建：栏目分页模式与关键字过滤配置校验", () => {
    const parsed = sourceCreateSchema.parse({
      provinceCode: "440000",
      provinceName: "广东省",
      officialDomain: "https://std.gd.gov.cn",
      catalogUrls: [{ label: "标准发布", url: "https://std.gd.gov.cn/list", paginationMode: "url", pageParam: "p", pageLimit: 10 }],
      keywords: { titleKeywords: ["节能"], excludeKeywords: ["征求意见"] }
    });
    expect(parsed.catalogUrls[0].paginationMode).toBe("url");
    expect(parsed.keywords.titleKeywords).toEqual(["节能"]);
    // 非法分页模式被拒
    expect(() => sourceCreateSchema.parse({
      provinceCode: "440000", provinceName: "广东省", officialDomain: "https://std.gd.gov.cn",
      catalogUrls: [{ label: "x", url: "https://std.gd.gov.cn/list", paginationMode: "fly" }]
    })).toThrow();
  });

  it("文档列表筛选：ingestType 双通道枚举校验", () => {
    expect(documentListQuerySchema.parse({ ingestType: "MANUAL" }).ingestType).toBe("MANUAL");
    expect(documentListQuerySchema.parse({ ingestType: "CRAWL" }).ingestType).toBe("CRAWL");
    expect(() => documentListQuerySchema.parse({ ingestType: "BOTH" })).toThrow();
  });

  it("手动触发抓取：scope 可选且限定 today/all", () => {
    expect(crawlTriggerBodySchema.parse({}).scope).toBeUndefined();
    expect(crawlTriggerBodySchema.parse({ scope: "all" }).scope).toBe("all");
    expect(() => crawlTriggerBodySchema.parse({ scope: "week" })).toThrow();
  });

  it("替代关系：新旧文档必填且为 uuid", () => {
    const parsed = replacementCreateSchema.parse({
      oldDocumentId: "11111111-1111-4111-8111-111111111111",
      newDocumentId: "22222222-2222-4222-8222-222222222222"
    });
    expect(parsed.replacementType).toBe("SUPERSEDE");
    expect(() => replacementCreateSchema.parse({ oldDocumentId: "not-uuid", newDocumentId: "22222222-2222-4222-8222-222222222222" })).toThrow();
  });
});