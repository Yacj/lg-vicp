import type { DomainTurnDecision } from "./ai-domain-turn-decision.js";

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
}

export interface ProductAnswerFacts {
  mode: ProductAnswerMode;
  audience: ProductAudience;
  products: ProductFact[];
  sources: Array<{ documentId: string; versionId: string; title: string }>;
  hasMore: boolean;
}

/** 只消费 Semantic 决策：intent 决定技术深度，audience 只调整表达，不改变事实与授权。 */
export function resolveProductAnswerMode(decision?: Pick<DomainTurnDecision, "intent" | "semantic"> | null): { mode: ProductAnswerMode; audience: ProductAudience } {
  const audience: ProductAudience = decision?.semantic?.audience ?? "UNSPECIFIED";
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
  decision?: Pick<DomainTurnDecision, "intent" | "semantic"> | null;
}): ProductAnswerFacts {
  const { mode, audience } = resolveProductAnswerMode(input.decision);
  return {
    mode, audience, hasMore: input.hasMore,
    sources: input.sources.map(source => ({ documentId: source.documentId, versionId: source.versionId, title: source.title })),
    products: input.products.map(item => ({
      id: item.id, name: item.name, summary: item.summary, productType: item.productType, specClass: item.specClass,
      thicknessOptionsMm: [...(item.thicknessOptionsMm ?? [])], thermalConductivity: item.thermalConductivity,
      correctionFactor: item.correctionFactor, hasTechnicalDocs: item.knowledgeDocumentIds.length > 0,
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
  if (!facts.products.length) return "正式产品目录未找到符合条件的产品，不能补写不存在的型号或参数。";
  const nameOf = (product: ProductFact) => `${product.name}${product.productType ? `（${product.productType}）` : ""}`;
  if (facts.mode === "TECHNICAL") {
    return `当前正式产品目录${facts.hasMore ? "中部分产品" : "检索结果"}：\n${facts.products.map(product => {
      const specs = product.specifications.map(spec => `${spec.specCode}${spec.thicknessMm != null ? `/${spec.thicknessMm}mm` : ""}`).join("、");
      return `${product.name}${product.productType ? `（${product.productType}）` : ""}${product.specClass ? `，${product.specClass}型` : ""}`
        + `${product.thicknessOptionsMm.length ? `；可选板厚 ${product.thicknessOptionsMm.join("/")}mm` : ""}`
        + `${product.thermalConductivity != null ? `；λ=${product.thermalConductivity}` : ""}`
        + `${product.correctionFactor != null ? `；α=${product.correctionFactor}` : ""}`
        + `${specs ? `；已发布规格 ${specs}` : ""}`;
    }).join("\n")}`;
  }
  const lines = facts.products.map(product => `- ${nameOf(product)}${product.summary ? `：${product.summary}` : ""}`);
  const tail = facts.mode === "SALES"
    ? "对外介绍产品性能、适用场景与优势时，须以这里列出的已发布资料为依据；资料未写的内容不补。"
    : "更详细的型号、板厚和热工参数可以在你问到具体产品时展开；适用场景与效果结论须以已发布资料为依据。";
  return `当前正式产品目录${facts.hasMore ? "中部分产品" : "检索结果"}：\n${lines.join("\n")}\n${tail}`;
}

/**
 * 产品咨询的回答路径：事实始终由服务提供；只有模型可用、有事实、且不需要澄清时才由模型组织表达。
 * 其余情况（澄清、目录无结果、模型不可用）一律用确定性仅事实回答，不能让空事实进入自由生成。
 */
export function planProductAnswer(input: { needsClarification: boolean; facts: ProductAnswerFacts; modelAvailable: boolean }): "FACTS_ONLY" | "MODEL_WITH_FACT_CHECK" {
  return !input.needsClarification && input.facts.products.length > 0 && input.modelAvailable ? "MODEL_WITH_FACT_CHECK" : "FACTS_ONLY";
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
    `【已核验产品事实】${JSON.stringify({ mode: facts.mode, audience: facts.audience, products: facts.products, sources: facts.sources })}`
  ].join("\n");
}
