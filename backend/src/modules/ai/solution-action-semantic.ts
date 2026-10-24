import { z } from "zod";
import type { SolutionPayload, SolutionAction } from "./solution-workflow.js";
import type { ReferenceDataConflict } from "../../shared/reference-data-conflict.js";
export type ChatReadOnlyReference = { fingerprint: string; label: string; code?: string | null; thicknessMm?: number; conflict: ReferenceDataConflict };

const evidence = z.string().trim().min(1).max(500);
export const candidateReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("POSITION"), value: z.number().int().positive(), evidence }).strict(),
  z.object({ type: z.literal("CONSTRUCTION_CODE"), value: z.string().trim().min(1).describe("本轮用户逐字写出的正式编码，value必须实际出现在evidence中；自然称呼不能推导或改写为后台编码"), evidence }).strict(),
  z.object({ type: z.literal("THICKNESS"), value: z.number().positive(), evidence }).strict(),
  z.object({ type: z.literal("CURRENT_SELECTION"), evidence }).strict(),
  z.object({ type: z.literal("CURRENT_POOL"), evidence }).strict(),
  z.object({ type: z.literal("POOL_PREFIX"), value: z.number().int().positive().max(100), evidence }).strict(),
  z.object({ type: z.literal("CANDIDATE_LABEL"), value: z.string().trim().min(1).max(200), evidence,
    thicknessMm: z.number().positive().nullable(), thicknessEvidence: evidence.nullable() }).strict(),
  // 模型只表达指代，不给身份；Backend必须在当前授权范围内唯一绑定。
  z.object({ type: z.literal("CURRENT_REFERENCE"), evidence }).strict()
]);
export type CandidateReference = z.infer<typeof candidateReferenceSchema>;
const chatReadOnlyReferenceSchema = z.object({ label: z.string().trim().min(1).max(500), evidence,
  thicknessEvidence: evidence.nullable() }).strict();
/** 无正式ID、无CONFIRM；NONE 交还既有热工/查询/普通聊天流程。 */
export const parsedSolutionActionSchema = z.object({
  type: z.enum(["SELECT", "ADD", "REMOVE", "SET_FINAL", "COMPARE_SELECTED", "KEEP_CONFLICT", "REMOVE_CONFLICT", "NONE", "CLARIFY"]),
  references: z.array(candidateReferenceSchema).max(100),
  comparisonReferences: z.array(candidateReferenceSchema).max(100).optional().describe("仅SET_FINAL可用：用户明确要求纳入正式备选或正式比较候选的记录，不作为Final；普通对话参考用readOnlyReferences"),
  readOnlyReferences: z.array(chatReadOnlyReferenceSchema).max(100).optional().describe("仅SET_FINAL：只保留在对话中核对的资料；不进入正式备选、Snapshot或PDF。只提名称和原话证据，不输出数值或身份"),
  selectionMode: z.enum(["INCLUDE", "EXCLUDE"]),
  referenceScope: z.enum(["CURRENT_POOL", "CURRENT_SELECTION"]),
  temporalScope: z.enum(["CURRENT", "PREVIOUS"]),
  evidence: z.string().max(1000), confidence: z.number().min(0).max(1),
  unresolved: z.array(z.string().min(1)).max(10)
}).strict();
export type ParsedSolutionAction = z.infer<typeof parsedSolutionActionSchema>;
export type SolutionSelectionIntent = { type: "USER_SELECTION"; action: SolutionAction["action"]; candidateIds?: string[];
  comparisonCandidateIds?: string[];
  chatReferenceRetention?: { queryRevision: number; references: ChatReadOnlyReference[] };
  clarification?: string; validationCode?: "REFERENCE_EVIDENCE_INVALID"; parserSource?: "FAST_PATH" | "LLM" | "UNAVAILABLE"; semantic?: ParsedSolutionAction };

const confirmationCommands = new Set(["确认生成方案", "确认最终方案", "确认提交"]);
const acknowledgementCommands = new Set(["可以", "行", "就这样", "没问题"]);
export const normalizeSolutionActionText = (text: string) => text.normalize("NFKC").trim().replace(/[。！!？?\s]+$/u, "");
export function isSolutionAcknowledgement(text: string) { return acknowledgementCommands.has(normalizeSolutionActionText(text)); }

/** 仅完整、按钮式命令走规则。开放自然语言不在这里增加动词 Regex。 */
export function parseSolutionActionFastPath(message: string): SolutionSelectionIntent | null {
  const text = normalizeSolutionActionText(message);
  if (confirmationCommands.has(text)) return { type: "USER_SELECTION", action: "CONFIRM", parserSource: "FAST_PATH" };
  if (new Set(["重新选一套", "重新开始", "新方案", "重新做一套方案", "开始智配", "开始做方案", "帮我按这些条件选方案"]).has(text)) return { type: "USER_SELECTION", action: "START_NEW", parserSource: "FAST_PATH" };
  if (new Set(["我又想改成另一个", "继续调整"]).has(text)) return { type: "USER_SELECTION", action: "REVISE", parserSource: "FAST_PATH" };
  return null;
}
const actionMap = { SELECT: "SELECT", ADD: "ADD", REMOVE: "REMOVE", SET_FINAL: "SET_FINAL", COMPARE_SELECTED: "COMPARE",
  KEEP_CONFLICT: "KEEP_FOR_COMPARISON", REMOVE_CONFLICT: "REMOVE_CONFLICT" } as const;
const unique = (ids: string[]) => [...new Set(ids)];
const chineseNumber: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 这里只验证引用数字确实来自原话，不分类用户动作。 */
function evidenceHasNumber(text: string, value: number) {
  const tokens = text.normalize("NFKC").match(/\d+(?:\.\d+)?|[一二两三四五六七八九十]+/g) ?? [];
  return tokens.some(token => (chineseNumber[token] ?? Number(token)) === value);
}
const normalizeCode = (text: string) => {
  const code = text.normalize("NFKC").replace(/\s/g, "").toUpperCase();
  return code.slice(0, 2) === "外墙" ? code.slice(2) : code;
};
/** 共用只读/动作引用证据门禁；只核验格式和值，不判定业务意图。 */
export function referenceEvidenceMatches(ref: CandidateReference): boolean {
  if (ref.type === "POSITION" || ref.type === "POOL_PREFIX" || ref.type === "THICKNESS") return evidenceHasNumber(ref.evidence, ref.value);
  if (ref.type === "CONSTRUCTION_CODE") return normalizeCode(ref.evidence).includes(normalizeCode(ref.value));
  if (ref.type === "CANDIDATE_LABEL") return ref.thicknessMm == null || !!ref.thicknessEvidence && evidenceHasNumber(ref.thicknessEvidence, ref.thicknessMm);
  return true;
}
export function groundSolutionAction(message: string, raw: unknown, state: SolutionPayload, expectedRevision: number, currentReferenceIds?: readonly string[],
  readOnlyCatalog?: { queryRevision: number; references: readonly ChatReadOnlyReference[] }): SolutionSelectionIntent | null {
  const parsed = parsedSolutionActionSchema.safeParse(raw);
  const unresolved = (reason: string, semantic?: ParsedSolutionAction, validationCode?: "REFERENCE_EVIDENCE_INVALID"): SolutionSelectionIntent => ({ type: "USER_SELECTION", action: "SELECT", clarification: reason, parserSource: "LLM", semantic, ...(validationCode ? { validationCode } : {}) });
  if (!parsed.success) return unresolved("无法核验方案动作或引用，请明确要选择的当前候选。");
  const action = parsed.data;
  if (isSolutionAcknowledgement(message)) return null;
  if (action.type === "NONE") return action.unresolved.length ? unresolved("这次要操作哪一套还没有对应清楚，可以说板厚或选择对应卡片。", action) : null;
  if (!state.candidates.length) return unresolved("请先查询或选择一个候选方案。", action);
  if (action.type === "CLARIFY" || action.confidence < .85 || action.unresolved.length)
    return unresolved("方案动作或引用不明确，请确认要操作的候选和动作。", action);
  if (!action.evidence.trim() || !message.normalize("NFKC").includes(action.evidence.normalize("NFKC")))
    return unresolved("方案动作缺少本轮用户原话依据。", action);
  if (expectedRevision !== state.candidateSetRevision)
    return unresolved("候选列表已刷新，请重新选择当前候选。", action);
  if (action.temporalScope === "PREVIOUS" && action.references.some(ref => ref.type === "POSITION" || ref.type === "POOL_PREFIX"))
    return unresolved("旧列表序号不能映射到当前方案，请明确当前序号或构造。", action);
  const operation = actionMap[action.type];
  if (action.comparisonReferences?.length && action.type !== "SET_FINAL") return unresolved("保留参考候选需与最终方案分清，请明确操作。", action);
  if (action.readOnlyReferences?.length && (action.type !== "SET_FINAL" || action.selectionMode !== "INCLUDE" || action.temporalScope !== "CURRENT"))
    return unresolved("只读资料保留需要与当前最终方案分清，尚未执行这次组合操作。", action);
  if (action.type === "COMPARE_SELECTED") {
    if (action.references.length || action.selectionMode !== "INCLUDE") return unresolved("比较仅使用当前已选方案，请先明确选择。", action);
    return { type: "USER_SELECTION", action: "COMPARE", parserSource: "LLM", semantic: action };
  }
  const scopeIds = action.referenceScope === "CURRENT_SELECTION" ? state.selectedCandidateIds : state.poolCandidateIds;
  const scope = state.candidates.filter(item => scopeIds.includes(item.candidate.candidateId));
  if (!action.references.length) return unresolved("请明确当前候选序号、构造或厚度。", action);
  const referenced: string[] = [];
  for (const ref of action.references) {
    if (!message.normalize("NFKC").includes(ref.evidence.normalize("NFKC"))) return unresolved("候选引用缺少用户原话依据。", action);
    let ids: string[] = [];
    if (ref.type === "POSITION" || ref.type === "POOL_PREFIX") {
      if (!evidenceHasNumber(ref.evidence, ref.value)) return unresolved("候选序号不符合用户原话。", action);
      ids = ref.type === "POSITION" ? [state.poolCandidateIds[ref.value - 1] ?? ""] : state.poolCandidateIds.slice(0, ref.value);
      if (ref.value > state.poolCandidateIds.length || ids.some(id => !id)) return unresolved("候选序号超出当前列表。", action);
    } else if (ref.type === "CURRENT_REFERENCE") {
      const focused = scope.filter(item => !currentReferenceIds || currentReferenceIds.includes(item.candidate.candidateId));
      if (focused.length !== 1) return unresolved("当前有多套或没有能对应的可选方案，请说清板厚或选择对应卡片。", action);
      ids = [focused[0]!.candidate.candidateId];
    } else if (ref.type === "CURRENT_POOL") {
      ids = [...state.poolCandidateIds];
    } else if (ref.type === "CURRENT_SELECTION") {
      ids = operation === "KEEP_FOR_COMPARISON" || operation === "REMOVE_CONFLICT"
        ? unique(state.conflicts.map(conflict => conflict.candidateId)) : [...state.selectedCandidateIds];
    } else if (ref.type === "CANDIDATE_LABEL") {
      // value是候选目录的人类名称提案，不是正式身份；仅在当前授权池内精确绑定并要求唯一。
      if (ref.thicknessMm != null && (!ref.thicknessEvidence || !message.includes(ref.thicknessEvidence)
        || !evidenceHasNumber(ref.thicknessEvidence, ref.thicknessMm))) return unresolved("厚度引用缺少本轮原话依据。", action);
      ids = scope.filter(item => item.candidate.schemeName === ref.value
        && (ref.thicknessMm == null || item.candidate.thicknessMm === ref.thicknessMm)).map(item => item.candidate.candidateId);
      if (ids.length !== 1) return unresolved("这个名称对应的当前候选不唯一或不存在，请补充厚度或选择候选卡片。", action);
    } else {
      if (ref.type === "THICKNESS" && !evidenceHasNumber(ref.evidence, ref.value)
        || ref.type === "CONSTRUCTION_CODE" && !normalizeCode(ref.evidence).includes(normalizeCode(ref.value)))
        return unresolved("候选引用与用户原话不一致。", action, "REFERENCE_EVIDENCE_INVALID");
      ids = scope.filter(item => ref.type === "THICKNESS" ? item.candidate.thicknessMm === ref.value
        : normalizeCode(item.candidate.constructionCode ?? "") === normalizeCode(ref.value)).map(item => item.candidate.candidateId);
      if (ids.length !== 1) return unresolved("该构造或厚度对应的候选不唯一或不存在，请明确当前候选序号。", action);
    }
    if (!ids.length) return unresolved("当前没有可定位的已选方案。", action);
    referenced.push(...ids);
  }
  const ids = action.selectionMode === "EXCLUDE" ? scopeIds.filter(id => !referenced.includes(id)) : unique(referenced);
  if (!ids.length) return unresolved("本次动作没有定位到可操作的候选。", action);
  if ((operation === "KEEP_FOR_COMPARISON" || operation === "REMOVE_CONFLICT") && ids.some(id => !state.conflicts.some(conflict => conflict.candidateId === id)))
    return unresolved("请明确当前存在冲突的已选方案。", action);
  let comparisonCandidateIds: string[] | undefined;
  if (action.comparisonReferences?.length) {
    const referenceAction = groundSolutionAction(message, { ...action, type: "ADD", references: action.comparisonReferences, comparisonReferences: [], readOnlyReferences: [], selectionMode: "INCLUDE" }, state, expectedRevision, currentReferenceIds);
    if (!referenceAction?.candidateIds?.length || referenceAction.clarification) return unresolved(referenceAction?.clarification ?? "未能唯一定位要保留的参考方案。", action);
    comparisonCandidateIds = referenceAction.candidateIds.filter(id => !ids.includes(id));
  }
  const retained: ChatReadOnlyReference[] = [];
  if (action.readOnlyReferences?.length) {
    if (!readOnlyCatalog || readOnlyCatalog.queryRevision !== expectedRevision) return unresolved("要保留的资料已变化或无法重新核对，这次组合操作尚未执行。", action);
    for (const ref of action.readOnlyReferences) {
      if (!message.normalize("NFKC").includes(ref.evidence.normalize("NFKC")))
        return unresolved("只读资料的指代缺少本轮原话依据，这次组合操作尚未执行。", action);
      if (ref.thicknessEvidence != null && !message.includes(ref.thicknessEvidence))
        return unresolved("只读资料的厚度缺少本轮原话依据，这次组合操作尚未执行。", action);
      const matches = readOnlyCatalog.references.filter(item => item.label === ref.label && (ref.thicknessEvidence == null
        || item.thicknessMm != null && referenceEvidenceMatches({ type: "THICKNESS", value: item.thicknessMm, evidence: ref.thicknessEvidence })));
      if (matches.length !== 1) return unresolved("有多条或没有能对应的只读资料，请明确要保留哪一条；最终方案也尚未更新。", action);
      retained.push(matches[0]!);
    }
  }
  return { type: "USER_SELECTION", action: operation, candidateIds: unique(ids), ...(comparisonCandidateIds?.length ? { comparisonCandidateIds } : {}),
    ...(retained.length ? { chatReferenceRetention: { queryRevision: expectedRevision, references: [...new Map(retained.map(item => [item.fingerprint, item])).values()] } } : {}), parserSource: "LLM", semantic: action };
}
