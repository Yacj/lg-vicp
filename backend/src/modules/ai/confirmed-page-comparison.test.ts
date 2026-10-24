import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { renderConfirmedPageComparison } from "./confirmed-page-comparison.js";
const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/phase03-handoff/replay.json", import.meta.url), "utf8"));
const pages = (numbers: number[], thickness: number) => fixture.pages.filter((item: any) => numbers.includes(item.page.physicalPageNumber)).map((item: any) => {
  const renderModel = buildKnowledgePageRenderModel(item.page.id, item.data)!;
  return { page: { pageId: item.page.id, documentTitle: "客户图集", pageLabel: item.page.physicalPageNumber === 33 ? "53" : item.page.physicalPageNumber === 5 ? "25" : "26" }, renderModel,
    matches: renderModel.constructions.flatMap(construction => construction.options.filter(option => option.thicknessMm === thickness).map(option => ({ constructionId: construction.constructionId, optionId: option.optionId }))) };
});
it("四基层45mm全组比较，极值只属这四条；不改变来源或创建候选", () => {
  const input = pages([5, 6], 45), before = JSON.stringify(input);
  const answer = renderConfirmedPageComparison(input as any, { metric: "K", direction: "MIN", evidence: "哪个最低" });
  for (const value of ["A3-1", "A3-2", "A3-3", "A3-4", "0.302", "0.294", "0.293", "0.248", "3.313", "3.398", "3.416", "4.04", "A3-4的K最低"]) expect(answer).toContain(value);
  expect(JSON.stringify(input)).toBe(before);
});
it("屋面两构造20mm层R=3.2与主断面R=3.569/K=.28分别保留，产品R为空", () => {
  const input = pages([33], 20), before = JSON.stringify(input), answer = renderConfirmedPageComparison(input as any);
  for (const value of ["3.2", "3.569", "0.28", "不等于产品整体热阻", "未提供，保持缺失"]) expect(answer).toContain(value);
  expect(input[0].matches).toHaveLength(2); expect(JSON.stringify(input)).toBe(before);
});
it("多轮重复引用同一来源档位只展示一次，不按相同数值合并其他来源", () => {
  const input = pages([33], 20);
  const answer = renderConfirmedPageComparison([...input, ...input] as any);
  expect(answer.split("\n").filter(line => line.startsWith("| 平屋面"))).toHaveLength(2);
  const otherVersion = input.map(page => ({ ...page, page: { ...page.page, versionId: "另一版本" } }));
  expect(renderConfirmedPageComparison([...input, ...otherVersion] as any).split("\n").filter(line => line.startsWith("| 平屋面"))).toHaveLength(4);
});
