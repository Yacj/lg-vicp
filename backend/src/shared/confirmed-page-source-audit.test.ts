import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { confirmedPageSourceAudit } from "./confirmed-page-source-audit.js";
import { visiblePageLabel } from "./page-label.js";
import { readableRenderModel } from "./readable-page-render.js";
const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/confirmed-source-page-labels.json", import.meta.url), "utf8"));
const versionId = "b93a1099-4f32-45b4-8683-b3a3ef5bb64e";
it("按原图核验25/26/53，不按页序统一加20；原数字和revision保持不变", () => {
  expect(fixture.pages.filter((item: any) => [5, 6, 33].includes(item.physicalPageNumber))).toHaveLength(3);
  for (const page of fixture.pages.filter((item: any) => [5, 6, 33].includes(item.physicalPageNumber))) {
    const source = { id: page.pageId, versionId, pageLabel: String(page.physicalPageNumber), metadata: { confirmedStructuredData: page.data } };
    const before = structuredClone(source);
    expect(visiblePageLabel(source)).toBe(({ 5: "25", 6: "26", 33: "53" } as any)[page.physicalPageNumber]);
    const model = readableRenderModel(page.pageId, source.metadata, visiblePageLabel(source), versionId)!;
    if (page.physicalPageNumber === 6) expect(model.warnings.join(" ")).toContain("0.0012");
    expect(source).toEqual(before);
    const changed = structuredClone(source); changed.metadata.confirmedStructuredData.pageTitle += "修订";
    expect(confirmedPageSourceAudit(changed)?.printedLabel).toBeNull();
    expect(confirmedPageSourceAudit({ ...source, versionId: "other" })).toBeUndefined();
  }
});
