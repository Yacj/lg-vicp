import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildKnowledgePageRenderModel, THERMAL_PAGE_FIELDS } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import { bindReferencePageMatch, buildReferencePageBlocks, storeReferencePageBlocks, type ReferencePageBlock } from "./reference-page.js";
import { hydrateMessageReferencePages, loadPublishedKnowledgeReferences, persistMessageReferencePages, resolveConfirmedReferenceAnswer, restoreReferencePageMatches } from "./ai-reference-pages.service.js";
import { isReferencePageConsumable } from "./reference-page-access.js";
import { formatConfirmedLookupAnswer } from "../knowledge/knowledge-test-reference.js";
import type { WikiHit } from "../knowledge/knowledge.service.js";

// 通用协议夹具；相同数值在另一构造出现，用于证明定位依赖ID。
export const snapshot: PageRecognitionResult = { pageLabel: "22", pageTitle: "测试薄抹灰系统", fullText: "旧文本错误厚度8mm及K0.999，禁止消费",
  systems: ["A1-3", "A1-4"].map(constructionCode => ({ constructionCode, systemName: "I型测试薄抹灰系统", specClass: "I",
    layers: [{ order: 1, name: "基层", thicknessMm: 240, lambda: 1.1, alpha: 1, rValue: 0.218 },
      { order: 2, name: "VICP测试保温板", thicknessMm: null, lambda: 0.005, alpha: 1.25, rValue: null }],
    options: [{ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 },
      { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 }] })) };
const pageId = randomUUID(), documentId = randomUUID(), versionId = randomUUID();
export const block: ReferencePageBlock = { type: "REFERENCE_PAGE", page: { pageId, documentId, documentTitle: "通用协议资料", pageNumber: 1, pageLabel: "22", imageUrl: "https://example.test/page?signature=old" },
  renderModel: buildKnowledgePageRenderModel(pageId, snapshot), matches: [], summary: {}, highlights: [] };
const firstId = block.renderModel!.constructions[0]!.options[0]!.optionId;
const candidate = { id: "official-row", sourcePageId: pageId, sourceDocumentId: documentId, schemeCode: "A1-3",
  thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 };
function fixtureApp(sourceChanges: Record<string, unknown> = {}, signingFails = false) {
  const row = { page: { id: pageId, documentId, versionId, pageLabel: "22", physicalPageNumber: 1, pageImageObjectKey: "fixtures/p.png", metadata: { confirmedStructuredData: snapshot } },
    document: { id: documentId, title: "通用协议资料", status: "ACTIVE", deletedAt: null, currentVersionId: versionId, projectId: null, insulationSystemId: null },
    version: { id: versionId, status: "PUBLISHED", usageMode: "AI_ENABLED", effectiveDate: null, expiryDate: null, ...sourceChanges } };
  const query: any = { from: () => query, innerJoin: () => query, where: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve([row]).then(resolve) };
  const app = { db: { select: (selection: unknown) => {
    if (selection && Object.keys(selection).join() === "id") {
      const list: any = { from: () => list, where: () => Promise.resolve([{ id: pageId }]) }; return list;
    }
    return query;
  } }, log: { warn: vi.fn() }, storage: { createDownloadUrl: vi.fn(async () => { if (signingFails) throw new Error("expired"); return "https://example.test/page?signature=fresh"; }) } };
  return { app: app as unknown as FastifyInstance, row, sign: app.storage.createDownloadUrl };
}
const hits = [{ documentId, versionId, pageId }] as WikiHit[];

describe("C端完整参考页协议", () => {
  it("候选仅绑定同页同构造完整一致的确认行，相同K不命中另一构造", () => {
    const match = bindReferencePageMatch(candidate, { ...block.page, renderModel: block.renderModel });
    expect(match).toMatchObject({ optionId: firstId, fieldKeys: THERMAL_PAGE_FIELDS });
    expect(bindReferencePageMatch({ ...candidate, thicknessMm: 8 }, { ...block.page, renderModel: block.renderModel })).toBeNull();
    expect(bindReferencePageMatch({ ...candidate, sourceDocumentId: "other" }, { ...block.page, renderModel: block.renderModel })).toBeNull();
    expect(bindReferencePageMatch({ ...candidate, totalThermalResistance: 9 }, { ...block.page, renderModel: block.renderModel })).toBeNull();
  });
  it("原图签名失败仍保留完整表格，双构造与全部厚度不裁成命中片段", () => {
    const built = buildReferencePageBlocks([candidate], [{ ...block.page, renderModel: block.renderModel, imageUrl: null }]);
    expect(built.blocks[0]!.renderModel).toBe(block.renderModel);
    expect(built.blocks[0]!.matches[0]!.optionId).toBe(firstId);
    expect(built.blocks[0]!.renderModel!.constructions).toHaveLength(2);
  });
  it("数值查表读取确认快照而非AI/旧全文，标记隐藏且携带真实段落偏移", async () => {
    const { app } = fixtureApp();
    const result = await loadPublishedKnowledgeReferences(app, hits, null, "薄抹灰传热系数0.3有哪些方案？");
    expect(result.authoritative).toBe(true);
    const resolved = resolveConfirmedReferenceAnswer(result.answer!, result.pages);
    expect(resolved.text).toContain("18mm"); expect(resolved.text).toContain("0.303");
    expect(resolved.text).not.toContain("已确认记录"); expect(resolved.text).not.toContain("产品层热阻");
    expect(resolved.text).not.toMatch(/(?<!\d)8mm/); expect(resolved.text).not.toContain("[[KP:");
    expect(resolved.pages).toHaveLength(1); expect(resolved.pages[0]!.matches).toHaveLength(2);
    expect(resolved.pages[0]).toMatchObject({ answerStyle: "THERMAL_SOLUTIONS", primaryFieldKeys: ["thicknessMm", "kValue"] });
    expect(resolved.pages[0]!.matches[0]!.summary).toMatchObject({ productThermalResistance: 2.88, totalThermalResistance: 3.297 });
    const offsets = resolved.pages[0]!.matches.map(match => match.answerOffset!);
    expect(offsets[0]).toBeLessThan(offsets[1]!);
  });
  it.each(["DRAFT", "APPROVED", "DISABLED"])("%s来源无权限数据不签名且不输出", async status => {
    const { app, sign } = fixtureApp({ status });
    expect((await loadPublishedKnowledgeReferences(app, hits, null, "K0.3有哪些方案")).pages).toEqual([]);
    expect(sign).not.toHaveBeenCalled();
  });
  it("签名失败后可重新请求，结构化模型/标识始终一致", async () => {
    const bad = fixtureApp({}, true), good = fixtureApp();
    const first = await loadPublishedKnowledgeReferences(bad.app, hits, null, "K0.3有哪些方案");
    const retry = await loadPublishedKnowledgeReferences(good.app, hits, null, "K0.3有哪些方案");
    expect(first.pages[0]!.page.imageUrl).toBe(""); expect(retry.pages[0]!.page.imageUrl).toContain("fresh");
    expect(first.pages[0]!.renderModel).toEqual(retry.pages[0]!.renderModel);
  });
  it("历史来源重签名且保留ID/字段/位置；不保存签名URL", async () => {
    const resolved = resolveConfirmedReferenceAnswer(formatConfirmedLookupAnswer([block], [firstId], []), [block]);
    const { app } = fixtureApp();
    const stored = await persistMessageReferencePages(app, resolved.pages, null);
    expect(JSON.stringify(stored)).not.toContain("signature="); expect(stored[0]!.pageImageObjectKey).toBe("fixtures/p.png");
    const history = await hydrateMessageReferencePages(app, [{ id: "message", metadata: { referencePages: stored } }], null);
    expect(history.get("message")![0]!.page.imageUrl).toContain("fresh");
    expect(history.get("message")![0]!.matches[0]).toMatchObject({ optionId: firstId, answerOffset: resolved.pages[0]!.matches[0]!.answerOffset });
    expect(JSON.stringify(storeReferencePageBlocks(resolved.pages))).not.toContain("signature=");
  });
  it("旧快照ID失效不猜新档位；老消息仅有图片仍兼容", () => {
    const resolved = resolveConfirmedReferenceAnswer(formatConfirmedLookupAnswer([block], [firstId], []), [block]);
    const stored = storeReferencePageBlocks(resolved.pages)[0]!;
    const changed = { ...block, renderModel: buildKnowledgePageRenderModel(pageId, { ...snapshot, notes: ["确认快照已变更"] }) };
    expect(restoreReferencePageMatches(changed, stored as unknown as Record<string, unknown>)).toBeNull();
    expect(restoreReferencePageMatches(block, { matches: [], summary: { kValue: 999 } })?.matches).toEqual([]);
  });
  it("历史撤回/换版/跨项目/BROWSE_ONLY不签名", async () => {
    const fixture = fixtureApp(); fixture.row.document.projectId = "private-project" as any;
    const metadata = { referencePages: storeReferencePageBlocks([block]) };
    expect((await hydrateMessageReferencePages(fixture.app, [{ id: "msg", metadata }], null)).size).toBe(0);
    expect(fixture.sign).not.toHaveBeenCalled();
    const base = { versionId, currentVersionId: versionId, versionStatus: "PUBLISHED", documentStatus: "ACTIVE", documentDeletedAt: null, effectiveDate: null, expiryDate: null };
    expect(isReferencePageConsumable({ ...base, usageMode: "BROWSE_ONLY" })).toBe(false);
    expect(isReferencePageConsumable({ ...base, currentVersionId: "new" })).toBe(false);
    expect(isReferencePageConsumable({ ...base, effectiveDate: "2999-01-01" })).toBe(false);
  });
});
