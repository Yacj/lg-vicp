import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageRecognitionResultSchema } from "./page-recognition.js";
import { auditedSourceTableHeaders, confirmedHeaderFingerprint } from "./confirmed-source-table-headers.js";
import { buildKnowledgePageRenderModel } from "./knowledge-page-render.js";

const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/source-table-headers.json", import.meta.url), "utf8"));
describe("客户原表头只读显示", () => {
  it.each(fixture.pages)("原表$physicalPageNumber按内容绑定，保留全部数字、正式ID及快照", (page: any) => {
    const data = pageRecognitionResultSchema.parse(page.data), before = structuredClone(data);
    const model = buildKnowledgePageRenderModel(page.pageId, data)!;
    const revision = createHash("sha256").update(JSON.stringify([page.pageId, data])).digest("hex").slice(0, 24);
    const group = page.physicalPageNumber === 77 ? "板材主断面" : "外墙主断面";
    expect(model.constructions).toHaveLength(data.systems.length);
    model.constructions.forEach((construction, index) => {
      expect(construction.constructionId).toBe(`kp-${revision}-${index}`);
      expect(construction.sourceTableLayout?.resistance).toBe("SHARED_LAYER_OPTION");
      expect(construction.sourceColumns).toEqual(data.systems[index]!.sourceColumns);
      expect(construction.sourceDisplayColumns?.find(column => column.fieldKey === "rValue")?.label).toBe("热阻");
      expect(construction.sourceDisplayColumns?.find(column => column.fieldKey === "productThermalResistance")?.scope).toBe("UNKNOWN");
      expect(construction.sourceDisplayColumns?.find(column => column.fieldKey === "totalThermalResistance")).toMatchObject({ label: "传热阻R", groupLabel: group });
      construction.options.forEach((option, optionIndex) => {
        expect(option.optionId).toBe(`${construction.constructionId}-o${optionIndex}`);
        for (const key of ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue", "layerValues"] as const)
          expect(option[key]).toEqual(data.systems[index]!.options![optionIndex]![key]);
      });
      construction.layers.forEach((layer, layerIndex) => expect(layer).toMatchObject(data.systems[index]!.layers![layerIndex]!));
    });
    expect(data).toEqual(before);
    if (page.physicalPageNumber === 33) {
      expect(model.constructions.every(construction => construction.options.every(option => option.productThermalResistance == null))).toBe(true);
      expect(model.constructions.flatMap(construction => construction.options).some(option => option.layerValues?.some(layer => layer.rValue === 3.2))).toBe(true);
    }
  });
  it("数据变化或同标题其他来源不套用客户表头，JSON键顺序不影响匹配", () => {
    const data = pageRecognitionResultSchema.parse(fixture.pages[0].data);
    const reverse = (value: any): any => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;
    expect(confirmedHeaderFingerprint(reverse(data))).toBe(confirmedHeaderFingerprint(data));
    const changed = structuredClone(data); changed.systems[0]!.options![0]!.kValue = 99;
    expect(auditedSourceTableHeaders(changed)).toBeUndefined();
    expect(buildKnowledgePageRenderModel("changed", changed)!.constructions[0]!.sourceTableLayout).toBeUndefined();
    expect(auditedSourceTableHeaders({ ...data, fullText: "同标题但不同的资料" })).toBeUndefined();
  });
});
