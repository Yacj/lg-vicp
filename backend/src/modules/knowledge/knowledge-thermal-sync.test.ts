import "dotenv/config";
import { describe, expect, it } from "vitest";
import { assessPageThermalSync } from "./knowledge-thermal-sync.js";
import { uploadedPageLabel, visiblePageLabel } from "../../shared/page-label.js";
import { summarizePageReadiness } from "./knowledge-readiness.js";

const option = { thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 };
const data = { fullText: "确认页", systems: [{ schemeId: "scheme-i", systemName: "薄抹灰", constructionCode: "A1-3", options: [option] }] };
describe("确认快照与正式热工档位同步诊断", () => {
  it("四项一致才同步，串构造或串数值不能用行数冒充", () => {
    expect(assessPageThermalSync(data, []).status).toBe("NOT_SYNCED");
    expect(assessPageThermalSync(data, [{ ...option, schemeId: "other" }]).status).toBe("NOT_SYNCED");
    expect(assessPageThermalSync(data, [{ ...option, schemeId: "scheme-i", kValue: 0.3 }]).status).toBe("NOT_SYNCED");
    expect(assessPageThermalSync(data, [{ ...option, schemeId: "scheme-i" }])).toMatchObject({ status: "SYNCED", syncedRows: 1, missingRows: 0 });
  });
  it("发布readiness明确统计尚未同步的确认页", () => {
    const result = summarizePageReadiness([{ metadata: { recognitionStatus: "CONFIRMED", uploadSource: "BATCH", confirmedStructuredData: data }, pageImageObjectKey: "page.png" }], 1);
    expect(result.unsyncedThermalPageCount).toBe(1);
  });
  it("文件名/物理页序FALLBACK不显示，手工印刷21才能显示", () => {
    const fallback = uploadedPageLabel(undefined, "1");
    expect(fallback).toMatchObject({ pageLabelSource: "FALLBACK", pageLabelVerified: false });
    expect(visiblePageLabel(fallback)).toBeNull();
    expect(visiblePageLabel(uploadedPageLabel("21", "1"))).toBe("21");
    expect(visiblePageLabel({ pageLabel: "21", pageLabelSource: "VISUAL_MATCH", pageLabelVerified: false })).toBeNull();
  });
});
