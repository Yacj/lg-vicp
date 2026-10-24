import "dotenv/config";
import { expect, it } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { groupProductKnowledgeItems, projectKnowledgeProducts } from "./product-knowledge-facts.js";
import { buildProductParameterFocus, resolveProductParameterFocus, parameterComparisonMatches, filterKnowledgeByParameter } from "./product-parameter-focus.js";
import { validateProductNarrative, productNarrativeFacts, validateProductNarrativeSupport } from "./product-narrative.js";
import type { ProductAnswerFacts } from "./product-answer.js";
const source = { documentId: "d", versionId: "v", pageId: "p", pageLabel: "12", title: "已发布原表", revision: "r" };
function facts() {
  const model = buildKnowledgePageRenderModel("p", { fullText: "", systems: [{ systemName: "构造甲",
    layers: [{ name: "基层", thicknessMm: 200, lambda: 1, alpha: 1 }, { name: "甲板", lambda: .018, alpha: 1.2 }],
    options: [{ thicknessMm: 30 }, { thicknessMm: 40 }] }] })!;
  return { mode: "TECHNICAL", audience: "UNSPECIFIED", products: [], sources: [], hasMore: false,
    knowledgeItems: projectKnowledgeProducts(model, source) } satisfies ProductAnswerFacts;
}
it("产品事实按原表关系提取，基层不变成产品，档位厚度与材料λ保留口径及来源", () => {
  const f = facts(), item = f.knowledgeItems[0]!;
  expect(item.name).toBe("甲板"); expect(f.knowledgeItems).toHaveLength(1);
  expect(item.attributes).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "LAMBDA", value: .018, scope: "MATERIAL_LAYER", source: expect.objectContaining({ pageId: "p", revision: "r" }) }),
    expect.objectContaining({ key: "THICKNESS", value: 30, scope: "CONSTRUCTION_OPTION" })
  ]));
  expect(groupProductKnowledgeItems([...f.knowledgeItems, ...f.knowledgeItems])[0]!.sources).toHaveLength(2);
});
it("反查焦点只能来自已展示事实，换版本/换值失效，不从当前库猜一个值", () => {
  const f = facts(), focus = buildProductParameterFocus(f, "LAMBDA");
  expect(resolveProductParameterFocus(focus, focus).values?.[0]).toMatchObject({ value: .018, scope: "MATERIAL_LAYER" });
  expect(resolveProductParameterFocus(focus, focus.map(value => ({ ...value, sourceKey: "changed" }))).error).toContain("变化");
  expect(resolveProductParameterFocus(focus, focus.map(value => ({ ...value, value: .02 }))).error).toContain("变化");
  expect(resolveProductParameterFocus(buildProductParameterFocus(f), buildProductParameterFocus(f)).error).toContain("多个参数");
  expect(resolveProductParameterFocus([{ ...focus[0], entityId: "other" }], focus).error).toBeTruthy();
});
it("原值比较含边界与严格比较分别执行，不扩大成近似窗口", () => {
  for (const [comparison, equal] of [["EXACT", true], ["LT", false], ["LTE", true], ["GT", false], ["GTE", true]] as const)
    expect(parameterComparisonMatches(.018, .018, comparison)).toBe(equal);
  expect(parameterComparisonMatches(.0181, .018, "EXACT")).toBe(false);
});
it("同名对象有多个λ时只输出命中的值和对应原页，不能把另一来源的值混入结果", () => {
  const f = facts(), item = f.knowledgeItems[0]!;
  const original = item.attributes.find(attribute => attribute.key === "LAMBDA")!;
  item.attributes.push({ ...original, value: .04, source: { ...original.source, pageId: "other", pageLabel: "19" } });
  const focus = buildProductParameterFocus(f, "LAMBDA").find(value => value.value === .018)!;
  const result = filterKnowledgeByParameter(f.knowledgeItems, focus, "EXACT", new Set());
  expect(result[0]!.attributes.map(attribute => attribute.value)).toEqual([.018]);
  expect(result[0]!.sources.map(origin => origin.pageId)).toEqual(["p"]);
  expect(filterKnowledgeByParameter(f.knowledgeItems, focus, "LT", new Set())).toEqual([]);
});
it("自然回答按对象/属性绑定，不能把页码或其他属性数字借给λ/厚度", () => {
  const f = facts(), entityKey = productNarrativeFacts(f)[0]!.entityKey;
  expect(validateProductNarrative({ paragraphs: [{ entityKey, text: "甲板的材料层 λ=0.018 W/(m·K)，原表档位厚度30mm。" }] }, f)).toContain("0.018");
  for (const text of ["甲板λ=30。", "甲板厚度12mm。", "甲板λ=0.02。"])
    expect(validateProductNarrative({ paragraphs: [{ entityKey, text }] }, f)).toBeNull();
  expect(validateProductNarrative({ paragraphs: [{ entityKey: "invented", text: "甲板。" }] }, f)).toBeNull();
});

it("自然回答可分段引用同一真实对象，逐段事实保护仍须通过",()=>{
 const f=facts(),entityKey=productNarrativeFacts(f)[0]!.entityKey;
 expect(validateProductNarrative({paragraphs:[{entityKey,text:"甲板的材料层λ=0.018。"},{entityKey,text:"原表档位厚度30mm。"}]},f)).toContain("30mm");
 expect(validateProductNarrative({paragraphs:[{entityKey,text:"甲板的材料层λ=0.018。"},{entityKey,text:"原表档位厚度12mm。"}]},f)).toBeNull();
});

it("模型总体支持结论不能放行未批准别名；名称片段/同构造材料不是正式同义名称",()=>{
 const f=facts(),entityKey=productNarrativeFacts(f)[0]!.entityKey;
 expect(validateProductNarrativeSupport({supported:true,engineeringClaims:[],availabilityClaims:[],unsupportedClaims:[],derivedClaims:[],aliasClaims:[{entityKey,alias:"甲芯材"}]},f)).toBe(false);
 expect(validateProductNarrativeSupport({supported:true,engineeringClaims:[],availabilityClaims:[],unsupportedClaims:[],derivedClaims:[],aliasClaims:[{entityKey:"invented",alias:"甲板"}]},f)).toBe(false);
 expect(validateProductNarrativeSupport({supported:true,engineeringClaims:[],availabilityClaims:[],unsupportedClaims:[],derivedClaims:[],aliasClaims:[]},f)).toBe(true);
});

it("模型总体支持也不能增加Backend未给定的极值或等效结论",()=>{
 const f=facts();
 for(const kind of ["EXTREMUM","TOTAL_COUNT","INTERCHANGEABILITY","COMPLIANCE"]){
  expect(validateProductNarrativeSupport({supported:true,engineeringClaims:[],availabilityClaims:[],unsupportedClaims:[],aliasClaims:[],derivedClaims:[{kind,text:"未授权的派生结论"}]},f)).toBe(false);
 }
});
it("概览主动隐藏数值仍代表参数存在，不能声称资料缺参",()=>{
 const f=facts();f.mode="INTRODUCTION";
 const entity=productNarrativeFacts(f)[0]!;
 expect(entity.values).toEqual([]);
 expect(entity.availableParameters).toContain("LAMBDA");
 expect(entity.valueDisclosure).toBe("WITHHELD_FOR_INTRODUCTION");
 const verdict={supported:true,engineeringClaims:[],unsupportedClaims:[],aliasClaims:[],derivedClaims:[]};
 expect(validateProductNarrativeSupport({...verdict,availabilityClaims:[{entityKey:entity.entityKey,field:"LAMBDA",available:false}]},f)).toBe(false);
 expect(validateProductNarrativeSupport({...verdict,availabilityClaims:[{entityKey:entity.entityKey,field:"LAMBDA",available:true}]},f)).toBe(true);
 expect(validateProductNarrativeSupport({...verdict,availabilityClaims:[{entityKey:entity.entityKey,field:null,available:false}]},f)).toBe(false);
});
it("原文名称和参数不能被推断成芯材关系、内部组成、机制或优势",()=>{
 const f=facts(),entityKey=productNarrativeFacts(f)[0]!.entityKey;
 for(const kind of ["COMPOSITION","CORE","MECHANISM","BENEFIT"])
  expect(validateProductNarrativeSupport({supported:true,unsupportedClaims:[],availabilityClaims:[],aliasClaims:[],derivedClaims:[],
   engineeringClaims:[{entityKey,kind,text:"名称无法证明的工程断言"}]},f)).toBe(false);
});
