import type { DomainTurnDecision } from "./ai-domain-turn-decision.js";
import { approvedCatalogAliases } from "../products/product-identity-approvals.js";
import { compactProductKnowledgeItem, type ProductKnowledgeItem } from "./product-knowledge-facts.js";
import { renderProductParameterFacts } from "./product-parameter-presentation.js";

/**
 * 产品咨询的「事实」与「解释组织」分离。
 *
 * 真实失败：`你们 VICP 产品主要有什么？我不是工程师，简单介绍` 只回了一串 λ/α/板厚/型号分类。
 * 根因不是事实缺失——正式目录查询是正确的——而是事实取得后直接用固定模板直出，
 * 表达目标（介绍/技术参数/客户介绍）没有参与组织，模型也没有机会解释这些事实。
 *
 * 本模块只做三件事，且都不产生新事实：
 * 1. 依据 Semantic 已给出的 intent 与 audience 选择表达形态（不读关键词、不做意图识别）；
 * 2. 生成确定性的「仅事实」回答，用于澄清、无结果、模型不可用与校验失败回落；
 * 3. 校验模型回答里的工程数值是否出自已核验事实，越界即回落，避免自由发挥。
 *
 * 事实边界：产品名称、summary、型号、板厚、λ、α、规格与关联资料标题全部来自
 * searchProductCatalog（ACTIVE 目录 + 已发布规格 + 当前有权资料）。本模块不补写用途、
 * 优势、认证、节能率或竞品结论，没有资料支持的一律不出现。
 */

export type ProductAudience = "GENERAL" | "SALES" | "ENGINEER" | "UNSPECIFIED";
export type ProductAnswerMode = "INTRODUCTION" | "TECHNICAL" | "SALES";

export interface ProductFactSpec {
  specCode: string;
  specClass: string | null;
  thicknessMm: number | null;
  combustionGrade: string | null;
}

export interface ProductFact {
  id: string;
  name: string;
  summary: string | null;
  productType: string | null;
  specClass: string | null;
  thicknessOptionsMm: number[];
  thermalConductivity: number | null;
  correctionFactor: number | null;
  specifications: ProductFactSpec[];
  hasTechnicalDocs: boolean;
  approvedAliases?: string[];
}

export interface ProductKnowledgeFamily {
  name: string;
  pageCount: number;
  layerNames: string[];
}

export interface ProductAnswerFacts {
  mode: ProductAnswerMode;
  audience: ProductAudience;
  products: ProductFact[];
  sources: Array<{ documentId: string; versionId: string; title: string }>;
  hasMore: boolean;
  seriesRequested?: boolean;
  brief?: boolean;
  /** 当前产品咨询的信息目标，不因进入目录读取而退化为默认概览。 */
  informationNeed?: "PROS_CONS";
  /** 已发布知识库中可核对的构造系统/产品族；不是可销售 SKU。 */
  knowledgeFamilies?: ProductKnowledgeFamily[];
  knowledgeItems?: ProductKnowledgeItem[];
  parameterExplanation?: string;
  parameterFilter?: { field: "LAMBDA" | "CORRECTION" | "THICKNESS"; operator: "READ" | "EXACT" | "LT" | "LTE" | "GT" | "GTE";
    targetValue: number; unit: string; scope: string; referenceName: string };
}

/** 只消费 Semantic 决策：intent 决定技术深度，audience 只调整表达，不改变事实与授权。 */
export function resolveProductAnswerMode(decision?: Pick<DomainTurnDecision, "intent" | "semantic"> | null): { mode: ProductAnswerMode; audience: ProductAudience } {
  const audience: ProductAudience = decision?.semantic?.audience ?? "UNSPECIFIED";
  if (decision?.semantic?.productContinuation?.action === "REPHRASE")
    return { mode: audience === "ENGINEER" ? "TECHNICAL" : "INTRODUCTION", audience };
  // 受众只调整表达深度，不能把已明确的参数读取目标退回产品概览。
  if (decision?.semantic?.productContinuation) return { mode: "TECHNICAL", audience };
  if (audience === "ENGINEER") return { mode: "TECHNICAL", audience };
  if (audience === "SALES") return { mode: "SALES", audience };
  if (audience === "GENERAL") return { mode: "INTRODUCTION", audience };
  return { mode: decision?.intent === "PRODUCT_DETAIL" ? "TECHNICAL" : "INTRODUCTION", audience };
}

export function buildProductAnswerFacts(input: {
  products: Array<{ id: string; name: string; summary: string | null; productType: string | null; specClass: string | null;
    thermalConductivity: number | null; correctionFactor: number | null; thicknessOptionsMm: number[] | null;
    specifications: Array<{ specCode: string; specClass: string | null; thicknessMm: number | null; combustionGrade: string | null }>;
    knowledgeDocumentIds: string[] }>;
  sources: Array<{ documentId: string; versionId: string; title: string }>;
  hasMore: boolean;
  knowledgeFamilies?: ProductKnowledgeFamily[];
  knowledgeItems?: ProductKnowledgeItem[];
  decision?: Pick<DomainTurnDecision, "intent" | "semantic"> | null;
}): ProductAnswerFacts {
  const { mode, audience } = resolveProductAnswerMode(input.decision);
  return {
    mode, audience, hasMore: input.hasMore, seriesRequested: input.decision?.semantic?.productQuery?.granularity === "SERIES",
    ...(input.decision?.semantic?.adviceFocus === "PROS_CONS" ? { informationNeed: "PROS_CONS" as const } : {}),
    ...(input.decision?.semantic?.productContinuation?.action === "REPHRASE" ? { brief: true } : {}),
    knowledgeFamilies: input.knowledgeFamilies?.slice(0, 12),
    knowledgeItems: input.knowledgeItems?.slice(0, 12).map(compactProductKnowledgeItem),
    sources: [...new Map(input.sources.map(source => [JSON.stringify([source.documentId, source.versionId]),
      { documentId: source.documentId, versionId: source.versionId, title: source.title }])).values()],
    products: input.products.map(item => ({
      id: item.id, name: item.name, summary: item.summary, productType: item.productType, specClass: item.specClass,
      thicknessOptionsMm: [...(item.thicknessOptionsMm ?? [])], thermalConductivity: item.thermalConductivity,
      correctionFactor: item.correctionFactor, hasTechnicalDocs: item.knowledgeDocumentIds.length > 0,
      approvedAliases: approvedCatalogAliases(input.products).filter(alias => alias.term === item.name).map(alias => alias.alias),
      specifications: item.specifications.map(spec => ({ specCode: spec.specCode, specClass: spec.specClass,
        thicknessMm: spec.thicknessMm, combustionGrade: spec.combustionGrade }))
    }))
  };
}

export interface ProductAnswerVerdict { passed: boolean; code: "VERIFIED" | "UNSUPPORTED_NUMBER" | "EMPTY"; unsupported: string[] }

/**
 * 兼容旧调用的工程字段校验，不证明自由文本全部真实；正式产品回答使用product-answer-plan绑定事实引用。
 * 用户查询目标不是产品事实。多个产品的属性不得通过数字集合互相借用。
 */
export function validateProductAnswer(text: string, facts: ProductAnswerFacts, _question = ""): ProductAnswerVerdict {
  if (!text.trim()) return { passed: false, code: "EMPTY", unsupported: [] };
  const unsupported: string[] = [];
  const product = facts.products.length === 1 ? facts.products[0] : undefined;
  const check = (token: string, values: Array<number | null | undefined>) => { if (!values.some(value => value === Number(token))) unsupported.push(token); };
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|毫米|㎜)/gi)) check(match[1]!, product ? [...product.thicknessOptionsMm, ...product.specifications.map(spec=>spec.thicknessMm)] : []);
  for (const match of text.matchAll(/(?:λ|导热系数|α|修正系数|K值|R0|R₀|\bK\b|\bR\b)\s*(?:值)?\s*(?:=|≈|:|：|为|是)?\s*(\d+(?:\.\d+)?)/g)) {
    const lambda = /λ|导热系数/.test(match[0]);
    const alpha = /α|修正系数/.test(match[0]);
    check(match[1]!, product && (lambda || alpha) ? [lambda ? product.thermalConductivity : product.correctionFactor] : []);
  }
  return unsupported.length ? { passed: false, code: "UNSUPPORTED_NUMBER", unsupported } : { passed: true, code: "VERIFIED", unsupported: [] };
}

/** 确定性「仅事实」回答：澄清、无结果、模型不可用与校验失败时使用，不新增任何结论。 */
export function formatProductFactsAnswer(facts: ProductAnswerFacts): string {
  if (facts.informationNeed === "PROS_CONS" && (facts.products.length || facts.knowledgeItems?.length)
    && !facts.products.some(product => product.summary?.trim())) {
    const fields = new Set((facts.knowledgeItems ?? []).flatMap(item => item.attributes.map(attribute => attribute.key)));
    for (const product of facts.products) {
      if (product.thermalConductivity != null) fields.add("LAMBDA");
      if (product.correctionFactor != null) fields.add("CORRECTION");
      if (product.thicknessOptionsMm.length) fields.add("THICKNESS");
    }
    const labels = (["LAMBDA", "CORRECTION", "THICKNESS"] as const).filter(field => fields.has(field))
      .map(field => ({ LAMBDA: "导热系数", CORRECTION: "修正系数", THICKNESS: "厚度" })[field]);
    return "本次查到的主要是热工参数，暂不足以概括产品的整体优势和不足。"
      + (labels.length ? `可以先帮你核对${labels.join("、")}及其来源；` : "")
      + "防火、施工和成本等方面，还需要对应资料才能判断。";
  }
  if (facts.mode === "TECHNICAL" && (facts.products.length || facts.knowledgeItems?.length))
    return renderProductParameterFacts(facts);
  if (facts.knowledgeItems?.length) {
    if (facts.mode !== "TECHNICAL") {
      const names = [...new Set(facts.knowledgeItems.map(item => item.name))];
      const fields = [...new Set(facts.knowledgeItems.flatMap(item => item.attributes.map(attribute => attribute.key === "THICKNESS" ? "厚度" : "保温参数")))];
      const product = facts.products.find(item => item.approvedAliases?.length);
      const limit = facts.brief ? 1 : facts.seriesRequested ? 6 : 2;
      // 简称与知识库概览分别表达；单一目录项不能遮掉原表中确实存在的其他名称。
      const opening = (product ? `${product.approvedAliases![0]}是“${product.name}”的简称。` : "")
        + `现有知识库里有${names.slice(0, limit).join("、")}${names.length > limit || facts.hasMore ? "等原表记录" : "的原表记录"}。`;
      return opening + (fields.length ? `可以查到对应做法的${fields.join("和")}。` : "")
        + (facts.brief ? "可以继续问具体参数。" : "你可以继续问具体参数，或告诉我墙体材料和厚度，我帮你找参考做法。");
    }
    const lines = facts.knowledgeItems.map(item => {
      if (facts.mode !== "TECHNICAL") {
        const labels = [...new Set(item.attributes.map(attribute => attribute.key === "LAMBDA" ? "导热系数" : attribute.key === "CORRECTION" ? "修正系数" : "原表档位厚度"))];
        return `- ${item.name}${labels.length ? `（可查${labels.join("、")}）` : ""}`;
      }
      const attributes = [...new Map(item.attributes.map(attribute => [JSON.stringify([attribute.key, attribute.value, attribute.scope]),
        (attribute.key === "LAMBDA" ? `材料层 λ=${attribute.value} ${attribute.unit}`
          : attribute.key === "CORRECTION" ? `修正系数 α=${attribute.value}` : `原表档位厚度 ${attribute.value}mm`)
          + `〔${attribute.source.pageLabel ? `第${attribute.source.pageLabel}页` : "页码待核"}，${attribute.source.constructionName}〕`])).values()];
      return `- ${item.name}：${attributes.join("；")}。`;
    });
    const supplement = facts.products.length ? `\n\n目录另登记：${facts.products.map(product => product.name).join("、")}。` : "";
    const warnings = facts.mode === "TECHNICAL" ? [...new Set(facts.knowledgeItems.flatMap(item => item.warnings))].slice(0, 6) : [];
    return `${facts.parameterExplanation ? facts.parameterExplanation + "\n\n" : ""}目前知识资料中可以查到这些产品/材料层：\n${lines.join("\n")}${supplement}\n原表参数适用于对应构造中的材料层，档位厚度不代表完整供货规格；可继续查看某一项的参数和来源。${warnings.length ? `\n原表待核：${warnings.join("；")}` : ""}`;
  }
  if (!facts.products.length) {
    const prefix = facts.knowledgeFamilies?.length
      ? "目录里没有精确匹配到独立产品；已发布知识库中可核对以下构造系统："
      : "暂时未找到对应的产品资料。你可以告诉我产品名称或简称，我再帮你核对。";
    return appendKnowledgeFamilies(prefix, facts);
  }
  // 系列/全量问题先给知识库可核对范围，再补目录 SKU；不能先下“资料不完整”的结论。
  if (facts.seriesRequested && facts.knowledgeFamilies?.length) {
    const catalog = `正式产品目录当前登记：${facts.products.map(product => `${product.name}${product.thicknessOptionsMm.length ? `（${product.thicknessOptionsMm.join("/")}mm）` : ""}`).join("、")}。`;
    return appendKnowledgeFamilies(catalog, facts);
  }
  if (facts.mode === "TECHNICAL") {
    return appendKnowledgeFamilies(`当前正式产品目录${facts.hasMore ? "中部分产品" : "检索结果"}：\n${facts.products.map(product => {
      const specs = product.specifications.map(spec => `${spec.specCode}${spec.thicknessMm != null ? `/${spec.thicknessMm}mm` : ""}`).join("、");
      return `${product.name}${product.productType ? `（${product.productType}）` : ""}${product.specClass ? `，${product.specClass}型` : ""}`
        + `${product.thicknessOptionsMm.length ? `；可选板厚 ${product.thicknessOptionsMm.join("/")}mm` : ""}`
        + `${product.thermalConductivity != null ? `；λ=${product.thermalConductivity}` : ""}`
        + `${product.correctionFactor != null ? `；α=${product.correctionFactor}` : ""}`
        + `${specs ? `；已发布规格 ${specs}` : ""}`;
    }).join("\n")}`, facts);
  }
  const base = facts.products.map(product => {
    const name = product.approvedAliases?.length ? `${product.approvedAliases.join("、")} 是“${product.name}”的简称。` : `${product.name}。`;
    const fields = [product.thermalConductivity != null ? "导热系数" : null, product.correctionFactor != null ? "修正系数" : null,
      product.thicknessOptionsMm.length ? "板厚" : null].filter(Boolean);
    return name + (product.summary ?? "") + (fields.length ? `资料里可以查到它的${fields.join("、")}。` : "");
  }).join("\n");
  return appendKnowledgeFamilies(base, facts);
}

/** 知识库构造系统/产品族只作可核对范围说明，不能包装成可销售系列。 */
export function appendKnowledgeFamilies(answer: string, facts: ProductAnswerFacts): string {
  const families = facts.knowledgeFamilies ?? [];
  if (!families.length) return answer;
  const lines = families.map(family => `- ${family.name}（${family.pageCount} 页${family.layerNames.length ? `；产品层/材料层：${family.layerNames.slice(0, 4).join("、")}` : ""}）`);
  const catalogNote = facts.products.length
    ? `独立产品目录只登记 ${facts.products.length} 款，不能据此判断甲方产品总数。`
    : "独立产品目录当前未匹配到独立产品，不能据此判断甲方没有这些构造系统。";
  return `${answer}\n\n已发布知识库中可核对的构造系统/产品族：\n${lines.join("\n")}\n这些是构造系统或产品层，不等于已确认的可销售型号；${catalogNote}`;
}

/**
 * 产品咨询的回答路径：事实始终由服务提供；只有模型可用、有事实、且不需要澄清时才由模型组织表达。
 * 其余情况（澄清、目录无结果、模型不可用）一律用确定性仅事实回答，不能让空事实进入自由生成。
 */
export function planProductAnswer(input: { needsClarification: boolean; facts: ProductAnswerFacts; modelAvailable: boolean }): "FACTS_ONLY" | "MODEL_WITH_FACT_CHECK" {
  if (input.facts.knowledgeFamilies?.length && !input.facts.knowledgeItems?.length) return "FACTS_ONLY";
  return !input.needsClarification && (input.facts.products.length > 0 || (input.facts.knowledgeItems?.length ?? 0) > 0)
    && input.modelAvailable ? "MODEL_WITH_FACT_CHECK" : "FACTS_ONLY";
}

/** 给回答模型的表达边界：事实来自 facts，表达随目标变化，不得新增结论。 */export function formatProductAnswerInstructions(facts: ProductAnswerFacts): string {
  const modeRule = facts.mode === "TECHNICAL"
    ? "本轮是技术参数目标：给出准确产品名称、型号、可选板厚、λ、α 与已发布规格；不要用营销措辞替代参数。"
    : facts.mode === "SALES"
      ? "本轮面向客户介绍：用业务语言说明这是什么产品、属于哪一类、有资料支持的特点；可以指出可查看的正式资料，但不能编造优势、认证或竞品结论。"
      : "本轮是介绍性目标：先用容易理解的语言说明这是什么产品、属于哪一类、解决什么问题；不要一上来罗列 λ、α、板厚和型号分类。";
  const summaryRule = facts.products.some(product => (product.summary ?? "").trim())
    ? "介绍内容只能来自 name 与 summary；summary 没写的用途、场景、效果一律不补。"
    : "这些产品当前没有已审核的介绍文案，只能说明名称与已有技术字段，并告知可查看原始资料。";
  return [
    "【产品事实使用边界】",
    modeRule,
    summaryRule,
    "回答中的板厚、λ、α、规格编号必须与下面的事实 JSON 完全一致，不得四舍五入、换算或补充未列出的参数。",
    "不得补充未审核的宣传结论（行业领先、节能百分比、寿命年限、获奖或认证），也不得与其他品牌做比较。",
    "只有事实 JSON 里出现的内容才能说；不确定就说明需要查看正式资料。",
    `【已核验产品事实】${JSON.stringify({ mode: facts.mode, audience: facts.audience, products: facts.products, sources: facts.sources, knowledgeFamilies: facts.knowledgeFamilies ?? [] })}`
  ].join("\n");
}
