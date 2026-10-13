import type { LastReferenceLookup } from "./conversation-task.js";
import { extractSemanticFacts } from "./thermal-answer-semantics.js";
import { normalizeSubstrateMaterial } from "./thermal-substrate-facts.js";

/** 只有当前候选中实际出现的基层才构成只读引用；不同档位仍须唯一，不签发新的身份。 */
export function resolveCandidateMaterialReference(candidates: LastReferenceLookup["candidates"], message: string): { ids?: string[]; reason?: string } | undefined {
  const facts = extractSemanticFacts(message);
  const materialNames = [...new Set(facts.filter(fact => fact.kind === "substrateMaterial").map(fact => normalizeSubstrateMaterial(fact.name)))];
  const normalized = normalizeSubstrateMaterial(message);
  const mentioned = [...new Set(candidates.flatMap(candidate => candidate.substrateMaterial
    && normalized.includes(normalizeSubstrateMaterial(candidate.substrateMaterial)) ? [normalizeSubstrateMaterial(candidate.substrateMaterial)] : []))];
  const names = materialNames.length ? materialNames : mentioned;
  if (!names.length || !candidates.some(candidate => candidate.substrateMaterial && names.includes(normalizeSubstrateMaterial(candidate.substrateMaterial)))) return undefined;
  if (names.length > 1) {
    const clauses = message.split(/以及|和|与|[、，,]/);
    if (clauses.length < 2) return { reason: "请分别指定这几种基层对应的当前卡片序号。" };
    const references = clauses.map(clause => resolveCandidateMaterialReference(candidates, clause)).filter(reference => reference !== undefined);
    if (references.length !== names.length || references.some(reference => !reference.ids)) return { reason: "多项基层引用不能逐项唯一对应，请指定当前卡片序号。" };
    const ids = [...new Set(references.flatMap(reference => reference.ids ?? []))];
    return ids.length === names.length ? { ids } : { reason: "多项基层引用不能逐项唯一对应，请指定当前卡片序号。" };
  }
  const groups = names.map(name => candidates.filter(candidate => candidate.substrateMaterial && normalizeSubstrateMaterial(candidate.substrateMaterial) === name
    && facts.every(fact => fact.kind === "substrateThickness" ? candidate.substrateThickness === fact.value
      : fact.kind === "thickness" ? candidate.thicknessMm === fact.value
      : fact.kind === "specClass" ? candidate.specClass === fact.value : true)));
  return groups.some(group => group.length !== 1) ? { reason: "该基层引用对应零个或多个当前档位，请指定卡片序号。" }
    : { ids: groups.map(group => group[0]!.id) };
}

const ordinal = (token: string) => /^\d+$/.test(token) ? Number(token)
  : token === "十" ? 10 : token.startsWith("十") ? 10 + "一二三四五六七八九".indexOf(token.slice(1)) + 1
  : "一二三四五六七八九".indexOf(token) + 1;
/** 只解析本轮引用，不信任历史临时Selected，也不猜第一个。 */
export function resolveVisibleCandidateIds(last: LastReferenceLookup | undefined, message: string): { ids?: string[]; reason?: string } {
  if (!last?.candidates.length) return { reason: "当前没有可引用的候选，请先查询。" };
  const candidates = last.candidates;
  const positions = [...message.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*(?:个|套|项)?/g)].map(match => ordinal(match[1]!));
  if (positions.length) {
    if (positions.some(position => !Number.isSafeInteger(position) || position < 1 || !candidates[position - 1])) return { reason: "该序号不在最近显示的列表中，请选择当前候选。" };
    return { ids: [...new Set(positions.map(position => candidates[position - 1]!.id))] };
  }
  if (/同(?:一|样)|相同/.test(message) && /厚度|板厚/.test(message) && /比较|对比|哪个好|哪种更好|哪个更好/.test(message)) {
    return candidates.length === 2 && candidates[0]!.thicknessMm != null && candidates[0]!.thicknessMm === candidates[1]!.thicknessMm
      ? { ids: candidates.map(candidate => candidate.id) }
      : { reason: "请指定要比较的两个同厚度候选；当前列表不能唯一对应。" };
  }
  const material = resolveCandidateMaterialReference(candidates, message);
  if (material) return material;
  const codes = [...message.matchAll(/\b[A-Z]{1,4}\d+(?:-\d+)+\b/gi)].map(match => match[0].toUpperCase());
  const thickness = /(\d+(?:\.\d+)?)\s*(?:mm|毫米|厚)/i.exec(message);
  const k = /(?:K(?:值)?|传热系数)\s*[=≈]?\s*(\d+(?:\.\d+)?)/i.exec(message);
  if (codes.length || thickness || k) {
    const ids: string[] = [];
    for (const code of codes.length ? codes : [undefined]) {
      const matches = candidates.filter(candidate => (!code || candidate.schemeCode?.toUpperCase() === code)
        && (!thickness || candidate.thicknessMm === Number(thickness[1]))
        && (!k || candidate.kValue != null && (candidate.kValue === Number(k[1]) || Number(candidate.kValue.toFixed(3)) === Number(k[1]))));
      if (matches.length !== 1) return { reason: "该引用对应零个或多个当前候选，请指定当前卡片序号。" };
      ids.push(matches[0]!.id);
    }
    return { ids: [...new Set(ids)] };
  }
  if (/这些|这几个|全部候选/.test(message)) return { ids: candidates.map(candidate => candidate.id) };
  const requestedPair = /这两个|两个(?:结果|方案|做法)|两项(?:结果|方案)/.test(message);
  if (requestedPair) return candidates.length === 2 ? { ids: candidates.map(candidate => candidate.id) }
    : { reason: "请指定最近可见列表中要查看的两个候选；不能用其他查询的结果补齐。" };
  if (candidates.length === 1) return { ids: [candidates[0]!.id] };
  return { reason: "要查看或比较当前列表中的哪一个方案？请指定卡片序号。" };
}
export function selectFrozenReferenceCandidateIds(last: LastReferenceLookup | undefined, message: string): string[] | undefined {
  const result = resolveVisibleCandidateIds(last, message);
  return result.ids && result.ids.length >= 2 ? result.ids : undefined;
}
