import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ detail: vi.fn(), proof: vi.fn() }));
vi.mock("../construction/construction-read.service.js", () => ({ getPublishedConstructionSchemeDetail: mocks.detail }));
vi.mock("./published-reference-source.js", () => ({ hasPublishedReferenceSource: mocks.proof }));
import { readPublishedConstructionLayers, publishedConstructionLayersStillCurrent } from "./published-construction-layers.js";
const candidate = { schemeId: "scheme", schemeVersion: 4, systemId: "system", productSpecId: "spec", thicknessMm: 28,
  evidenceSource: "approved", evidenceRef: "table" } as any;
const detail = () => ({ version: 4, systemId: "system", productOptions: [{ productSpecId: "spec", minThickness: 25, maxThickness: 30 }],
  layers: [{ layerOrder: 1, layerName: "基层", thickness: 180, evidenceSource: "approved", evidenceRef: "table" },
    { layerOrder: 2, layerName: "保温层", thickness: null, evidenceSource: "approved", evidenceRef: "table" }] });
beforeEach(() => { vi.resetAllMocks(); mocks.proof.mockReturnValue(true); mocks.detail.mockResolvedValue(detail()); });
it("同一发布版本、规格范围和逐层来源才读取，缺失厚度不补值", async () => {
  expect(await readPublishedConstructionLayers({} as any, candidate)).toEqual([{ order: 1, name: "基层", thicknessMm: 180 }, { order: 2, name: "保温层", thicknessMm: null }]);
});
it.each(["version", "system", "spec", "thickness", "source", "empty", "withdrawn"])("%s失效不能带出层数据", async reason => {
  const changed = detail();
  if (reason === "version") changed.version++;
  if (reason === "system") changed.systemId = "other";
  if (reason === "spec") changed.productOptions[0]!.productSpecId = "other";
  if (reason === "thickness") changed.productOptions[0]!.maxThickness = 26;
  if (reason === "source") changed.layers[0]!.evidenceRef = "other";
  if (reason === "empty") changed.layers = [];
  mocks.detail.mockResolvedValue(changed);
  if (reason === "withdrawn") mocks.detail.mockRejectedValue(new Error("not published"));
  expect(await readPublishedConstructionLayers({} as any, candidate)).toBeUndefined();
});
it("已附带层信息的候选在Confirm前严格重验；旧候选保持兼容且不补写旧快照", async () => {
  const layers = await readPublishedConstructionLayers({} as any, candidate);
  expect(await publishedConstructionLayersStillCurrent({} as any, { ...candidate, layers })).toBe(true);
  const changed = detail(); changed.layers[0]!.thickness = 190; mocks.detail.mockResolvedValue(changed);
  expect(await publishedConstructionLayersStillCurrent({} as any, { ...candidate, layers })).toBe(false);
  expect(await publishedConstructionLayersStillCurrent({} as any, candidate)).toBe(true);
  expect(candidate.layers).toBeUndefined();
});
