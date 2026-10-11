import type { UatCase } from "../../schema.js";
import { A13, A14 } from "../../fixtures/facts.js";
import { turn as t, page, knowledge, kApprox, kMax, filter } from "../helpers.js";
const make = (n: number, scenario: string, turns: UatCase["turns"], tags: string[]): UatCase => ({ id: `SALES-${String(n).padStart(3, "0")}`, persona: "SALES", scenario, tags, turns });
export const salesCases: UatCase[] = [
  make(23, "自然指标倒装、新问题重置与省略厚度追问", [
    t("保温板自身热阻 有传热8.3的保温板么", { query: { filters: [filter("PRODUCT_R", "APPROX", 8.3)] }, candidateCount: 0, clarification: false }),
    t("保温薄抹灰传热系数0.3方案有么", { query: { filters: kApprox }, expectedCandidate: A13, clarification: false }),
    t("那20以内呢", { query: { thicknessMax: 20 }, inheritPreviousFilters: true, expectedCandidate: A13, clarification: false }),
    t("这个再薄一点", { query: { thicknessMax: 20, preferThinner: true }, inheritPreviousFilters: true, expectedCandidate: A13 })
  ], ["NATURAL_LANGUAGE", "NEW_QUERY", "CONTINUE_QUERY", "REFINE_QUERY"]),
  make(1, "客户想做薄：放宽厚度并找原页", [t("客户这边想做薄一点，20mm以内有没有K 0.3左右的？", { query: { filters: kApprox, thicknessMax: 20, preferThinner: true }, expectedCandidate: A13 }), t("那25以内呢？", { query: { thicknessMax: 25 }, inheritPreviousFilters: true }), page()], ["THICKNESS", "ELLIPSIS", "SOURCE"]),
  make(2, "严格上限无结果：说明原因后放宽", [t("有没有18mm以内K不超过0.3的？", { query: { filters: kMax, thicknessMax: 18 }, candidateCount: 0 }), t("那20以内呢？", { query: { thicknessMax: 20 }, inheritPreviousFilters: true, expectedCandidate: A14 }), page()], ["HARD_CONDITION", "NO_MATCH"]),
  make(3, "K目标选型与最接近方案", [t("K0.3左右有哪些现成方案？", { query: { filters: kApprox }, expectedCandidate: A13 }), t("第二个呢，参数和来源给我", { reusePreviousCandidate: true, referencePageRequired: true }), t("刚才哪个最接近0.3？", { query: { filters: kApprox }, expectedCandidate: A13 }), page()], ["RANKING", "SECOND_CANDIDATE"]),
  make(4, "厚度上限从20调到25再收紧", [t("K控制0.3以内，厚度20mm以内有没有？", { query: { filters: kMax, thicknessMax: 20 }, expectedCandidate: A14 }), t("厚度调到25", { query: { thicknessMax: 25 }, inheritPreviousFilters: true }), t("收紧到20", { query: { thicknessMax: 20 }, inheritPreviousFilters: true }), t("换20mm呢？", { query: { thicknessMm: 20, thicknessMax: undefined }, inheritPreviousFilters: true })], ["THICKNESS", "UPDATE"]),
  make(5, "尽量薄：硬条件之后排序", [t("有没有K不超过0.3的，尽量薄？", { query: { filters: kMax, preferThinner: true } }), t("加上20mm以内", { query: { thicknessMax: 20, preferThinner: true }, inheritPreviousFilters: true, expectedCandidate: A14 }), page()], ["PREFERENCE"]),
  make(6, "从20改到25的厚度口语", [t("K0.3左右，厚度20mm以内有没有？", { query: { filters: kApprox, thicknessMax: 20 } }), t("厚度从20改到25", { query: { thicknessMax: 25 }, inheritPreviousFilters: true }), t("厚度从25调到20", { query: { thicknessMax: 20 }, inheritPreviousFilters: true })], ["COLLOQUIAL"]),
  make(7, "取消厚度并清除薄板偏好", [t("20mm以内K0.3左右，尽量薄", { query: { filters: kApprox, thicknessMax: 20, preferThinner: true } }), t("不考虑厚度了", { query: { thicknessMm: undefined, thicknessMin: undefined, thicknessMax: undefined, preferThinner: undefined }, inheritPreviousFilters: true }), t("先不看厚度，只保留K条件", { inheritPreviousFilters: true })], ["REMOVE"]),
  make(8, "I型切II型后不能保留旧规格", [t("I型18mm有哪些方案？", { query: { specClass: "I", thicknessMm: 18 }, expectedCandidate: A13 }), t("那II型呢？", { query: { specClass: "II", thicknessMm: 18 }, expectedCandidate: { schemeCode: "B1-1", specClass: "II" } }), page()], ["SWITCH", "SPEC"]),
  make(9, "K严格筛选没有完全满足的方案", [t("18mm以内K控制0.3以内有哪些方案，限定I型", { query: { filters: kMax, specClass: "I", thicknessMax: 18 }, candidateCount: 0 }), t("厚度不限", { query: { thicknessMax: undefined }, inheritPreviousFilters: true, expectedCandidate: A14 }), page()], ["NO_MATCH", "REMOVE"]),
  make(10, "近似结果不能替代严格上限", [t("A1-3 18mm有没有K0.3左右的？", { expectedCandidate: A13, query: { filters: kApprox } }), t("客户要求K不超过0.3", { query: { filters: kMax }, candidateCount: 0 }), t("那取消厚度限制继续找", { query: { thicknessMm: undefined }, inheritPreviousFilters: true })], ["MODE_CHANGE"]),
  make(11, "原图集页与页面再次打开", [t("A1-3 18mm的方案参数", { expectedCandidate: A13 }), page("把刚才那页给我"), page("上一个方案的原页再给我看看")], ["REFERENCE_PAGE"]),
  make(12, "数据出处追溯", [t("I型18mm有没有K0.3左右的方案？", { expectedCandidate: A13 }), page("刚才那个的数据出处是哪一页？"), page("把页面给我")], ["PROVENANCE"]),
  make(13, "客户解释：近似与严格要求区别", [t("A1-3 18mm的参数给我", { expectedCandidate: A13 }), knowledge("帮我用一句话向客户解释这个0.303为什么只是接近0.3", { toolsAny: [], resultType: "REFERENCE", answerIncludes: ["接近"] }), t("如果要求K不超过0.3还有这个方案吗？", { query: { filters: kMax }, candidateCount: 0 })], ["CUSTOMER_COPY"]),
  make(14, "低导热系数与做薄原因", [knowledge("VICP为什么能做薄？"), knowledge("导热系数λ是多少？", { intent: "REFERENCE_LOOKUP", answerFacts: [{ pattern: "(?:λ|导热系数)[^\\d]{0,30}", value: 0.005 }] }), knowledge("帮我写一句客户能听懂的优势说明", { toolsAny: [] })], ["PRODUCT", "EXPLANATION"]),
  make(15, "与岩棉比较，禁止无依据防火卖点", [knowledge("VICP和岩棉哪个好？", { intent: "COMPARISON", toolsAny: ["compare_products", "compare_solutions"] }), knowledge("同样热阻哪个能做薄？", { intent: "COMPARISON", toolsAny: [] }), knowledge("防火等级没有资料就别猜，给我一句可以转述的话", { intent: "COMPARISON", toolsAny: [] })], ["COMPARISON"]),
  make(16, "限值表述查现成方案", [t("传热系数限值0.3有哪些方案", { query: { filters: kMax }, expectedCandidate: A14 }), t("最大改成20mm", { query: { thicknessMax: 20 }, inheritPreviousFilters: true }), page()], ["ROUTING"]),
  make(17, "真实传热8.3保温板问句先区分产品R与总R", [knowledge("有传热8.3的保温板么", { intent: "REFERENCE_LOOKUP", toolsAny: [], clarification: true, answerIncludes: ["热阻"] }), t("我说的是传热系数K，改查0.3左右", { query: { filters: kApprox }, expectedCandidate: A13 }), page()], ["AMBIGUOUS_TERM"]),
  make(18, "省略连接词且指标不混淆", [t("总R做到3.3左右有哪些方案？", { query: { filters: [filter("TOTAL_R", "APPROX", 3.3)] }, expectedCandidate: A13 }), t("产品R做到2.9左右", { query: { filters: [filter("TOTAL_R", "APPROX", 3.3), filter("PRODUCT_R", "APPROX", 2.9)] }, expectedCandidate: A13 }), page()], ["ELLIPSIS", "DUAL_R"]),
  make(19, "多轮反悔：增改删不复活", [t("K<=0.3，总R>=3.3，20mm以内", { query: { filters: [filter("K", "MAX_LIMIT", 0.3), filter("TOTAL_R", "MIN_LIMIT", 3.3)], thicknessMax: 20 } }), t("总R改成3.5以上，厚度放宽到25", { query: { filters: [filter("K", "MAX_LIMIT", 0.3), filter("TOTAL_R", "MIN_LIMIT", 3.5)], thicknessMax: 25 } }), t("先不限制厚度了", { query: { thicknessMax: undefined }, inheritPreviousFilters: true })], ["MULTI_TURN", "REMOVE"]),
  make(21, "明确产品层与整墙指标、近似与精确不能由模型改写", [
    t("保温板自身热阻2.9左右有哪些？", { query: { filters: [filter("PRODUCT_R", "APPROX", 2.9)] }, expectedCandidate: A13 }),
    t("取消产品热阻条件，整墙热阻3.3左右", { query: { filters: [filter("TOTAL_R", "APPROX", 3.3)] }, expectedCandidate: A13 }),
    t("总热阻就是3.3", { query: { filters: [filter("TOTAL_R", "EXACT", 3.3)] }, candidateCount: 0 })
  ], ["REGRESSION", "METRIC_CONFUSION", "MODE"]),
  make(22, "体系硬条件与相邻厚度不得混入正式候选", [
    t("薄抹灰外保温，K0.3左右，20mm以内", { query: { filters: kApprox, thicknessMax: 20 }, expectedCandidate: A13 }),
    t("只看30mm以上", { query: { thicknessMin: 30, thicknessMax: undefined }, inheritPreviousFilters: true, candidateCount: 0 })
  ], ["REGRESSION", "SYSTEM", "THICKNESS"]),
  make(20, "对比后准备客户说明报告", [knowledge("VICP和岩棉做个产品对比", { intent: "COMPARISON", toolsAny: ["compare_products", "compare_solutions"] }), knowledge("先整理给客户看的关键差异，资料不足要说清", { intent: "COMPARISON", toolsAny: [] }), knowledge("准备一份产品对比报告，先让我确认内容和类型", { intent: "REPORT_PREPARATION", toolsAny: ["generate_report"] })], ["REPORT_PREPARATION"])
];
