/**
 * 多轮查询生命周期判定（确定性、可测试、无 IO）。
 *
 * 之前的实现把所有轮次都当成「继承上一轮 QueryState」，导致独立的新问题会错误继承旧条件
 * （例如上一轮问「产品层 R≈8.3」，下一轮问「保温薄抹灰传热系数 0.3 方案有么」仍带着 R≈8.3）。
 * 本文件只做一件事：判断本轮是 NEW_QUERY / CONTINUE_QUERY / REFINE_QUERY / COMPARE_SELECTED。
 *
 * 判定综合「是否重新给出 metric / target / entity」「是否引用上一轮候选」「是否存在指代词」，
 * 不只靠关键词。默认（拿不准时）偏向 CONTINUE，避免把追问误判成新问题而丢条件。
 */

export const QUERY_LIFECYCLE_MODES = ["NEW_QUERY", "CONTINUE_QUERY", "REFINE_QUERY", "COMPARE_SELECTED"] as const;
export type QueryLifecycleMode = (typeof QUERY_LIFECYCLE_MODES)[number];

/** 追问 / 指代 / 局部修改标记：出现这些通常是在上一轮基础上继续。 */
const CONTINUATION_MARKER = /^(?:那|再|换|改)|这个|那个|这些|刚才|上一(?:个|轮|条)?|前一个|之前|第[一二三四五六七八九十\d]+个|换成|改成|放宽|收紧|调到|改到|取消|不限制|不用限制|先不看|去掉|保留|不变|照旧|还是|继续|顺便|另外|其他/;
/** 引用上一轮候选（第一个 / 第三个 / 这两个 …）。 */
const CANDIDATE_REFERENCE = /第[一二三四五六七八九十\d]+个|这个方案|那个方案|这两个|这三个|第一个|上一个|刚才那个|刚才的方案|前面那个/;
/**
 * 显式改写 / 替换既有条件（改成 / 换成 / 放宽 / 收紧 / 取消 …）→ REFINE_QUERY。
 * 这类说法是在**替换**上一轮的某个约束，而不是追加，必须能自我识别，
 * 不能只依赖调用方传入的 hasRemoval（省略式追问时调用方未必算得出来）。
 */
const REWRITE_MARKER = /改成|改为|换成|换到|调到|改到|放宽|收紧|取消|不限制|不用限制|先不看|去掉|删掉|移除|不要(?:了|这个)?|重新(?:给|设)?/;
/**
 * 「完整独立问题」的外显标记：只有重新给出新的 metric+target **并且**带上明确主题词或提问形式，
 * 才算 NEW_QUERY。单纯「总R3.3左右」这类省略片段属于在上一轮上增改，仍按 CONTINUE 处理。
 */
const STANDALONE_HINT = /方案|系统|体系|构造|图集|参考|选用表|[ⅠⅡⅢ]型|[123一二三]型|有没有|有么|有吗|有哪些|哪些|几个|推荐/;

export interface QueryLifecycleSignals {
  message: string;
  hasPrevious: boolean;
  /** 本轮是否解析出新的 metric + target（例如「传热系数0.3」） */
  hasNewMetricTarget?: boolean;
  /** 正式实体/族词典解析出的本轮主题，而非历史或模型摘要。 */
  hasNewEntity?: boolean;
  /** 本轮是否解析出新的厚度 / 实体条件 */
  hasNewCondition?: boolean;
  /** 本轮是否显式移除或改写条件（取消 / 改成 / 放宽到 …） */
  hasRemoval?: boolean;
  /** 归一化层已识别的偏好变化，不在生命周期层重复解析。 */
  hasPreferenceUpdate?: boolean;
}

/**
 * 判定规则（自上而下，命中即返回）：
 * 1. 没有上一轮 → NEW_QUERY；
 * 2. 引用上一轮候选且没有新条件 → COMPARE_SELECTED（只读冻结候选，不重新全库查询）；
 * 3. 重新给出新的 metric + target、带完整独立问题标记、且没有任何追问/指代标记 → NEW_QUERY；
 * 4. 显式移除或改写条件 → REFINE_QUERY；
 * 5. 其余（含「总R3.3左右」这类省略增改）→ CONTINUE_QUERY，继承后增量更新。
 */
export function classifyQueryLifecycle(signals: QueryLifecycleSignals): QueryLifecycleMode {
  const message = (signals.message ?? "").replace(/\s+/g, "");
  if (!signals.hasPrevious) return "NEW_QUERY";
  const continuation = CONTINUATION_MARKER.test(message);
  const candidateReference = CANDIDATE_REFERENCE.test(message);
  if (candidateReference && /对比|比较|哪个好|差别|区别/.test(message) && !signals.hasNewMetricTarget && !signals.hasNewCondition) return "COMPARE_SELECTED";
  if ((signals.hasNewMetricTarget || signals.hasNewEntity) && !continuation && STANDALONE_HINT.test(message)) return "NEW_QUERY";
  if (signals.hasRemoval || signals.hasPreferenceUpdate || candidateReference && signals.hasNewCondition || REWRITE_MARKER.test(message)) return "REFINE_QUERY";
  return "CONTINUE_QUERY";
}
