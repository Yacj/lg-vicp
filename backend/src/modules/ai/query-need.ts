import { z } from "zod";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { describeNumberRoles, semanticQuerySchema, type SemanticQuery } from "../thermal/semantic-query.js";
import { validateProductParameterEvidence } from "./product-parameter-query.js";

/** 服务端保存的澄清链；消息身份是连接依据，历史中“最近有数字”不是依据。 */
export const pendingQueryNeedSchema = z.object({
  rootMessageId: z.string().min(1),
  createdAt: z.string().datetime(),
  turns: z.array(z.object({ messageId: z.string().min(1), message: z.string().min(1).max(4000) }).strict()).min(1).max(8),
  identityHints: z.array(z.object({ field: z.enum(["subjectText", "systemText"]), text: z.string().min(1).max(200) }).strict()).max(12),
  inheritPrevious: z.boolean(),
  /** 待完成的语义约束，不是授权或工程事实；续问时仍逐字段重新grounding。 */
  pageQuery: semanticQuerySchema.optional(),
  goal: z.enum(["PRODUCTS", "MATERIALS", "SCHEMES", "PARAMETERS"]).optional()
}).strict();
export type PendingQueryNeed = z.infer<typeof pendingQueryNeedSchema>;
export type QueryClarification = { messageId: string; message: string; question: string; inheritPrevious: boolean;
  need?: PendingQueryNeed; originCreatedAt?: string };

/** 模型提交本轮变更，服务器合并尚未取消的原需求；合并结果仍须完整Policy和来源/证据校验。 */
export function mergePendingPageQuery(current: SemanticQuery, previous?: SemanticQuery): SemanticQuery {
  if (!previous) return current;
  const key = (item: SemanticQuery["constraints"][number]) => JSON.stringify([item.type, item.type === "METRIC" ? item.metric : item.field]);
  const replacements = current.constraints.filter(item => item.operation === "SET" || item.operation === "REMOVE" || item.operation === "REPLACE");
  const retained = previous.constraints.filter(item => !replacements.some(next => key(next) === key(item)
    || next.type === "METRIC" && next.operation === "REPLACE" && item.type === "METRIC"));
  return { ...current, constraints: [...retained, ...current.constraints], sourceScope: current.sourceScope ?? previous.sourceScope,
    preferences: [...previous.preferences.filter(old => !current.preferences.some(next => next.field === old.field)), ...current.preferences] };
}
/** 原问已记录的名称角色在补指标时保持；不从模型的新字段位置重建身份。 */
export function mergePendingParameterIdentity(message: string, query: NonNullable<DomainTurnSemantic["parameterQuery"]>, pending: QueryClarification) {
  const merged = { ...query };
  for (const hint of pending.need?.identityHints ?? []) {
    // 当前原话明确替换同一名称字段时尊重新值，其他情况沿用已有线索。
    if (merged[hint.field] && merged[hint.field] !== hint.text && message.includes(merged[hint.field]!)) continue;
    merged[hint.field] = hint.text;
    const other = hint.field === "systemText" ? "subjectText" : "systemText";
    if (merged[other] === hint.text) merged[other] = null;
  }
  return merged;
}

export function pendingNeedForAnswer(messageId: string, message: string, semantic?: DomainTurnSemantic,
  previous?: QueryClarification, now = new Date(), queryServiceClarification = false): PendingQueryNeed | undefined {
  if (!messageId || !message.trim() || message.length > 4000 || semantic?.relation === "CANCEL") return undefined;
  const continuePrevious = previous && semantic?.relation !== "SWITCH_TOPIC";
  // 普通咨询、建议、概念或操作的澄清不是待查条件。只有查询目标/字段、未明工程标量，
  // 或实际查询Service的缺项能够建立此状态；已有有效查询的解释插话仍保留原链。
  if (semantic && !continuePrevious && !queryServiceClarification) {
    const queryIntent = ["REFERENCE_QUERY", "REFERENCE_REFINE", "PRODUCT_PARAMETER_QUERY", "PRODUCT_DISCOVERY", "PRODUCT_DETAIL"]
      .includes(semantic.intent);
    const unresolvedQuery = (semantic.intent === "CLARIFY" || semantic.intent === "GENERAL")
      && (semantic.pageQuery != null || semantic.parameterQuery != null || semantic.productQuery != null || semantic.readGoal != null
        || describeNumberRoles(message).some(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET"));
    if (!queryIntent && !unresolvedQuery) return undefined;
  }
  const old = continuePrevious ? previous.need ?? {
    rootMessageId: previous.messageId, createdAt: previous.originCreatedAt ?? now.toISOString(),
    turns: [{ messageId: previous.messageId, message: previous.message }], identityHints: [], inheritPrevious: previous.inheritPrevious
  } : undefined;
  const identityHints = [...(old?.identityHints ?? [])];
  for (const constraint of semantic?.pageQuery?.constraints ?? []) {
    if (constraint.type !== "ENTITY" || !constraint.entityText || constraint.operation !== "SET") continue;
    const field = constraint.field === "systemHint" ? "systemText" as const : undefined;
    if (field && message.includes(constraint.entityText)) identityHints.push({ field, text: constraint.entityText });
  }
  for (const field of ["subjectText", "systemText"] as const) {
    const text = semantic?.parameterQuery?.[field];
    if (text && message.includes(text)) identityHints.push({ field, text });
  }
  // 产品名称也是原查询的身份条件；未完成指标澄清不能把已明确的产品丢成全库查询。
  const productName = semantic?.productQuery?.scope === "IDENTITY" ? semantic.productQuery.entityText : null;
  if (productName && message.includes(productName)
    && !identityHints.some(hint => hint.text === productName)) identityHints.push({ field: "subjectText", text: productName });
  const turns = [...(old?.turns ?? []), { messageId, message }];
  if (turns.length > 8) return undefined; // 链过长不截掉原约束后继续执行。
  const result = pendingQueryNeedSchema.safeParse({
    rootMessageId: old?.rootMessageId ?? messageId, createdAt: old?.createdAt ?? now.toISOString(), turns,
    identityHints: [...new Map(identityHints.map(hint => [hint.field, hint])).values()],
    inheritPrevious: old?.inheritPrevious ?? (semantic?.relation === "CONTINUE" || semantic?.relation === "REFINE"),
    pageQuery: semantic?.pageQuery ? mergePendingPageQuery(semantic.pageQuery, old && "pageQuery" in old ? old.pageQuery : undefined)
      : old && "pageQuery" in old ? old.pageQuery : undefined,
    goal: old && "goal" in old ? old.goal : semantic?.readGoal ?? undefined
  });
  return result.success ? result.data : undefined;
}

/** 仅校验已提出的只读查询；不据短语判意图、不授权计算/方案/报告。 */
export function checkPendingQueryContinuity(message: string, semantic: DomainTurnSemantic, pending?: QueryClarification | null): string | undefined {
  if (!pending || semantic.relation === "CANCEL" || semantic.relation === "SWITCH_TOPIC") return undefined;
  const isQuery = semantic.intent === "PRODUCT_PARAMETER_QUERY" || semantic.intent === "REFERENCE_QUERY" || semantic.intent === "REFERENCE_REFINE";
  if (!isQuery) return undefined;
  const targets = (text: string) => describeNumberRoles(text).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");
  // 完整的新对象读取可以独立开始；一个没有对象/数值的 READ 不能悄悄取代待完成的有条件查询。
  const newIdentity = semantic.parameterQuery?.subjectText ?? semantic.productQuery?.entityText;
  const selfContainedNew = semantic.relation === "NEW" && !!newIdentity && message.includes(newIdentity);
  if (selfContainedNew) return undefined;
  if (semantic.queryContext !== "CLARIFICATION_REPLY") {
    if (targets(pending.message).length && !targets(message).length)
      return "待澄清原问仍有有效数值和范围，本轮提案未绑定该需求；请保留原目标，或根据本轮明确的新目标说明换话题，不能执行无条件读取。";
    if (semantic.relation === "CONTINUE" || semantic.relation === "REFINE")
      return "本轮继续待澄清需求，查询必须绑定原问消息及条件，不能仅凭 CURRENT_TURN 丢弃原条件。";
  }
  if (semantic.parameterQuery && semantic.queryContext === "CLARIFICATION_REPLY") {
    const error = validateProductParameterEvidence(message, semantic.parameterQuery, pending.message);
    if (error) return error;
    for (const hint of pending.need?.identityHints ?? []) {
      const current = semantic.parameterQuery[hint.field];
      if (current !== hint.text && !(current && message.includes(current)))
        return `原查询名称条件“${hint.text}”未被保留，请核对对象归属；名称未解析不能删除后扩大查询。`;
    }
  }
  if (semantic.pageQuery && semantic.queryContext === "CLARIFICATION_REPLY" && !targets(message).length) {
    const values = semantic.pageQuery.constraints.filter(item => item.type === "METRIC" && item.operation !== "REMOVE").map(item => item.value);
    if (targets(pending.message).some(number => !values.includes(Number(number.raw))))
      return "原先给出的指标数值和范围还没有保留，请接着原条件查询；如果要改条件，请明确新的目标。";
  }
  // 原提案连字段角色都未解析时，不能只保存原话，然后让后续另一组数字覆盖它。
  // 这里只拒绝遗漏，不猜基层/板厚，也不从原话创建任何检索或操作参数。
  if (semantic.pageQuery && semantic.queryContext === "CLARIFICATION_REPLY" && !pending.need?.pageQuery) {
    const retained = semantic.pageQuery.constraints.filter(item => item.type === "THICKNESS" && item.operation !== "REMOVE");
    const oldThicknesses = describeNumberRoles(pending.message).filter(number => number.role === "THICKNESS");
    if (oldThicknesses.some(number => !retained.some(item => describeNumberRoles(item.evidence)
      .some(evidenceNumber => evidenceNumber.role === "THICKNESS" && evidenceNumber.raw === number.raw))))
      return "原问里的厚度条件还没有核验完整，不能只按这轮新增厚度扩大查询；我会保留原条件后再核对。";
  }
  return undefined;
}
