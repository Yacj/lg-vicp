import { describe, expect, it } from "vitest";
import {
  freezeReportContextSnapshot,
  mergeReferencePages,
  normalizeStoredReferencePage
} from "./report-context-snapshot.js";
import { collectConversationReferencePages } from "./report-context-snapshot.service.js";


describe("report context referencePages", () => {
  it("按 pageId 去重并合并同页 matches/highlights，不保留签名 URL", () => {
    const merged = mergeReferencePages([
      {
        documentId: "doc-1",
        pageId: "page-1",
        pageLabel: "A5",
        pageNumber: 103,
        pageImageObjectKey: "knowledge/previews/p1.png",
        summary: { constructionCode: "A1-1", thicknessMm: 18, kValue: 0.303, rValue: 3.297 },
        highlights: [
          { field: "thicknessMm", label: "厚度", value: "18 mm" },
          { field: "rValue", label: "总热阻 R", value: "3.297" },
          { field: "kValue", label: "传热系数 K", value: "0.303" }
        ],
        imageUrl: "https://example.test/signed?exp=1"
      },
      {
        type: "REFERENCE_PAGE",
        page: {
          documentId: "doc-1",
          pageId: "page-1",
          documentTitle: "保温图集",
          pageNumber: 103,
          pageLabel: "A5",
          imageUrl: "https://example.test/signed?exp=2"
        },
        summary: { constructionCode: "A1-1", thicknessMm: 20, kValue: 0.277, rValue: 3.616 },
        highlights: [
          { field: "thicknessMm", label: "厚度", value: "20 mm" },
          { field: "rValue", label: "总热阻 R", value: "3.616" },
          { field: "kValue", label: "传热系数 K", value: "0.277" }
        ],
        matches: [{
          candidateId: "row-2",
          summary: { constructionCode: "A1-1", thicknessMm: 20, kValue: 0.277, rValue: 3.616 },
          highlights: [
            { field: "thicknessMm", label: "厚度", value: "20 mm" },
            { field: "rValue", label: "总热阻 R", value: "3.616" },
            { field: "kValue", label: "传热系数 K", value: "0.277" }
          ]
        }]
      }
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      documentId: "doc-1",
      pageId: "page-1",
      pageImageObjectKey: "knowledge/previews/p1.png",
      documentTitle: "保温图集"
    });
    expect(merged[0]?.matches).toHaveLength(2);
    expect(merged[0]?.highlights?.map((item) => item.value)).toEqual([
      "18 mm", "3.297", "0.303", "20 mm", "3.616", "0.277"
    ]);
    expect(JSON.stringify(merged)).not.toContain("https://example.test");
  });

  it("freeze 深拷贝 referencePages，后续修改不影响快照", () => {
    const source = [{
      documentId: "doc-1",
      pageId: "page-1",
      pageImageObjectKey: "k/p1.png",
      summary: { kValue: 0.3 },
      highlights: [{ field: "kValue", label: "传热系数 K", value: "0.3" }],
      matches: [{
        summary: { kValue: 0.3 },
        highlights: [{ field: "kValue", label: "传热系数 K", value: "0.3" }]
      }]
    }];
    const frozen = freezeReportContextSnapshot({
      id: "snap-1",
      conversationId: "c-1",
      reportType: "technical_scheme",
      selectedProductIds: [],
      confirmedRequirements: [],
      sourceRefs: [],
      referencePages: source,
      createdAt: new Date().toISOString()
    });
    source[0]!.summary!.kValue = 9.9;
    source[0]!.highlights![0]!.value = "9.9";
    source[0]!.matches![0]!.highlights[0]!.value = "9.9";
    expect(frozen.referencePages?.[0]?.summary).toEqual({ kValue: 0.3 });
    expect(frozen.referencePages?.[0]?.highlights?.[0]?.value).toBe("0.3");
    expect(frozen.referencePages?.[0]?.matches?.[0]?.highlights[0]?.value).toBe("0.3");
  });

  it("只使用最近一条有效 referencePages，不合并更早助手消息", async () => {
    const latestRows = [
      { metadata: { referencePages: [{ documentId: "doc-1", pageId: "page-24", pageLabel: "24" }] }, role: "ASSISTANT" },
      { metadata: { referencePages: [{ documentId: "doc-1", pageId: "page-22", pageLabel: "22" }] }, role: "ASSISTANT" },
      { metadata: { content: "普通回答" }, role: "ASSISTANT" }
    ];
    const query = {
      orderBy: async () => latestRows
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => query
        })
      })
    } as any;
    const pages = await (await import("./report-context-snapshot.service.js")).collectConversationReferencePages(
      { db } as any,
      "conversation-1"
    );
    expect(pages.map((page) => page.pageId)).toEqual(["page-24"]);
  });

  it("显式选择的 referencePages 优先于助手消息", async () => {
    const db = { select: () => { throw new Error("不应读取消息"); } } as any;
    const pages = await (await import("./report-context-snapshot.service.js")).collectConversationReferencePages(
      { db } as any,
      "conversation-1",
      [{ documentId: "doc-1", pageId: "page-36", pageLabel: "36" }]
    );
    expect(pages.map((page) => page.pageId)).toEqual(["page-36"]);
  });

  it("normalizeStoredReferencePage 丢弃签名 URL，只保留 objectKey", () => {
    const page = normalizeStoredReferencePage({
      documentId: "doc-1",
      pageId: "page-1",
      pageImageObjectKey: "obj/key.png",
      imageUrl: "https://signed.example/x"
    });
    expect(page).toMatchObject({
      documentId: "doc-1",
      pageId: "page-1",
      pageImageObjectKey: "obj/key.png"
    });
    expect(page).not.toHaveProperty("imageUrl");
  });
});
