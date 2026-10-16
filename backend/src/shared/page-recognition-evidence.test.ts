import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRecognitionDraft, pageRecognitionResultSchema, resolveOptionThermalResistances } from "./page-recognition.js";
import { preparePageRecognitionCandidate, validatePageRecognitionEvidence } from "./page-recognition-evidence.js";
import { buildKnowledgePageRenderModel } from "./knowledge-page-render.js";

const fixture = (page: number) => pageRecognitionResultSchema.parse(JSON.parse(readFileSync(new URL(`../../tests/fixtures/complex-atlas/page-${page}.json`, import.meta.url), "utf8")).data);

describe("复杂热工页：原图数字与工程身份", () => {
  it.each([22, 53])("原图%s：简图说明与热工行分离，原表层号与列头原样透传", page => {
    const data = fixture(page), before = JSON.stringify(data);
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.issues).toEqual([]);
    const model = buildKnowledgePageRenderModel(`source-${page}`, checked.data)!;
    expect(model.pageLabel).toBe(String(page));
    for (const group of model.constructions) {
      expect(group.layers).toHaveLength(6);
      expect(group.layers.every(layer => layer.sourceRegion === "THERMAL_TABLE")).toBe(true);
      expect(group.layers.some(layer => layer.name.includes("按工程设计"))).toBe(false);
      expect(group.sourceTableHeaders).toEqual({ identifier: "编号", diagram: "构造简图", layers: "构造层" });
      expect(group.options.every(option => option.productThermalResistance == null && option.layerValues?.[0]?.rValue != null)).toBe(true);
    }
    if (page === 53) {
      expect(model.constructions[0]!.layers.map(layer => layer.sourceLayerLabel)).toEqual(["1", "2", "4", "5", "6", "7"]);
      expect(model.constructions[1]!.layers.map(layer => layer.sourceLayerLabel)).toEqual(["1", "2", "3", "4", "6", "9"]);
      expect(model.constructions[0]!.diagramNotes).toHaveLength(11);
      expect(model.constructions[0]!.options.map(option => option.kValue)).toEqual(model.constructions[1]!.options.map(option => option.kValue));
      expect(model.constructions[0]!.options[0]!.optionId).not.toBe(model.constructions[1]!.options[0]!.optionId);
    } else {
      expect(model.constructions[0]!.constructionCode).toBe("A1-3");
      expect(model.constructions[0]!.options[1]!.totalThermalResistance).toBe(3.297);
    }
    expect(JSON.stringify(data)).toBe(before);
  });

  it("简图行不能承载材料层档位引用；来源不明、等号编号提示核对但不擅自改事实", () => {
    const data = fixture(53), group = data.systems[0]!;
    group.layers![2]!.sourceRegion = "DIAGRAM";
    group.layers![3]!.sourceRegion = "UNKNOWN";
    group.constructionCode = "A1=3"; group.rawConstructionLabel = "外墙A1=3"; group.constructionCodeEvidence = "A1=3";
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.data.systems[0]!.options!.every(option => option.layerValues?.length === 0)).toBe(true);
    expect(checked.issues.join(" ")).toContain("指向构造简图");
    expect(checked.data.warnings!.join(" ")).toContain("来源区域待核");
    expect(checked.data.warnings!.join(" ")).toContain("等号");
    expect(checked.data.systems[0]!.constructionCode).toBe("A1=3");
    expect(buildKnowledgePageRenderModel("page", checked.data)!.constructions[0]!.layers.some(layer => layer.sourceRegion === "DIAGRAM" && layer.variable)).toBe(false);
  });

  it.each([89, 90, 75])("第%s页保留独立构造、全部档位、λ/α及层/产品/整体R边界", page => {
    const data = fixture(page);
    const before = JSON.stringify(data);
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.issues).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
    expect(checked.data.systems).toHaveLength(2);
    const model = buildKnowledgePageRenderModel(`page-${page}`, checked.data)!;
    expect(new Set(model.constructions.map(item => item.constructionId)).size).toBe(2);
    for (const system of model.constructions) {
      expect(system.options).toHaveLength(page === 75 ? 7 : 6);
      expect(system.layers.filter(layer => layer.variable)).toHaveLength(1);
      expect(system.material).toMatchObject({ lambda: 0.0025, alpha: 1.25 });
      expect(system.sourceColumns?.find(column => column.fieldKey === "totalThermalResistance")).toMatchObject({ groupLabel: "外墙主断面", symbol: "R", scope: "CONSTRUCTION" });
      for (const option of system.options) {
        expect(option.productThermalResistance).toBeNull();
        expect(option.layerValues?.[0]?.rValue).toBeGreaterThan(0);
        expect(system.layers[option.layerValues![0]!.layerIndex]?.variable).toBe(true);
        expect(resolveOptionThermalResistances(option).skipFormalWrite).toBe(true);
      }
    }
  });

  it.each([
    [89, 0, 20, 5.225, .191], [89, 1, 20, 5.198, .192], [89, 0, 25, 6.025, .166], [89, 1, 25, 5.998, .167],
    [90, 0, 20, 5.369, .186], [90, 1, 20, 5.369, .186], [90, 0, 25, 6.169, .162], [90, 1, 25, 6.169, .162],
    [75, 0, 20, 6.916, .145], [75, 1, 20, 7.540, .133], [75, 0, 25, 8.516, .117], [75, 1, 25, 9.140, .109]
  ])("原图%s页组%s的%smm R=%s/K=%s独立绑定", (page, group, thickness, total, k) => {
    const system = fixture(page).systems[group]!;
    expect(system.options?.find(item => item.thicknessMm === thickness)).toMatchObject({ totalThermalResistance: total, kValue: k });
    if (page !== 75) expect(system.constructionCode).toBeNull();
  });

  it("同值的正倒置仍是两组；改组序或快照内容使旧引用失效", () => {
    const data = fixture(90);
    const model = buildKnowledgePageRenderModel("page", data)!;
    expect(model.constructions[0]!.options.map(option => option.kValue)).toEqual(model.constructions[1]!.options.map(option => option.kValue));
    expect(model.constructions[0]!.options[3]!.optionId).not.toBe(model.constructions[1]!.options[3]!.optionId);
    data.systems.reverse();
    const reordered = buildKnowledgePageRenderModel("page", data)!;
    const oldIds = new Set(model.constructions.flatMap(item => item.options.map(option => option.optionId)));
    expect(reordered.constructions.flatMap(item => item.options).some(option => oldIds.has(option.optionId))).toBe(false);
  });

  it("v2旧字段修订保留源标签、属性、列头和证据", () => {
    const data = fixture(90);
    const draft = buildRecognitionDraft({ fallback: data, pageTitle: "人工审核标题" });
    expect(draft.systems).toEqual(data.systems);
    expect(draft.notes).toEqual(data.notes);
    expect(draft.pageLabelEvidence).toBe("90");
  });

  it("旧JSON不增加默认字段，既有引用ID完全兼容", () => {
    const legacy = { pageLabel: "22", fullText: "旧确认记录", systems: [{ constructionCode: "A3-1", options: [{ thicknessMm: 45, productThermalResistance: 7.2, totalThermalResistance: 7.5, kValue: .133 }] }] };
    const parsed = pageRecognitionResultSchema.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect(validatePageRecognitionEvidence(parsed).data).toBe(parsed);
    const revision = createHash("sha256").update(JSON.stringify(["old-page", legacy])).digest("hex").slice(0, 24);
    expect(buildKnowledgePageRenderModel("old-page", parsed)?.constructions[0]?.options[0]?.optionId).toBe(`kp-${revision}-0-o0`);
  });

  it("材料层序号/标题不能冒充构造编号或印刷页码，正式ID不由模型写入", () => {
    const data = fixture(90);
    data.pageLabel = data.pageTitle;
    data.systems[0]!.constructionCode = "1";
    data.systems[0]!.constructionCodeEvidence = "1";
    data.systems[0]!.schemeId = "00000000-0000-4000-8000-000000000001";
    const normalized = preparePageRecognitionCandidate(data);
    expect(normalized.pageLabel).toBeNull();
    expect(normalized.systems[0]!.constructionCode).toBeNull();
    expect(normalized.systems[0]!.schemeId).toBeUndefined();
    expect(normalized.warnings?.join(" ")).toContain("编号");
  });

  it("有独立印刷编号证据的纯数字编号可保留，不全局禁止数字", () => {
    const data = fixture(90);
    Object.assign(data.systems[0]!, { rawConstructionLabel: "12", constructionCode: "12", constructionCodeEvidence: "12" });
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.constructionCode).toBe("12");
  });

  it("整格原文也可证明构造编号，但不能接受被截短的编号", () => {
    const data = fixture(75), system = data.systems[0]!;
    system.constructionCodeEvidence = system.rawConstructionLabel;
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.constructionCode).toBe("C1-3");
    system.rawConstructionLabel = "外墙C1-30"; system.constructionCodeEvidence = "外墙C1-30";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.constructionCode).toBeNull();
  });

  it("逐档芯层R不能填产品R，语义不明整体R留空且不复活；原图数值不按公式修正", () => {
    const data = fixture(90), system = data.systems[0]!, option = system.options![3]!;
    option.productThermalResistance = 4.8;
    option.fieldEvidence!.productThermalResistance = "4.800";
    system.sourceColumns!.push({ fieldKey: "productThermalResistance", label: "热阻", scope: "LAYER" });
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.data.systems[0]!.options![3]).toMatchObject({ productThermalResistance: null, totalThermalResistance: 5.369, kValue: .186 });
    system.sourceColumns!.find(item => item.fieldKey === "totalThermalResistance")!.scope = "UNKNOWN";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.options![3]!.totalThermalResistance).toBeNull();
    option.kValue = .999; option.fieldEvidence!.kValue = "0.999";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.options![3]!.kValue).toBe(.999);
  });

  it("有独立产品列和同行证据时接受产品整体R；字段错行与跨组层引用拒绝", () => {
    const data = fixture(90), system = data.systems[0]!, option = system.options![0]!;
    system.sourceColumns!.push({ fieldKey: "productThermalResistance", label: "产品整体热阻", symbol: "R", scope: "PRODUCT" });
    option.productThermalResistance = 2.5; option.fieldEvidence!.productThermalResistance = "2.500";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.options![0]!.productThermalResistance).toBe(2.5);
    option.fieldEvidence!.kValue = "0.186";
    option.layerValues![0]!.layerIndex = 999;
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.data.systems[0]!.options![0]).toMatchObject({ kValue: null, layerValues: [] });
    expect(checked.data.systems[1]!.options).toEqual(data.systems[1]!.options);
  });

  it("I/II型号不推断I级防水；90页四条施工备注原样保留", () => {
    const data = fixture(90), checked = validatePageRecognitionEvidence(data).data;
    expect(checked.systems.every(item => item.specClass === "II" && item.waterproofGrade === null)).toBe(true);
    expect(checked.notes).toHaveLength(4);
    expect(checked.notes).toEqual(data.notes);
  });

  it("缺失等级的‘级防水’不得冒充已核验等级，有完整原标签证据才保留", () => {
    const data = fixture(90), system = data.systems[0]!;
    system.waterproofGrade = "级防水";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.waterproofGrade).toBeNull();
    system.rawConstructionLabel = "平屋面（正置，Ⅰ级防水）";
    system.waterproofGrade = "Ⅰ级防水";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.waterproofGrade).toBe("Ⅰ级防水");
    system.rawConstructionLabel = "Ⅱ型平屋面（正置）";
    expect(validatePageRecognitionEvidence(data).data.systems[0]!.waterproofGrade).toBeNull();
  });

  it("单位不能充当源文符号，留空待核且不自行写成R₀", () => {
    const data = fixture(89), column = data.systems[0]!.sourceColumns!.find(item => item.fieldKey === "totalThermalResistance")!;
    column.symbol = "[(m²·K)/W]";
    const checked = validatePageRecognitionEvidence(data);
    expect(checked.data.systems[0]!.sourceColumns!.find(item => item.fieldKey === "totalThermalResistance")!.symbol).toBeNull();
    expect(checked.issues.join(" ")).toContain("源文符号混入单位");
    expect(checked.data.systems[0]!.options![3]!.totalThermalResistance).toBe(5.225);
  });
});
