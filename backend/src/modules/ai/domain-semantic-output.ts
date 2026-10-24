import { domainTurnSemanticSchema } from './ai-domain-semantic.js';

/** DEFINE的概念字段有重复表示时归一；λ仍不能成为K/R查表或核对指标。 */
export function normalizeDomainSemanticShape(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const fact = raw.factRead as Record<string, unknown> | null | undefined;
  if (raw.requestedEffect !== 'READ_ONLY' || raw.intent !== 'KNOWLEDGE_EXPLAIN' || !fact
    || fact.mode !== 'DEFINE' || fact.metric !== 'LAMBDA'
    || fact.definitionSubjects != null && (!Array.isArray(fact.definitionSubjects) || !fact.definitionSubjects.includes('LAMBDA'))) return value;
  return { ...raw, factRead: { ...fact, metric: null, definitionSubjects: fact.definitionSubjects ?? ['LAMBDA'] } };
}

/** 只读提案的空数组表示修复，不丢条件、不改目标/授权；其他非法输出保持拒绝。 */
export function repairDomainSemanticText(text: string): string | null {
  if (text.length > 100_000) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.requestedEffect !== 'READ_ONLY' && raw.requestedEffect !== 'QUERY') return null;
  if (raw.constraintPatch !== null) return null;
  const repaired = { ...raw, constraintPatch: [] };
  return domainTurnSemanticSchema.safeParse(repaired).success ? JSON.stringify(repaired) : null;
}
