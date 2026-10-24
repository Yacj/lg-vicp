import { describe, expect, it } from "vitest";
import { applySemanticQuery, describeNumberRoles, normalizeSemanticText, parseSemanticFastPath, type SemanticQuery } from "./semantic-query.js";
import { resolveQueryEntities } from "./thermal-entity-resolver.js";
import { identityMetricFailures, candidateIdentity } from "./thermal-candidate-identity.js";
import { validateCandidateAgainstQueryState } from "./thermal-query-state.js";
import { suggestQueryEntities } from "./thermal-entity-suggestions.js";

const dictionary = { entities: [
  { field: "systemId" as const, value: "sys-i", names: ["I型VICP薄抹灰外保温系统"], family: "薄抹灰" },
  { field: "systemId" as const, value: "sys-ii", names: ["II型VICP薄抹灰外保温系统"], family: "薄抹灰" },
  { field: "systemId" as const, value: "sys-board", names: ["保温装饰板系统"], category: "保温装饰板" },
  { field: "schemeId" as const, value: "scheme-i", names: ["A1-3"], systemId: "sys-i" },
  { field: "schemeId" as const, value: "scheme-board", names: ["A1-3"], systemId: "sys-board" }
], aliases: [{ term: "薄抹灰", alias: "外墙薄抹灰" }] };
const metric = (evidence: string, operator: "EXACT" | "APPROX" | "MAX_LIMIT" | "MIN_LIMIT" = "APPROX", value = 0.3, name: "K" | "TOTAL_R" | "PRODUCT_R" = "K"): SemanticQuery["constraints"][number] =>
  ({ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: name, operator, value, evidence, hard: true, confidence: 0.99 });
const parsed = (constraints: SemanticQuery["constraints"], queryMode: SemanticQuery["queryMode"] = "NEW_QUERY"): SemanticQuery => ({ queryMode, intent: "REFERENCE_LOOKUP", constraints, preferences: [], unresolved: [], confidence: 0.99 });

it.each([160, 200, 240])("基层%s的字段证据适用于厚/mm/毫米，不能吞掉同句板厚或继承旧问", base => {
  for (const unit of ["厚", "mm", "毫米"]) {
    const evidence = `${base}${unit}的基层`;
    const substrate = { ...metric(evidence, "EXACT", base), type: "THICKNESS" as const, field: "substrateThickness" as const, metric: null };
    const q = applySemanticQuery(`${evidence}，板材22mm，K不超过0.28`, parsed([
      substrate, { ...metric("板材22mm", "EXACT", 22), type: "THICKNESS", metric: null }, metric("K不超过0.28", "MAX_LIMIT", .28)
    ]), dictionary);
    expect(q).toMatchObject({ substrateThickness: base, thicknessMm: 22, unresolved: [] });
    const omitted = applySemanticQuery(`${evidence}，板材22mm`, parsed([substrate]), dictionary);
    expect(omitted.unresolved).toContainEqual(expect.objectContaining({ field: "thicknessMm" }));
    const reply = applySemanticQuery(`${evidence}\n基层另述，板材22mm`, parsed([
      substrate, { ...metric("板材22mm", "EXACT", 22), type: "THICKNESS", metric: null }
    ]), dictionary, undefined, { currentMessage: "基层另述，板材22mm" });
    expect(reply).toMatchObject({ substrateThickness: base, thicknessMm: 22, unresolved: [] });
  }
});

describe("统一语义分类的确定性边界", () => {
  const pageEntity = (field: "roofForm" | "applicationPart", literal: string): SemanticQuery["constraints"][number] => ({
    type: "ENTITY", operation: "SET", field, entityText: literal, resolvedText: null, metric: null, operator: null, value: null,
    evidence: literal, hard: true, confidence: .99
  });
  it.each([["平屋面", "FLAT"], ["坡屋面", "SLOPED"]])("已核验%s同时保留父级屋面范围，不要求重复字段", (literal, form) => {
    const q = applySemanticQuery(literal, parsed([pageEntity("roofForm", literal)]), dictionary);
    expect(q).toMatchObject({ applicationPart: "ROOF", roofForm: form, unresolved: [] });
  });
  it("子属性不能覆盖已经指定的冲突部位", () => {
    const q = applySemanticQuery("外墙和平屋面", parsed([pageEntity("applicationPart", "外墙"), pageEntity("roofForm", "平屋面")]), dictionary);
    expect(q.applicationPart).toBe("EXTERNAL_WALL");
    expect(q.unresolved).toContainEqual(expect.objectContaining({ field: "applicationPart" }));
  });
  it("缺原话证据或低置信度的子属性不补父部位", () => {
    for (const [message, confidence] of [["外墙", .99], ["平屋面", .5]] as const) {
      const q = applySemanticQuery(message, parsed([{ ...pageEntity("roofForm", "平屋面"), confidence }]), dictionary);
      expect(q.applicationPart).toBeUndefined();
      expect(q.roofForm).toBeUndefined();
      expect(q.unresolved?.length).toBeGreaterThan(0);
    }
  });
  it("移除屋面子属性不因其字形重新补回父部位", () => {
    const q = applySemanticQuery("平屋面", parsed([{ ...pageEntity("roofForm", "平屋面"), operation: "REMOVE" }]), dictionary);
    expect(q.applicationPart).toBeUndefined();
    expect(q.roofForm).toBeUndefined();
  });
  it.each(["Ⅲ型VICP薄抹灰外保温系统", "III型 VICP 薄抹灰外保温系统", "iii型vicp薄抹灰外保温系统"])("未登记的%s不能被正式I/II型名称后缀截获", name => {
    const entities = [
      { field: "systemId" as const, value: "sys-I", names: ["I型VICP薄抹灰外保温系统"] },
      { field: "systemId" as const, value: "sys-II", names: ["II型VICP薄抹灰外保温系统"] },
    ];
    expect(resolveQueryEntities(name, {}, entities).systemId).toBeUndefined();
    const exact = resolveQueryEntities(name, {}, [...entities, { field: "systemId", value: "sys-III", names: ["III型VICP薄抹灰外保温系统"] }]);
    expect(exact.systemId).toBe("sys-III");
  });
  it.each(["基层是什么？", "基层是哪个材料？", "基层为何不同？", "构造是什么？", "体系是什么？"])("读取问题%s不作为未知实体赋值，不污染已校验的构造/厚度条件", question => {
    const message = `Ⅲ型VICP薄抹灰外保温系统，A3-2构造45mm，传热系数是多少？${question}`;
    const entity = (field: "systemHint" | "specClass" | "schemeCode", text: string) => ({ ...metric(text), type: "ENTITY" as const,
      field, entityText: text, resolvedText: text, metric: null, operator: null, value: null });
    const semantic = { ...parsed([entity("systemHint", "Ⅲ型VICP薄抹灰外保温系统"), entity("specClass", "Ⅲ型"), entity("schemeCode", "A3-2"),
      { ...metric("45mm", "EXACT", 45), type: "THICKNESS" as const, metric: null }]), readFields: ["kValue", "baseMaterial"] };
    const query = applySemanticQuery(message, semantic, dictionary);
    expect(query).toMatchObject({ schemeCode: "A3-2", specClass: "III", thicknessMm: 45, readFields: ["kValue", "baseMaterial"], unresolved: [] });
    expect(query.substrateMaterial).toBeUndefined();
  });
  it.each(["基层:陌生材料", "基层材料=陌生材料", "体系：陌生体系", "构造=陌生编号", "产品目录:陌生产品"])("封闭字段标注%s仍拒绝未知实体", message => {
    expect(resolveQueryEntities(message, {}, []).unresolved?.length).toBeGreaterThan(0);
  });
  it("自然表达的未知基层约束仍由语义实体校验拒绝，不能因移除‘是’捷径而宽查", () => {
    const message = "基层是陌生材料，45mm";
    const proposal = parsed([{ ...metric("基层是陌生材料"), type: "ENTITY", field: "substrateMaterial", entityText: "陌生材料", resolvedText: "陌生材料", metric: null, value: null, operator: null }]);
    const query = applySemanticQuery(message, proposal, { entities: [], aliases: [] });
    expect(query.unresolved).toContainEqual(expect.objectContaining({ field: "substrateMaterial" }));
  });
  it("仅品牌提示仍按原文硬匹配，不因去品牌归一为空而漏查，也不接受其他品牌", () => {
    const query = { systemHint: "VICP", filters: [{ metric: "K" as const, targetValue: .3, mode: "APPROX" as const }] };
    expect(validateCandidateAgainstQueryState({ systemName: "III型VICP薄抹灰外保温系统", kValue: .302 }, query).passed).toBe(true);
    expect(validateCandidateAgainstQueryState({ systemName: "岩棉薄抹灰外保温系统", kValue: .302 }, query).passed).toBe(false);
  });
  it("图集名称、型号与构造是文本/工程编码硬约束，不要求存在同名目录ID", () => {
    const message = "III型 VICP 薄抹灰 A3-2 45mm";
    const entity = (field: "systemHint" | "specClass" | "schemeCode", text: string) => ({ ...metric(text), type: "ENTITY" as const,
      field, entityText: text, resolvedText: text, metric: null, operator: null, value: null });
    const query = applySemanticQuery(message, parsed([entity("systemHint", "III型 VICP 薄抹灰"), entity("specClass", "III型"), entity("schemeCode", "A3-2"),
      { ...metric("45mm", "EXACT", 45), type: "THICKNESS", metric: null }]), { entities: [], aliases: [] });
    expect(query).toMatchObject({ systemHint: "III型 VICP 薄抹灰", specClass: "III", schemeCode: "A3-2", thicknessMm: 45, unresolved: [] });
    expect(query.systemId).toBeUndefined(); expect(query.schemeId).toBeUndefined();
    expect(validateCandidateAgainstQueryState({ systemName: "III型VICP薄抹灰外保温系统", specClass: "II", schemeCode: "A3-2", thicknessMm: 45 }, query).passed).toBe(false);
  });
  it("真实UAT-06纠正指标替换旧R，保留实体和厚度；追加指标仍AND，伪造替换不删除旧条件", () => {
    const old = { specClass: "III" as const, thicknessMm: 45, metric: "PRODUCT_R" as const, targetValue: 8.3,
      filters: [{ metric: "PRODUCT_R" as const, mode: "APPROX" as const, targetValue: 8.3 }] };
    const message = "我刚才说错了，我想查的是传热系数 K 在 0.3 左右。";
    const next = applySemanticQuery(message, parsed([{ ...metric(message), operation: "REPLACE" }], "REFINE_QUERY"), dictionary, old);
    expect(next).toMatchObject({ specClass: "III", thicknessMm: 45, metric: "K", targetValue: .3, filters: [{ metric: "K", targetValue: .3 }] });
    expect(old.filters[0]?.metric).toBe("PRODUCT_R");
    const added = applySemanticQuery("同时K在0.3左右", parsed([metric("K在0.3左右")], "REFINE_QUERY"), dictionary, old);
    expect(added.filters?.map(f => f.metric)).toEqual(["PRODUCT_R", "K"]);
    const invalid = applySemanticQuery(message, parsed([{ ...metric(message, "APPROX", .9), operation: "REPLACE" }], "REFINE_QUERY"), dictionary, old);
    expect(invalid.filters?.map(f => f.metric)).toEqual(["PRODUCT_R"]);
    expect(invalid.unresolved?.length).toBeGreaterThan(0);
  });
  it("Normalizer只改变格式，Fast Path只接受完整符号语法", () => {
    expect(normalizeSemanticText("Ｋ＝０．３，Ｒ₀ ≥ ３．３ ㎡·K/W")).toBe("K=0.3,R0 ≥ 3.3 m²·K/W");
    expect(parseSemanticFastPath("Ｋ <= ０．３")?.constraints[0]).toMatchObject({ metric: "K", operator: "MAX_LIMIT", value: 0.3 });
    expect(parseSemanticFastPath("K卡在0.3附近")).toBeNull();
  });
  it.each(["K正好0.3", "K是不是正好0.3", "K大概0.3", "K在0.3上下", "K别超过0.3", "K至少0.3", "K卡在0.3附近"])("语义分类的原话数字可验证：%s", message => {
    const op = message.includes("正好") ? "EXACT" : message.includes("超过") ? "MAX_LIMIT" : message.includes("至少") ? "MIN_LIMIT" : "APPROX";
    expect(applySemanticQuery(message, parsed([metric(message, op)]), dictionary).filters?.[0]).toMatchObject({ mode: op, targetValue: 0.3 });
  });
  it("开放口语由分类结果投影，族集合保持硬条件", () => {
    const message = "我想看看那种薄抹灰的，K差不多0.3，别超过20厚";
    const constraints: SemanticQuery["constraints"] = [
      { ...metric("薄抹灰"), type: "ENTITY", field: "systemId", entityText: "薄抹灰", resolvedText: "薄抹灰", metric: null, operator: null, value: null },
      metric("K差不多0.3"),
      { ...metric("别超过20厚", "MAX_LIMIT", 20), type: "THICKNESS", metric: null }
    ];
    const query = applySemanticQuery(message, parsed(constraints), dictionary);
    expect(query).toMatchObject({ systemIds: ["sys-i", "sys-ii"], thicknessMax: 20, filters: [{ metric: "K", mode: "APPROX", targetValue: 0.3 }] });
    expect(validateCandidateAgainstQueryState({ systemId: "sys-board", thicknessMm: 18, kValue: 0.301 }, query).passed).toBe(false);
  });
  it.each(["板自身R做到8.3有吗", "保温板自身热阻，有传热8.3的板么"])("唯一产品指标绑定远处目标：%s", message => {
    const query = applySemanticQuery(message, parsed([metric(message, "APPROX", 8.3, "PRODUCT_R")]), dictionary);
    expect(query.unresolved).toEqual([]);
    expect(query.filters?.[0]).toMatchObject({ metric: "PRODUCT_R", targetValue: 8.3 });
  });
  it("NEW清旧指标，CONTINUE追加厚度，REFINE只替换厚度", () => {
    const old = { filters: [{ metric: "PRODUCT_R" as const, targetValue: 8.3, mode: "APPROX" as const }] };
    const fresh = applySemanticQuery("薄抹灰K0.3有哪些方案", parsed([
      { ...metric("薄抹灰"), type: "ENTITY", field: "systemId", entityText: "薄抹灰", resolvedText: null, metric: null, operator: null, value: null }, metric("K0.3")
    ]), dictionary, old);
    expect(fresh.filters?.map(filter => filter.metric)).toEqual(["K"]);
    const follow = applySemanticQuery("那20以内呢", parsed([{ ...metric("20以内", "MAX_LIMIT", 20), type: "THICKNESS", metric: null }], "CONTINUE_QUERY"), dictionary, fresh);
    expect(follow).toMatchObject({ systemIds: ["sys-i", "sys-ii"], thicknessMax: 20, filters: [{ metric: "K" }] });
    const refine = applySemanticQuery("厚度改成25以内", parsed([{ ...metric("25以内", "MAX_LIMIT", 25), type: "THICKNESS", metric: null }], "REFINE_QUERY"), dictionary, follow);
    expect(refine.thicknessMax).toBe(25); expect(refine.filters).toEqual(follow.filters);
  });
  it("重复构造编号必须消歧，已知体系上下文可定位", () => {
    expect(resolveQueryEntities("A1-3", {}, dictionary.entities).unresolved).toContainEqual(expect.objectContaining({ field: "schemeId" }));
    expect(resolveQueryEntities("A1-3", {}, dictionary.entities, [], { systemId: "sys-i" }).schemeId).toBe("scheme-i");
    expect(resolveQueryEntities("A1-30 18mm", {}, dictionary.entities, [], { systemId: "sys-i" }).schemeId).toBeUndefined();
  });
  it("切型号清旧规格和产品；同族追问保留方案依赖", () => {
    const old = { systemIds: ["sys-i", "sys-ii"], schemeId: "scheme-i", specClass: "I" as const, productSpecId: "old-spec", catalogProductId: "old-product", thicknessMm: 18 };
    const sameFamily = resolveQueryEntities("薄抹灰", {}, dictionary.entities, [], old);
    expect(sameFamily.schemeId).toBe("scheme-i");
    const entities = [...dictionary.entities, { field: "specClass" as const, value: "II", names: ["II型", "Ⅱ型"] }];
    const next = applySemanticQuery("Ⅱ型呢", parsed([{ ...metric("Ⅱ型"), type: "ENTITY", field: "specClass", entityText: "Ⅱ型", resolvedText: "II型", metric: null, operator: null, value: null }], "REFINE_QUERY"), { ...dictionary, entities }, old);
    expect(next.specClass).toBe("II"); expect(next.productSpecId).toBeUndefined(); expect(next.catalogProductId).toBeUndefined(); expect(next.thicknessMm).toBe(18);
  });
  it("Fuzzy只给模型目录建议；模型不得省略族条件或返回未知实体", () => {
    expect(suggestQueryEntities("那种抹灰的保温系统", dictionary.entities, dictionary.aliases).some(entity => entity.value === "sys-i")).toBe(true);
    expect(applySemanticQuery("薄抹灰K0.3", parsed([metric("K0.3")]), dictionary).unresolved?.some(item => item.field === "systemId")).toBe(true);
    const unknown = { ...metric("那种抹灰的保温系统"), type: "ENTITY" as const, field: "systemId" as const,
      entityText: "那种抹灰的保温系统", resolvedText: "不存在的体系", metric: null, operator: null, value: null };
    expect(applySemanticQuery("那种抹灰的保温系统", parsed([unknown]), dictionary).unresolved?.length).toBeGreaterThan(0);
  });
  it("局部厚度上限更新/取消保留下限，取消全部厚度清偏好", () => {
    const old = { thicknessMin: 18, thicknessMax: 20, preferThinner: true };
    const refined = applySemanticQuery("厚度上限改成25以内", parsed([{ ...metric("25以内", "MAX_LIMIT", 25), type: "THICKNESS", metric: null }], "REFINE_QUERY"), dictionary, old);
    expect(refined).toMatchObject({ thicknessMin: 18, thicknessMax: 25 });
    const removed = applySemanticQuery("取消厚度上限", parsed([{ ...metric("取消厚度上限", "MAX_LIMIT"), type: "THICKNESS", operation: "REMOVE", metric: null, value: null }], "REFINE_QUERY"), dictionary, refined);
    expect(removed.thicknessMin).toBe(18); expect(removed.thicknessMax).toBeUndefined();
    const clear = applySemanticQuery("不限制厚度", parsed([{ ...metric("不限制厚度"), type: "THICKNESS", operation: "REMOVE", metric: null, operator: null, value: null }], "REFINE_QUERY"), dictionary, old);
    expect(clear.thicknessMin).toBeUndefined(); expect(clear.preferThinner).toBeUndefined();
  });
  it("基层厚度与保温厚度保持两个独立硬条件", () => {
    const query = applySemanticQuery("基层240mm，保温18mm", parsed([
      { ...metric("基层240mm", "EXACT", 240), type: "THICKNESS", field: "substrateThickness", metric: null },
      { ...metric("保温18mm", "EXACT", 18), type: "THICKNESS", metric: null }
    ]), dictionary);
    expect(query).toMatchObject({ substrateThickness: 240, thicknessMm: 18, unresolved: [] });
  });
  it("无entityText的基层厚度提案只覆盖基层数值，不把它当板厚或掩盖另一板厚", () => {
    const substrate = { ...metric("200mm基层", "EXACT", 200), type: "THICKNESS" as const, field: "substrateThickness" as const, entityText: null, metric: null };
    expect(applySemanticQuery("200mm基层", parsed([substrate]), dictionary)).toMatchObject({ substrateThickness: 200, unresolved: [] });
    const missingBoard = applySemanticQuery("200mm基层，保温32mm", parsed([substrate]), dictionary);
    expect(missingBoard.unresolved?.length).toBeGreaterThan(0);
    expect(missingBoard.thicknessMm).toBeUndefined();
  });
  it("EXACT失败只保留指定身份厚度，不跳体系或厚度", () => {
    const rows = [
      { id: "r1", systemId: "sys-i", schemeId: "scheme-i", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.303 },
      { id: "r2", systemId: "sys-board", schemeId: "scheme-board", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.3 },
      { id: "r3", systemId: "sys-i", schemeId: "scheme-i", schemeCode: "A1-3", thicknessMm: 70, kValue: 0.3 }
    ];
    const query = { systemId: "sys-i", schemeCode: "A1-3", thicknessMm: 18, filters: [{ metric: "K" as const, targetValue: 0.3, mode: "EXACT" as const }] };
    expect(rows.filter(row => validateCandidateAgainstQueryState(row, query).passed)).toEqual([]);
    expect(identityMetricFailures(rows, query).map(item => item.candidate.id)).toEqual(["r1"]);
    expect(new Set(rows.map(candidateIdentity)).size).toBe(3);
  });
  it("拒绝模型数值、页号、年份、OR、未知实体及低置信结果", () => {
    for (const message of ["K0.3", "第22页", "2026年", "A1-3"]) expect(applySemanticQuery(message, parsed([metric(message, "EXACT", 22)]), dictionary).unresolved?.length).toBeGreaterThan(0);
    expect(describeNumberRoles("A1-3 18mm 第22页 2026年").map(item => item.role)).toEqual(["SCHEME_CODE_PART", "SCHEME_CODE_PART", "THICKNESS", "PAGE_NUMBER", "YEAR"]);
    expect(applySemanticQuery("K0.3或者总R3.3", parsed([metric("K0.3")]), dictionary).unresolved?.some(item => item.field === "relationship")).toBe(true);
  });
});

it("某一字段的未决原因不得污染其他已由原话唯一绑定的字段；总查询仍保留来源门禁",()=>{
 const message="甲表的钢筋混凝土基层180mm";
 const source={id:"00000000-0000-4000-8000-000000000001",code:"A",name:"甲资料",source:"甲表",reference:"页一"};
 const q=applySemanticQuery(message,{...parsed([{type:"ENTITY",operation:"SET",field:"substrateMaterial",entityText:"钢筋混凝土",resolvedText:null,metric:null,operator:null,value:null,evidence:"钢筋混凝土",hard:true,confidence:.99}]),confidence:.86,sourceScope:{kind:"REFERENCE_SET",ids:[source.id],evidence:"甲表"}},
 {entities:[{field:"substrateMaterial",value:"钢筋混凝土",names:["钢筋混凝土"]}],aliases:[],sourceSets:[source]});
 expect(q.substrateMaterial).toBe("钢筋混凝土");expect(q.referenceSetIds).toBeUndefined();
 expect(q.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({field:"referenceSetIds"})]));
 expect(q.unresolved?.some(item=>item.reason.includes("多个记录")||item.reason.includes("对象未被完整"))).toBe(false);
});

describe("已验证的基层厚度只占用对应毫米标量", () => {
  const base = (value: number, evidence: string): SemanticQuery["constraints"][number] => ({ type: "THICKNESS", operation: "SET",
    field: "substrateThickness", entityText: evidence, resolvedText: null, metric: null, operator: "EXACT", value,
    evidence, hard: true, confidence: .99 });
  it.each([170, 180, 240])("上下文实体文本不把%dmm基层再要求成板厚", value => {
    const evidence = `既有基层${value}mm`;
    const q = applySemanticQuery(evidence, parsed([base(value, evidence)]), dictionary);
    expect(q.substrateThickness).toBe(value); expect(q.thicknessMm).toBeUndefined();
    expect(q.unresolved).toEqual([]);
  });
  it("同句另一块板的厚度仍独立校验，不能因基层已绑定而漏掉", () => {
    const evidence = "基层180mm", message = `${evidence}，保温板厚25mm`;
    const missing = applySemanticQuery(message, parsed([base(180, evidence)]), dictionary);
    expect(missing.unresolved?.some(item => item.field === "thicknessMm")).toBe(true);
    const board: SemanticQuery["constraints"][number] = { ...base(25, "25mm"), field: null };
    const q = applySemanticQuery(message, parsed([base(180, evidence), board]), dictionary);
    expect(q).toMatchObject({ substrateThickness: 180, thicknessMm: 25, unresolved: [] });
  });
  it("不凭实体描述改数值，也不把基层范围伪装为确定标量", () => {
    for (const [message, value] of [["基层180mm", 200], ["基层不低于180mm", 180]] as const) {
      expect(applySemanticQuery(message, parsed([base(value, message)]), dictionary).unresolved?.length).toBeGreaterThan(0);
    }
  });
});
