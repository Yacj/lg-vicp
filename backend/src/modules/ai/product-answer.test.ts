import { describe, expect, it } from "vitest";
import { buildProductAnswerFacts, formatProductAnswerInstructions, formatProductFactsAnswer, planProductAnswer, resolveProductAnswerMode, validateProductAnswer } from "./product-answer.js";

it("通俗表达不删除用户所要的参数；参数续问仍使用事实读取，改写才回到概览", () => {
  const decision = { intent: "PRODUCT_DETAIL", semantic: { audience: "GENERAL", productContinuation: { action: "PARAMETERS", field: null } } } as any;
  expect(resolveProductAnswerMode(decision)).toEqual({ mode: "TECHNICAL", audience: "GENERAL" });
  decision.semantic.productContinuation.action = "REPHRASE";
  expect(resolveProductAnswerMode(decision)).toEqual({ mode: "INTRODUCTION", audience: "GENERAL" });
});

/**
 * 真实失败：`你们 VICP 产品主要有什么？我不是工程师，简单介绍`
 * 只返回 VICP 复合保温板、25mm、λ、α 的技术参数清单。
 * 这些数值本身没错，错在事实取得后由固定模板直出，表达目标没有参与。
 *
 * 本文件锁定的不变量：
 * 1. 介绍性目标用业务语言，不以 λ/α/型号分类开场；
 * 2. 技术目标才展开型号、板厚、λ、α；
 * 3. 模型回答里的工程数值必须出自已核验事实或用户原话，越界即回落；
 * 4. 资料没写的用途、优势、认证一律不补。
 */

const catalog = (overrides: Partial<Parameters<typeof buildProductAnswerFacts>[0]["products"][number]> = {}) => ({
  id: "p1", name: "VICP 复合保温板", summary: "用于建筑外墙与屋面的真空绝热复合板。", productType: "复合板", specClass: "II",
  thermalConductivity: 0.005, correctionFactor: 1.25, thicknessOptionsMm: [25, 30],
  specifications: [{ specCode: "VICP-25", specClass: "II", thicknessMm: 25, combustionGrade: "A" }], knowledgeDocumentIds: ["d1"], ...overrides });

const facts = (decision?: Parameters<typeof buildProductAnswerFacts>[0]["decision"], overrides: Parameters<typeof catalog>[0] = {}) => buildProductAnswerFacts({
  products: [catalog(overrides)], sources: [{ documentId: "d1", versionId: "v1", title: "VICP 产品技术资料" }], hasMore: false, decision });

it("单一目录简称不能遮掉知识库中的产品名称，系列概览和简短改写分别保留事实", () => {
  const f=facts({intent:"PRODUCT_DISCOVERY"} as never,{name:"VICP复合保温板",summary:null});
  f.seriesRequested=true;
  f.knowledgeItems=["甲型板材","乙型板材","丙型外模板"].map((name,i)=>({id:`k-${i}`,name,kind:"KNOWLEDGE_LAYER",attributes:[],sources:[],warnings:[]}));
  const overview=formatProductFactsAnswer(f);
  expect(overview).toContain("VICP是");
  for(const item of f.knowledgeItems)expect(overview).toContain(item.name);
  expect(overview).toContain("原表记录");expect(overview).not.toContain("供货范围");
  const brief=formatProductFactsAnswer({...f,brief:true});
  expect(brief).toContain("甲型板材");expect(brief).not.toContain("乙型板材");expect(brief.length).toBeLessThan(overview.length);
});
describe("产品表达形态只由 Semantic 决策决定", () => {
  it("只有事实可用且不需要澄清时才交给模型组织表达", () => {
    const withFacts = facts({ intent: "PRODUCT_DISCOVERY" } as never);
    expect(planProductAnswer({ needsClarification: false, facts: withFacts, modelAvailable: true })).toBe("MODEL_WITH_FACT_CHECK");
    expect(planProductAnswer({ needsClarification: true, facts: withFacts, modelAvailable: true })).toBe("FACTS_ONLY");
    expect(planProductAnswer({ needsClarification: false, facts: withFacts, modelAvailable: false })).toBe("FACTS_ONLY");
    expect(planProductAnswer({ needsClarification: false, facts: { ...withFacts, products: [] }, modelAvailable: true })).toBe("FACTS_ONLY");
  });
  it("产品目录介绍默认用介绍形态，不因存在 λ/α 就切技术清单", () => {
    expect(resolveProductAnswerMode({ intent: "PRODUCT_DISCOVERY", semantic: undefined } as never)).toEqual({ mode: "INTRODUCTION", audience: "UNSPECIFIED" });
  });
  it("用户自述不是工程师→介绍形态；自述工程背景→技术形态；自述销售→客户介绍形态", () => {
    expect(resolveProductAnswerMode({ intent: "PRODUCT_DETAIL", semantic: { audience: "GENERAL" } } as never).mode).toBe("INTRODUCTION");
    expect(resolveProductAnswerMode({ intent: "PRODUCT_DISCOVERY", semantic: { audience: "ENGINEER" } } as never).mode).toBe("TECHNICAL");
    expect(resolveProductAnswerMode({ intent: "PRODUCT_DISCOVERY", semantic: { audience: "SALES" } } as never).mode).toBe("SALES");
  });
});

describe("确定性仅事实回答", () => {
  it("介绍形态说清是什么产品，不罗列 λ、α 与型号分类", () => {
    const text = formatProductFactsAnswer(facts({ intent: "PRODUCT_DISCOVERY" } as never));
    expect(text).toContain("VICP 复合保温板");
    expect(text).toContain("用于建筑外墙与屋面的真空绝热复合板");
    expect(text).not.toContain("λ=");
    expect(text).not.toContain("α=");
  });
  it("技术形态给出准确型号、板厚、λ、α 与已发布规格", () => {
    const text = formatProductFactsAnswer(facts({ intent: "PRODUCT_DETAIL" } as never));
    expect(text).toContain("λ=0.005");
    expect(text).toContain("α=1.25");
    expect(text).toContain("25/30mm");
    expect(text).toContain("VICP-25/25mm");
  });
  it("资料没有介绍文案时只给名称与既有字段，不编造用途或优势", () => {
    const text = formatProductFactsAnswer(facts({ intent: "PRODUCT_DISCOVERY" } as never, { summary: null }));
    expect(text).toContain("VICP 复合保温板");
    expect(text).not.toMatch(/行业领先|节能\s*\d+%|寿命|获奖|认证/);
  });
});

describe("知识库产品族只作范围说明", () => {
  it("补充构造系统并明确不等于可销售型号，不被模型改写", () => {
    const withFamilies = buildProductAnswerFacts({ products: [catalog()], sources: [], hasMore: false,
      knowledgeFamilies: [{ name: "I型VICP薄抹灰外保温系统", pageCount: 2, layerNames: ["I型VICP复合保温板"] }],
      decision: { intent: "PRODUCT_DISCOVERY" } as never });
    const text = formatProductFactsAnswer(withFamilies);
    expect(text).toContain("已发布知识库中可核对");
    expect(text).toContain("I型VICP薄抹灰外保温系统");
    expect(text).toContain("不等于已确认的可销售型号");
    expect(planProductAnswer({ needsClarification: false, facts: withFamilies, modelAvailable: true })).toBe("FACTS_ONLY");
  });
  it("系列问题先给知识库范围，不先下资料不完整结论", () => {
    const series = buildProductAnswerFacts({ products: [catalog()], sources: [], hasMore: false,
      knowledgeFamilies: [{ name: "I型VICP薄抹灰外保温系统", pageCount: 2, layerNames: [] }],
      decision: { intent: "PRODUCT_DISCOVERY", semantic: { productQuery: { granularity: "SERIES" } } } as never });
    const text = formatProductFactsAnswer(series);
    expect(text.startsWith("正式产品目录当前登记")).toBe(true);
    expect(text).not.toContain("资料还不完整");
  });
});

describe("回答事实校验：工程数值必须出自已核验事实", () => {
  const base = facts({ intent: "PRODUCT_DETAIL" } as never);
  it("事实中的 λ、板厚通过校验", () => {
    expect(validateProductAnswer("VICP 复合保温板 λ=0.005，可选板厚 25mm 与 30mm。", base).passed).toBe(true);
  });
  it("编造的 λ 被拒绝并回落", () => {
    const verdict = validateProductAnswer("VICP 复合保温板 λ=0.008，保温效果更好。", base);
    expect(verdict.passed).toBe(false);
    expect(verdict.code).toBe("UNSUPPORTED_NUMBER");
    expect(verdict.unsupported).toEqual(["0.008"]);
  });
  it("编造的板厚被拒绝", () => {
    expect(validateProductAnswer("可选板厚 40mm。", base).code).toBe("UNSUPPORTED_NUMBER");
  });
  it("用户查询值不是已核验事实，兼容校验也不能放行", () => {
    expect(validateProductAnswer("λ=0.3", base, "λ0.3有没有").passed).toBe(false);
    expect(validateProductAnswer("λ=25", base).passed).toBe(false);
    expect(validateProductAnswer("导热系数为0.3 W/(m·K)", base).passed).toBe(false);
  });
  it("空回答不通过，避免用空串冒充通过", () => {
    expect(validateProductAnswer("   ", base)).toMatchObject({ passed: false, code: "EMPTY" });
  });
});

describe("模型回答边界", () => {
  it("介绍形态要求业务语言、只依据 name/summary、不编优势", () => {
    const instruction = formatProductAnswerInstructions(facts({ intent: "PRODUCT_DISCOVERY" } as never));
    expect(instruction).toContain("介绍性目标");
    expect(instruction).toContain("summary 没写的用途、场景、效果一律不补");
    expect(instruction).toContain("不得补充未审核的宣传结论");
    expect(instruction).toContain("VICP 复合保温板");
  });
  it("技术形态要求准确参数而非营销措辞", () => {
    expect(formatProductAnswerInstructions(facts({ intent: "PRODUCT_DETAIL" } as never))).toContain("技术参数目标");
  });
});
