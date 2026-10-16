import "dotenv/config";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { runPageRecognitionJob } from "./knowledge-page-recognition.service.js";

vi.mock("ai", async importOriginal => ({ ...await importOriginal<typeof import("ai")>(), generateObject: vi.fn() }));
vi.mock("../ai-config/ai-config.service.js", () => ({
  resolveDefaultVisionModel: vi.fn(async () => ({ languageModel: {}, modelRef: { id: "mock-vision" } }))
}));

describe("v2 Worker候选安全边界（全内存Mock）", () => {
  it("模型缺v2标记或误填产品R仍进入待审核，不覆盖旧确认快照或写正式表", async () => {
    const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/complex-atlas/page-90.json", import.meta.url), "utf8")).data;
    delete data.schemaVersion;
    data.systems[0].schemeId = "00000000-0000-4000-8000-000000000001";
    data.systems[0].options[3].productThermalResistance = 4.8;
    data.systems[0].options[3].fieldEvidence.productThermalResistance = "4.800";
    vi.mocked(generateObject).mockResolvedValue({ object: data } as any);
    const confirmed = { fullText: "旧确认原文", systems: [] };
    const page: any = { id: "page", documentId: "document", versionId: "version", physicalPageNumber: 1,
      pageImageObjectKey: "test/page.png", pageLabel: null, metadata: { recognitionStatus: "PENDING", recognitionRunId: "run",
        confirmedStructuredData: confirmed, confirmedById: "old-reviewer", confirmedAt: "2026-01-01T00:00:00.000Z" } };
    const db: any = {
      select: () => { let table: unknown; const q: any = { from: (value: unknown) => { table = value; return q; }, where: () => q,
        limit: async () => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [{ id: "version", status: "DRAFT" }] : [] }; return q; },
      update: () => ({ set: (patch: any) => ({ where: () => ({ returning: async () => { Object.assign(page, patch); return [{ id: page.id }]; },
        then: (resolve: (value: unknown) => void) => { Object.assign(page, patch); resolve(undefined); } }) }) }),
      insert: vi.fn(), delete: vi.fn(), execute: vi.fn()
    };
    const result = await runPageRecognitionJob({ db, storage: { createDownloadUrl: vi.fn(async () => "https://example.test/original.png") } as any,
      log: { warn: vi.fn() } as any }, page.id, "run");
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(page.metadata.recognitionStatus).toBe("REVIEW_REQUIRED");
    expect(page.metadata.confirmedStructuredData).toEqual(confirmed);
    expect(page.metadata.confirmedById).toBe("old-reviewer");
    expect(page.metadata.confirmedAt).toBe("2026-01-01T00:00:00.000Z");
    const draft = page.metadata.draftStructuredData;
    expect(draft.schemaVersion).toBe(2);
    expect(draft.systems[0].schemeId).toBeUndefined();
    expect(draft.systems[0].options[3]).toMatchObject({ productThermalResistance: null, totalThermalResistance: 5.369, kValue: .186 });
    expect(page.metadata.recognitionWarnings.join(" ")).toContain("源列/原始数字证据");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
