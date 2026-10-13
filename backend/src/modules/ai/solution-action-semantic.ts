import { z } from "zod";
import type { SolutionPayload, SolutionAction } from "./solution-workflow.js";

const evidence = z.string().trim().min(1).max(500);
export const candidateReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("POSITION"), value: z.number().int().positive(), evidence }).strict(),
  z.object({ type: z.literal("CONSTRUCTION_CODE"), value: z.string().trim().min(1), evidence }).strict(),
  z.object({ type: z.literal("THICKNESS"), value: z.number().positive(), evidence }).strict(),
  z.object({ type: z.literal("CURRENT_SELECTION"), evidence }).strict(),
  z.object({ type: z.literal("CURRENT_POOL"), evidence }).strict(),
  z.object({ type: z.literal("POOL_PREFIX"), value: z.number().int().positive().max(100), evidence }).strict()
]);
export type CandidateReference = z.infer<typeof candidateReferenceSchema>;
/** 无正式ID、无CONFIRM；NONE 交还既有热工/查询/普通聊天流程。 */
export const parsedSolutionActionSchema = z.object({
  type: z.enum(["SELECT", "ADD", "REMOVE", "SET_FINAL", "COMPARE_SELECTED", "KEEP_CONFLICT", "REMOVE_CONFLICT", "NONE", "CLARIFY"]),
  references: z.array(candidateReferenceSchema).max(100),
  selectionMode: z.enum(["INCLUDE", "EXCLUDE"]),
  referenceScope: z.enum(["CURRENT_POOL", "CURRENT_SELECTION"]),
  temporalScope: z.enum(["CURRENT", "PREVIOUS"]),
  evidence: z.string().max(1000), confidence: z.number().min(0).max(1),
  unresolved: z.array(z.string().min(1)).max(10)
}).strict();
export type ParsedSolutionAction = z.infer<typeof parsedSolutionActionSchema>;
export type SolutionSelectionIntent = { type: "USER_SELECTION"; action: SolutionAction["action"]; candidateIds?: string[];
  clarification?: string; parserSource?: "FAST_PATH" | "LLM" | "UNAVAILABLE"; semantic?: ParsedSolutionAction };

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
const normalizeCode = (text: string) => text.normalize("NFKC").replace(/\s/g, "").toUpperCase();
/** 共用只读/动作引用证据门禁；只核验格式和值，不判定业务意图。 */
export function referenceEvidenceMatches(ref: CandidateReference): boolean {
  if (ref.type === "POSITION" || ref.type === "POOL_PREFIX" || ref.type === "THICKNESS") return evidenceHasNumber(ref.evidence, ref.value);
  if (ref.type === "CONSTRUCTION_CODE") return normalizeCode(ref.evidence).includes(normalizeCode(ref.value));
  return true;
}
export function groundSolutionAction(message: string, raw: unknown, state: SolutionPayload, expectedRevision: number): SolutionSelectionIntent | null {
  const parsed = parsedSolutionActionSchema.safeParse(raw);
  const unresolved = (reason: string, semantic?: ParsedSolutionAction): SolutionSelectionIntent => ({ type: "USER_SELECTION", action: "SELECT", clarification: reason, parserSource: "LLM", semantic });
  if (!parsed.success) return unresolved("无法核验方案动作或引用，请明确要选择的当前候选。");
  const action = parsed.data;
  if (isSolutionAcknowledgement(message)) return null;
  if (action.type === "NONE") return null;
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
    } else if (ref.type === "CURRENT_POOL") {
      ids = [...state.poolCandidateIds];
    } else if (ref.type === "CURRENT_SELECTION") {
      ids = operation === "KEEP_FOR_COMPARISON" || operation === "REMOVE_CONFLICT"
        ? unique(state.conflicts.map(conflict => conflict.candidateId)) : [...state.selectedCandidateIds];
    } else {
      if (ref.type === "THICKNESS" && !evidenceHasNumber(ref.evidence, ref.value)
        || ref.type === "CONSTRUCTION_CODE" && !normalizeCode(ref.evidence).includes(normalizeCode(ref.value)))
        return unresolved("候选引用与用户原话不一致。", action);
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
  return { type: "USER_SELECTION", action: operation, candidateIds: unique(ids), parserSource: "LLM", semantic: action };
}
